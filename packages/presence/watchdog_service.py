#!/usr/bin/env python3
"""
Hardware Watchdog Service for SkyGlass.

This service monitors the health of SkyGlass components and feeds the
hardware watchdog timer. If the system becomes unresponsive, the hardware
watchdog will automatically reboot the Raspberry Pi.

Features:
- Feeds the hardware watchdog timer (/dev/watchdog)
- Monitors the PM2 apps: skyglass-backend and skyglass-admin over HTTP
  (/api/health), skyglass-detector through `pm2 jlist` (it serves no HTTP)
- Restarts an app via PM2 after --max-failures consecutive failed checks
- Pauses restarts while a software update runs (scripts/update.sh), and runs
  `scripts/update.sh --recover` if an update was left half-applied
- Logs health status

Update contract with scripts/update.sh (paths relative to the install root,
--project-dir / SKYGLASS_PROJECT_DIR, default: two levels above this file):
- .update-lock/pid   PID of the running updater (the directory may be stale)
- .update-state      exists from just before the apps are stopped until the
                     update succeeded or was rolled back (key=value lines)

Usage (systemd unit skyglass-watchdog.service):
    sudo python watchdog_service.py --pm2-user <install user>

Note: Requires root access for /dev/watchdog. PM2 apps belong to the install
user's PM2 daemon (~<user>/.pm2), so PM2 commands run as that user
(`sudo -u <user> -H pm2 ...`) rather than as root, which would talk to an
empty root PM2 daemon.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


DEFAULT_PROJECT_DIR = Path(__file__).resolve().parent.parent.parent


def log(message: str):
    print(message, flush=True)


class PM2:
    """Runs pm2 as the install user (whose daemon owns the SkyGlass apps)."""

    def __init__(self, user: Optional[str] = None):
        self.user = user

    def as_user(self, *argv: str) -> list:
        """``argv`` run as the install user when we are root (else as is)."""
        if self.user and os.geteuid() == 0:
            return ["sudo", "-u", self.user, "-H", *argv]
        return list(argv)

    def command(self, *args: str) -> list:
        return self.as_user("pm2", *args)

    def run(self, *args: str, timeout: float = 30) -> subprocess.CompletedProcess:
        return subprocess.run(self.command(*args), capture_output=True, text=True, timeout=timeout)

    def status(self, app: str) -> Optional[str]:
        """PM2 status of ``app`` ("online", "errored", ...), or None if not listed."""
        result = self.run("jlist", timeout=15)
        for proc in json.loads(result.stdout or "[]"):
            if proc.get("name") == app:
                return proc.get("pm2_env", {}).get("status")
        return None


class ServiceHealth:
    """Tracks health status of one PM2 app.

    Checked over HTTP when ``check_url`` is set, otherwise by its PM2 status.
    """

    def __init__(self, name: str, pm2_name: str, pm2: PM2, check_url: Optional[str] = None):
        self.name = name
        self.pm2_name = pm2_name
        self.pm2 = pm2
        self.check_url = check_url
        self.healthy = True
        self.consecutive_failures = 0
        self.last_check = None
        self.last_error = None

    def check(self, timeout: float = 5.0) -> bool:
        """Check if the service is healthy."""
        self.last_check = datetime.now()

        if self.check_url:
            try:
                response = requests.get(self.check_url, timeout=timeout)
                if response.status_code == 200:
                    self.healthy = True
                    self.consecutive_failures = 0
                    self.last_error = None
                    return True
                else:
                    self.last_error = f"HTTP {response.status_code}"
            except requests.exceptions.Timeout:
                self.last_error = "Timeout"
            except requests.exceptions.ConnectionError:
                self.last_error = "Connection refused"
            except Exception as e:
                self.last_error = str(e)
        else:
            try:
                status = self.pm2.status(self.pm2_name)
                if status == "online":
                    self.healthy = True
                    self.consecutive_failures = 0
                    self.last_error = None
                    return True
                self.last_error = f"pm2 status {status or 'missing'}"
            except (OSError, subprocess.SubprocessError, ValueError) as e:
                self.last_error = f"pm2 jlist failed: {e}"

        self.healthy = False
        self.consecutive_failures += 1
        return False


class HardwareWatchdog:
    """Interfaces with the hardware watchdog timer."""

    def __init__(self, device: str = "/dev/watchdog"):
        self.device = device
        self.fd: Optional[int] = None
        self.enabled = False

    def open(self) -> bool:
        """Open the watchdog device."""
        try:
            self.fd = os.open(self.device, os.O_WRONLY)
            self.enabled = True
            print(f"Hardware watchdog opened: {self.device}")
            return True
        except FileNotFoundError:
            print(f"Watchdog device not found: {self.device}")
            print("Hardware watchdog not available (normal on non-Pi systems)")
            return False
        except PermissionError:
            print(f"Permission denied: {self.device}")
            print("Run with sudo to access hardware watchdog")
            return False
        except Exception as e:
            print(f"Failed to open watchdog: {e}")
            return False

    def feed(self):
        """Feed the watchdog to prevent reboot."""
        if self.fd is not None:
            try:
                os.write(self.fd, b'\0')
            except Exception as e:
                print(f"Failed to feed watchdog: {e}")

    def close(self):
        """Close the watchdog device."""
        if self.fd is not None:
            try:
                # Write 'V' to disable watchdog on close (magic close)
                os.write(self.fd, b'V')
                os.close(self.fd)
            except Exception:
                pass
            self.fd = None
            self.enabled = False

def pid_alive(pid: int) -> bool:
    """True if a process with ``pid`` exists.

    PermissionError means it exists but belongs to another user (the updater
    runs as the PM2 user, the watchdog as root or vice versa).
    """
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return is_update_script(pid)


def is_update_script(pid: int, proc_root: str = "/proc") -> bool:
    """True unless /proc shows ``pid`` is some other program.

    After a reboot an unrelated process can reuse the PID left in
    .update-lock/pid; scripts/update.sh only honours a lock whose PID is an
    update.sh process, and so must we, or a stale lock would pause restarts
    and block recovery forever. Without /proc (macOS dev machines) assume it is.
    """
    try:
        with open(os.path.join(proc_root, str(pid), "cmdline"), "rb") as f:
            cmdline = f.read()
    except FileNotFoundError:
        return not os.path.isdir(proc_root)
    except OSError:
        return True
    return b"update.sh" in cmdline


class UpdateGuard:
    """Detects a running or interrupted software update (scripts/update.sh).

    ``check(now)`` returns one of:
    - UPDATING: an update or recovery runs (live lock PID or .update-state
      present). No restarts, no failure counting.
    - GRACE: an update ended less than ``grace_period`` seconds ago; update.sh
      restarted the apps and checked them itself, so failures are not counted.
    - IDLE: normal monitoring.

    If .update-state stays present without a live updater for longer than
    ``stale_after`` seconds the update was interrupted: ``update.sh --recover``
    is started (as the PM2 user, in the background so the hardware watchdog
    keeps being fed), at most once per ``recover_backoff`` seconds.
    """

    IDLE = "idle"
    UPDATING = "updating"
    GRACE = "grace"

    def __init__(
        self,
        project_dir: Path,
        pm2: PM2,
        grace_period: float = 90,
        stale_after: float = 60,
        recover_backoff: float = 600,
        spawn: Optional[Callable[[list], "subprocess.Popen"]] = None,
        is_alive: Callable[[int], bool] = pid_alive,
    ):
        self.project_dir = Path(project_dir)
        self.pm2 = pm2
        self.grace_period = grace_period
        self.stale_after = stale_after
        self.recover_backoff = recover_backoff
        self.spawn = spawn or self._spawn
        self.is_alive = is_alive

        self.paused = False
        self.grace_until: Optional[float] = None
        self.orphaned_since: Optional[float] = None
        self.last_recover: Optional[float] = None
        self.recover_proc = None

    @property
    def lock_pid_file(self) -> Path:
        return self.project_dir / ".update-lock" / "pid"

    @property
    def state_file(self) -> Path:
        return self.project_dir / ".update-state"

    @property
    def update_script(self) -> Path:
        return self.project_dir / "scripts" / "update.sh"

    def recover_command(self) -> list:
        return self.pm2.as_user("bash", str(self.update_script), "--recover")

    def _spawn(self, argv: list):
        # Output goes to the watchdog's journal; never wait on it here.
        return subprocess.Popen(argv, cwd=str(self.project_dir), stdin=subprocess.DEVNULL)

    def lock_pid(self) -> Optional[int]:
        """PID recorded in .update-lock/pid, or None (missing/garbage)."""
        try:
            pid = int(self.lock_pid_file.read_text().strip())
        except (OSError, ValueError, UnicodeDecodeError):
            return None
        return pid if pid > 0 else None

    def lock_held(self) -> bool:
        pid = self.lock_pid()
        return pid is not None and self.is_alive(pid)

    def read_state(self) -> Optional[dict]:
        """Parsed .update-state, {} if present but unreadable, None if absent."""
        try:
            if not self.state_file.exists():
                return None
        except OSError:
            return None
        try:
            text = self.state_file.read_text()
        except (OSError, UnicodeDecodeError):
            return {}
        state = {}
        for line in text.splitlines():
            key, sep, value = line.partition("=")
            if sep:
                state[key.strip()] = value.strip()
        return state

    def _poll_recover(self):
        if self.recover_proc is None:
            return
        code = self.recover_proc.poll()
        if code is not None:
            log(f"update.sh --recover finished with exit code {code}")
            self.recover_proc = None

    def _start_recover(self, now: float):
        self.last_recover = now
        argv = self.recover_command()
        log(f"Interrupted update detected; running: {' '.join(argv)}")
        try:
            self.recover_proc = self.spawn(argv)
        except (OSError, subprocess.SubprocessError) as e:
            log(f"Failed to start update.sh --recover: {e}")
            self.recover_proc = None

    def check(self, now: float) -> str:
        self._poll_recover()
        lock_held = self.lock_held()
        state = self.read_state()

        if lock_held or state is not None:
            if not self.paused:
                self.paused = True
                detail = ""
                if state:
                    detail = f" (version {state.get('version', '?')} from {state.get('from', '?')})"
                log(f"Update in progress; pausing service restarts{detail}")
            self.grace_until = None

            if state is not None and not lock_held and self.recover_proc is None:
                if self.orphaned_since is None:
                    self.orphaned_since = now
                if (
                    now - self.orphaned_since > self.stale_after
                    and (self.last_recover is None or now - self.last_recover >= self.recover_backoff)
                ):
                    self._start_recover(now)
            else:
                self.orphaned_since = None
            return self.UPDATING

        self.orphaned_since = None
        if self.paused:
            self.paused = False
            self.grace_until = now + self.grace_period
            log(f"Update finished; resuming service restarts after {self.grace_period:g}s grace period")
        if self.grace_until is not None:
            if now < self.grace_until:
                return self.GRACE
            self.grace_until = None
        return self.IDLE


class WatchdogService:
    """Main watchdog service that monitors health and feeds the timer."""

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        admin_url: str = "http://localhost:5000",
        feed_interval: int = 10,
        max_failures: int = 3,
        use_hardware_watchdog: bool = True,
        pm2_user: Optional[str] = None,
        project_dir: Optional[Path] = None,
        update_grace: float = 90,
        update_stale_after: float = 60,
        recover_backoff: float = 600,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.feed_interval = feed_interval
        self.max_failures = max_failures
        self.running = False
        self.pm2 = PM2(pm2_user)
        self.clock = clock
        self.sleep = sleep

        # Hardware watchdog
        self.hw_watchdog = HardwareWatchdog() if use_hardware_watchdog else None

        # Software update awareness (scripts/update.sh)
        if project_dir is None:
            project_dir = Path(os.environ.get("SKYGLASS_PROJECT_DIR") or DEFAULT_PROJECT_DIR)
        self.update_guard = UpdateGuard(
            project_dir,
            self.pm2,
            grace_period=update_grace,
            stale_after=update_stale_after,
            recover_backoff=recover_backoff,
        )

        # Services to monitor
        # (names match config/pm2.config.cjs; the display UI is served by the backend)
        self.services = [
            ServiceHealth("backend", "skyglass-backend", self.pm2, f"{backend_url}/api/health"),
            # web_server.py (gunicorn wsgi:app)
            ServiceHealth("admin", "skyglass-admin", self.pm2, f"{admin_url}/api/health"),
            ServiceHealth("detector", "skyglass-detector", self.pm2),
        ]

        # Overall health
        self.system_healthy = True
        self.unhealthy_since: Optional[datetime] = None

    def check_services(self) -> bool:
        """Check all services and return overall health."""
        all_healthy = True
        status_parts = []

        for service in self.services:
            healthy = service.check()
            status = "OK" if healthy else f"FAIL({service.last_error})"
            status_parts.append(f"{service.name}:{status}")

            if not healthy:
                all_healthy = False

        # Log status periodically
        timestamp = datetime.now().strftime("%H:%M:%S")
        status_line = " | ".join(status_parts)
        print(f"[{timestamp}] {status_line}")

        return all_healthy

    def restart_service(self, service: ServiceHealth):
        """Attempt to restart a service via PM2."""
        try:
            result = self.pm2.run("restart", service.pm2_name)
            if result.returncode == 0:
                print(f"Restarted {service.pm2_name}")
            else:
                print(f"pm2 restart {service.pm2_name} failed: {(result.stderr or result.stdout).strip()}")
        except (OSError, subprocess.SubprocessError) as e:
            print(f"Failed to restart {service.pm2_name}: {e}")
        # Give the restart max_failures more checks before trying again.
        service.consecutive_failures = 0

    def feed(self):
        if self.hw_watchdog and self.hw_watchdog.enabled:
            try:
                self.hw_watchdog.feed()
            except Exception as e:  # never let feeding kill the loop
                log(f"Failed to feed watchdog: {e}")

    def update_status(self, now: float) -> str:
        """UpdateGuard state; IDLE if detection itself fails."""
        try:
            return self.update_guard.check(now)
        except Exception as e:
            log(f"Update detection failed: {e}")
            return UpdateGuard.IDLE

    def tick(self, now: Optional[float] = None):
        """One loop iteration: update check, health checks, restarts, feed."""
        if now is None:
            now = self.clock()
        self.feed()
        try:
            status = self.update_status(now)
            if status == UpdateGuard.UPDATING:
                # update.sh stops and restarts the apps itself; don't race it
                # and don't carry failures over into the post-update checks.
                for service in self.services:
                    service.consecutive_failures = 0
                return

            all_healthy = self.check_services()
            if status == UpdateGuard.GRACE:
                for service in self.services:
                    service.consecutive_failures = 0

            if all_healthy:
                self.system_healthy = True
                self.unhealthy_since = None
            else:
                if self.system_healthy:
                    self.system_healthy = False
                    self.unhealthy_since = datetime.now()
                    print("WARNING: System became unhealthy")

                # Try to restart failed services. The hardware watchdog is
                # still fed: PM2 handles app failures, reboot only on a total
                # system freeze.
                for service in self.services:
                    if service.consecutive_failures >= self.max_failures:
                        print(f"Attempting to restart {service.name}...")
                        self.restart_service(service)
                        self.feed()
                        self.sleep(5)  # Give it time to restart
        finally:
            self.feed()

    def run(self):
        """Main service loop."""
        print("=" * 50)
        print("SkyGlass Watchdog Service")
        print("=" * 50)
        print(f"Feed interval: {self.feed_interval}s")
        print(f"Failed checks before PM2 restart: {self.max_failures}")
        print(f"PM2 command: {' '.join(self.pm2.command('<args>'))}")
        print(f"Install root (update detection): {self.update_guard.project_dir}")
        print()

        # Open hardware watchdog
        if self.hw_watchdog:
            self.hw_watchdog.open()

        self.running = True

        # Signal handlers
        def signal_handler(sig, frame):
            print("\nShutting down watchdog...")
            self.running = False

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        try:
            while self.running:
                try:
                    self.tick()
                except Exception as e:  # keep monitoring (and feeding) regardless
                    log(f"Watchdog tick failed: {e}")
                self.sleep(self.feed_interval)

        finally:
            if self.hw_watchdog:
                self.hw_watchdog.close()
            print("Watchdog service stopped")


def enable_pi_watchdog():
    """Enable the Raspberry Pi hardware watchdog (requires reboot)."""
    # Bookworm moved the firmware config to /boot/firmware; older images use /boot.
    candidates = [Path("/boot/firmware/config.txt"), Path("/boot/config.txt")]
    config_file = next((p for p in candidates if p.exists()), None)

    if config_file is None:
        print("Not a Raspberry Pi (no /boot/firmware/config.txt or /boot/config.txt)")
        return False

    content = config_file.read_text()

    if "dtparam=watchdog=on" in content:
        print(f"Hardware watchdog already enabled in {config_file}")
        return True

    print(f"Enabling hardware watchdog in {config_file}...")
    try:
        with open(config_file, "a") as f:
            f.write("\n# Enable hardware watchdog\n")
            f.write("dtparam=watchdog=on\n")
        print("Watchdog enabled. Reboot required.")
        return True
    except PermissionError:
        print("Permission denied. Run with sudo.")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="SkyGlass hardware watchdog service"
    )
    parser.add_argument(
        "--backend-url",
        default="http://localhost:3001",
        help="Backend base URL (checks /api/health)"
    )
    parser.add_argument(
        "--admin-url",
        default="http://localhost:5000",
        help="Admin portal URL"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=10,
        help="Health check interval in seconds (default: 10)"
    )
    parser.add_argument(
        "--max-failures",
        type=int,
        default=3,
        help="Consecutive failed checks before a PM2 restart (default: 3)"
    )
    parser.add_argument(
        "--pm2-user",
        help="Run pm2 as this user (the install user owning the SkyGlass PM2 apps) when running as root"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        help="SkyGlass install root watched for updates (default: $SKYGLASS_PROJECT_DIR or two levels above this file)"
    )
    parser.add_argument(
        "--update-grace",
        type=float,
        default=90,
        help="Seconds after an update ends before failed checks count again (default: 90)"
    )
    parser.add_argument(
        "--update-stale-after",
        type=float,
        default=60,
        help="Seconds .update-state may exist without a live updater before running update.sh --recover (default: 60)"
    )
    parser.add_argument(
        "--recover-backoff",
        type=float,
        default=600,
        help="Minimum seconds between update.sh --recover attempts (default: 600)"
    )
    parser.add_argument(
        "--no-hardware",
        action="store_true",
        help="Disable hardware watchdog (software monitoring only)"
    )
    parser.add_argument(
        "--enable-watchdog",
        action="store_true",
        help="Enable Pi hardware watchdog in /boot/firmware/config.txt or /boot/config.txt (requires reboot)"
    )

    args = parser.parse_args()

    if args.enable_watchdog:
        enable_pi_watchdog()
        sys.exit(0)

    if not REQUESTS_AVAILABLE:
        print("ERROR: requests library required")
        print("Install with: pip install requests")
        sys.exit(1)

    service = WatchdogService(
        backend_url=args.backend_url,
        admin_url=args.admin_url,
        feed_interval=args.interval,
        max_failures=args.max_failures,
        use_hardware_watchdog=not args.no_hardware,
        pm2_user=args.pm2_user,
        project_dir=args.project_dir,
        update_grace=args.update_grace,
        update_stale_after=args.update_stale_after,
        recover_backoff=args.recover_backoff,
    )
    service.run()


if __name__ == "__main__":
    main()
