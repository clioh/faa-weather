"""watchdog_service.py: PM2 restarts stay paused while scripts/update.sh runs,
and an interrupted update is recovered with `update.sh --recover`.

No real pm2, sudo, /dev/watchdog or processes: the PM2 runner, the
process-liveness check, the recover spawner and the hardware watchdog are fakes.
"""

import os
import subprocess

import pytest

import watchdog_service as ws


class FakeHW:
    enabled = True

    def __init__(self):
        self.feeds = 0

    def feed(self):
        self.feeds += 1


class FakeProc:
    def __init__(self, code=None):
        self.code = code

    def poll(self):
        return self.code


class Harness:
    """A WatchdogService wired to fakes, plus helpers to drive it."""

    def __init__(self, root, monkeypatch, capsys):
        self.root = root
        self.capsys = capsys
        self.alive = set()
        self.denied = set()  # PIDs whose liveness check raises PermissionError
        self.spawned = []
        self.next_proc = None
        self.pm2_calls = []
        self.healthy = {"backend": True, "admin": True, "detector": True}

        monkeypatch.setattr(os, "geteuid", lambda: 0)
        self.svc = ws.WatchdogService(
            pm2_user="pi",
            use_hardware_watchdog=False,
            project_dir=root,
            clock=lambda: 0.0,
            sleep=lambda s: None,
        )
        self.hw = FakeHW()
        self.svc.hw_watchdog = self.hw
        self.svc.update_guard.is_alive = self._is_alive
        self.svc.update_guard.spawn = self._spawn

        def pm2_run(*args, timeout=30):
            self.pm2_calls.append(args)
            return subprocess.CompletedProcess(args, 0, "", "")

        self.svc.pm2.run = pm2_run
        for service in self.svc.services:
            service.check = self._checker(service)

    def _is_alive(self, pid):
        if pid in self.denied:
            raise PermissionError
        return pid in self.alive

    # Run the real liveness logic against our fake os.kill outcomes.
    def use_real_pid_alive(self, monkeypatch):
        def fake_kill(pid, sig):
            if pid in self.denied:
                raise PermissionError
            if pid not in self.alive:
                raise ProcessLookupError

        monkeypatch.setattr(ws.os, "kill", fake_kill)
        self.svc.update_guard.is_alive = ws.pid_alive

    def _spawn(self, argv):
        self.spawned.append(argv)
        return self.next_proc or FakeProc()

    def _checker(self, service):
        def check(timeout=5.0):
            if self.healthy[service.name]:
                service.healthy = True
                service.consecutive_failures = 0
                service.last_error = None
                return True
            service.healthy = False
            service.last_error = "down"
            service.consecutive_failures += 1
            return False

        return check

    def restarts(self):
        return [c for c in self.pm2_calls if c and c[0] == "restart"]

    def tick(self, now):
        before = self.hw.feeds
        self.svc.tick(now)
        assert self.hw.feeds > before, "hardware watchdog not fed on this tick"

    def set_lock(self, pid):
        lock = self.root / ".update-lock"
        lock.mkdir(exist_ok=True)
        (lock / "pid").write_text(f"{pid}\n")

    def clear_lock(self):
        lock = self.root / ".update-lock"
        if lock.exists():
            for f in lock.iterdir():
                f.unlink()
            lock.rmdir()

    def set_state(self, text="phase=applying\nversion=1.2.0\nfrom=1.1.0\npid=4242\nstarted=1000\n"):
        (self.root / ".update-state").write_text(text)

    def clear_state(self):
        (self.root / ".update-state").unlink()

    def output(self):
        return self.capsys.readouterr().out


@pytest.fixture
def h(tmp_path, monkeypatch, capsys):
    return Harness(tmp_path, monkeypatch, capsys)


PAUSE_MSG = "Update in progress; pausing service restarts"


# --- no update: existing behaviour ---------------------------------------


def test_no_update_restarts_after_max_failures(h):
    h.healthy["detector"] = False
    h.tick(0)
    h.tick(15)
    assert h.restarts() == []
    h.tick(30)
    assert h.restarts() == [("restart", "skyglass-detector")]
    # counter reset by the restart: another max_failures checks before retrying
    h.tick(45)
    h.tick(60)
    assert len(h.restarts()) == 1
    h.tick(75)
    assert len(h.restarts()) == 2


def test_healthy_services_never_restarted(h):
    for t in range(10):
        h.tick(t * 15)
    assert h.restarts() == []
    assert h.svc.system_healthy


# --- live lock -------------------------------------------------------------


def test_live_lock_pauses_restarts_and_logs_once(h):
    for name in h.healthy:
        h.healthy[name] = False
    h.tick(0)
    h.tick(15)  # two failures before the update starts
    h.output()
    h.alive.add(4242)
    h.set_lock(4242)
    for i in range(20):
        h.tick(30 + i * 15)
    assert h.restarts() == []
    assert all(s.consecutive_failures == 0 for s in h.svc.services)
    assert h.output().count(PAUSE_MSG) == 1
    assert h.spawned == []  # lock is live: nothing to recover


def test_permission_error_on_pid_check_counts_as_alive(h, monkeypatch):
    h.use_real_pid_alive(monkeypatch)
    h.denied.add(777)
    h.set_lock(777)
    h.set_state()
    h.healthy["backend"] = False
    for i in range(20):
        h.tick(i * 15)
    assert h.restarts() == []
    assert h.spawned == []  # owned by another user but alive: no recovery


def test_stale_lock_with_dead_pid_and_no_state_is_not_updating(h, monkeypatch):
    h.use_real_pid_alive(monkeypatch)
    h.set_lock(99999)  # not in h.alive -> ProcessLookupError
    h.healthy["admin"] = False
    for i in range(3):
        h.tick(i * 15)
    assert h.restarts() == [("restart", "skyglass-admin")]
    assert PAUSE_MSG not in h.output()


@pytest.mark.parametrize("content", ["", "garbage\n", "-5\n", "\xff\xfe"])
def test_garbage_lock_pid_without_state_is_not_updating(h, content):
    lock = h.root / ".update-lock"
    lock.mkdir()
    (lock / "pid").write_bytes(content.encode("latin-1"))
    h.healthy["admin"] = False
    for i in range(3):
        h.tick(i * 15)
    assert len(h.restarts()) == 1


# --- grace period ----------------------------------------------------------


def test_grace_period_after_update_ends(h):
    h.alive.add(4242)
    h.set_lock(4242)
    h.set_state()
    h.tick(0)
    h.clear_state()
    h.clear_lock()
    h.output()
    h.healthy["backend"] = False
    # 90 s grace starting at t=15: failures not counted
    for t in (15, 30, 45, 60, 75, 90, 100):
        h.tick(t)
        assert h.restarts() == []
        assert h.svc.services[0].consecutive_failures == 0
    assert "grace period" in h.output()
    # grace over (>= 105): counting resumes, restart after max_failures
    h.tick(105)
    h.tick(120)
    assert h.restarts() == []
    h.tick(135)
    assert h.restarts() == [("restart", "skyglass-backend")]


def test_grace_period_is_configurable(tmp_path, monkeypatch, capsys):
    h = Harness(tmp_path, monkeypatch, capsys)
    h.svc.update_guard.grace_period = 0
    h.set_state()
    h.alive.add(1)
    h.set_lock(1)
    h.tick(0)
    h.clear_state()
    h.clear_lock()
    h.healthy["detector"] = False
    for t in (15, 30, 45):
        h.tick(t)
    assert len(h.restarts()) == 1


# --- orphaned state file: recovery ----------------------------------------


def test_state_without_lock_recovers_after_stale_period_once(h):
    h.set_state()
    h.healthy["backend"] = False
    h.tick(0)
    h.tick(30)
    h.tick(60)  # exactly 60 s: not yet "> 60"
    assert h.spawned == []
    assert h.restarts() == []
    h.next_proc = FakeProc(code=None)
    h.tick(75)
    assert h.spawned == [["sudo", "-u", "pi", "-H", "bash", str(h.root / "scripts" / "update.sh"), "--recover"]]
    out = h.output()
    assert out.count(PAUSE_MSG) == 1
    assert "Interrupted update detected" in out

    # recovery still running: no second launch, restarts still paused
    for t in range(90, 1500, 15):
        h.tick(t)
    assert len(h.spawned) == 1
    assert h.restarts() == []


def test_recover_backoff_and_exit_code_logged(h):
    h.set_state()
    h.tick(0)
    h.next_proc = FakeProc(code=3)  # exits immediately, leaves the state file
    h.tick(61)
    assert len(h.spawned) == 1
    h.tick(76)
    assert "exit code 3" in h.output()
    # state still present without updater, but back off 600 s from t=61
    for t in range(91, 661, 15):
        h.tick(t)
    assert len(h.spawned) == 1
    h.tick(661)
    assert len(h.spawned) == 2
    assert h.restarts() == []


def test_restarts_paused_until_state_disappears(h):
    h.set_state()
    h.healthy["detector"] = False
    h.next_proc = FakeProc(code=0)
    for t in range(0, 300, 15):
        h.tick(t)
    assert len(h.spawned) == 1
    assert h.restarts() == []
    h.clear_state()
    h.svc.update_guard.grace_period = 0
    for t in (300, 315, 330):
        h.tick(t)
    assert h.restarts() == [("restart", "skyglass-detector")]


def test_orphan_timer_resets_when_updater_reappears(h):
    h.set_state()
    h.tick(0)
    h.tick(45)
    h.alive.add(10)
    h.set_lock(10)  # updater (re)acquired the lock
    h.tick(50)
    h.clear_lock()
    h.tick(70)  # orphaned again from t=70
    h.tick(120)
    assert h.spawned == []
    h.tick(131)
    assert len(h.spawned) == 1


def test_recover_spawn_failure_is_logged_and_backs_off(h):
    def boom(argv):
        h.spawned.append(argv)
        raise OSError("no bash")

    h.svc.update_guard.spawn = boom
    h.set_state()
    h.tick(0)
    h.tick(61)
    assert "Failed to start update.sh --recover" in h.output()
    h.tick(120)
    assert len(h.spawned) == 1


def test_recover_runs_directly_without_pm2_user(tmp_path):
    guard = ws.UpdateGuard(tmp_path, ws.PM2(None))
    assert guard.recover_command() == ["bash", str(tmp_path / "scripts" / "update.sh"), "--recover"]


# --- unreadable / garbage state --------------------------------------------


def test_garbage_state_file_counts_as_updating(h):
    h.set_state("\x00\x01not key value\n=\n")
    h.healthy["admin"] = False
    for t in range(0, 60, 15):
        h.tick(t)
    assert h.restarts() == []
    assert PAUSE_MSG in h.output()


def test_unreadable_state_file_counts_as_updating(h, monkeypatch):
    h.set_state()
    real_read = ws.Path.read_text

    def read_text(self, *a, **k):
        if self.name == ".update-state":
            raise PermissionError("denied")
        return real_read(self, *a, **k)

    monkeypatch.setattr(ws.Path, "read_text", read_text)
    assert h.svc.update_guard.read_state() == {}
    h.healthy["admin"] = False
    for t in range(0, 60, 15):
        h.tick(t)
    assert h.restarts() == []


def test_update_detection_exception_defaults_to_not_updating(h):
    def broken(now):
        raise RuntimeError("disk on fire")

    h.svc.update_guard.check = broken
    h.healthy["backend"] = False
    for t in range(0, 45, 15):
        h.tick(t)
    assert len(h.restarts()) == 1
    assert "Update detection failed" in h.output()


def test_state_parsing(h):
    h.set_state()
    assert h.svc.update_guard.read_state() == {
        "phase": "applying",
        "version": "1.2.0",
        "from": "1.1.0",
        "pid": "4242",
        "started": "1000",
    }
    h.clear_state()
    assert h.svc.update_guard.read_state() is None


# --- configuration ---------------------------------------------------------


def test_project_dir_from_env(tmp_path, monkeypatch):
    monkeypatch.setenv("SKYGLASS_PROJECT_DIR", str(tmp_path))
    svc = ws.WatchdogService(use_hardware_watchdog=False)
    assert svc.update_guard.project_dir == tmp_path


def test_default_project_dir_is_repo_root(monkeypatch):
    monkeypatch.delenv("SKYGLASS_PROJECT_DIR", raising=False)
    svc = ws.WatchdogService(use_hardware_watchdog=False)
    assert (svc.update_guard.project_dir / "packages" / "presence" / "watchdog_service.py").exists()


def test_cli_flags(monkeypatch, tmp_path):
    captured = {}

    class Fake:
        def __init__(self, **kw):
            captured.update(kw)

        def run(self):
            pass

    monkeypatch.setattr(ws, "WatchdogService", Fake)
    monkeypatch.setattr(ws, "REQUESTS_AVAILABLE", True)
    monkeypatch.setattr(
        "sys.argv",
        ["watchdog_service.py", "--interval", "15", "--pm2-user", "pi", "--project-dir", str(tmp_path),
         "--update-grace", "30", "--update-stale-after", "120", "--recover-backoff", "900"],
    )
    ws.main()
    assert captured["project_dir"] == tmp_path
    assert captured["update_grace"] == 30
    assert captured["update_stale_after"] == 120
    assert captured["recover_backoff"] == 900
    assert captured["feed_interval"] == 15
    assert captured["pm2_user"] == "pi"


def test_cli_defaults(monkeypatch):
    captured = {}

    class Fake:
        def __init__(self, **kw):
            captured.update(kw)

        def run(self):
            pass

    monkeypatch.setattr(ws, "WatchdogService", Fake)
    monkeypatch.setattr(ws, "REQUESTS_AVAILABLE", True)
    monkeypatch.setattr("sys.argv", ["watchdog_service.py"])
    ws.main()
    assert captured["project_dir"] is None
    assert (captured["update_grace"], captured["update_stale_after"], captured["recover_backoff"]) == (90, 60, 600)


def test_feed_failure_does_not_break_tick(h):
    class BadHW:
        enabled = True

        def feed(self):
            raise OSError("gone")

    h.svc.hw_watchdog = BadHW()
    h.svc.tick(0)  # must not raise
    assert "Failed to feed watchdog" in h.output()


def test_reused_pid_is_not_an_updater(tmp_path):
    """A lock PID reused by another program after a reboot does not count."""
    proc = tmp_path / "proc"
    (proc / "42").mkdir(parents=True)
    (proc / "42" / "cmdline").write_bytes(b"/usr/bin/python3\x00detector.py\x00")
    (proc / "43").mkdir()
    (proc / "43" / "cmdline").write_bytes(b"bash\x00/home/pi/SkyGlass/scripts/update.sh\x00--recover\x00")
    assert ws.is_update_script(42, str(proc)) is False
    assert ws.is_update_script(43, str(proc)) is True
    # PID gone from a real /proc tree: not an updater.
    assert ws.is_update_script(44, str(proc)) is False
    # No /proc at all (macOS): fall back to plain liveness.
    assert ws.is_update_script(42, str(tmp_path / "no-proc")) is True
