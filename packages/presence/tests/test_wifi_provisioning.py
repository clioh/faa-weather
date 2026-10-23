"""wifi_provisioning.py: the identity and API the phone app uses on the setup
hotspot, and the hotspot/join/fallback flow (NetworkManager is a fake here;
the nmcli argv is covered in test_nm_wifi.py)."""

import sqlite3

import pytest

import wifi_provisioning as wp


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SKYGLASS_DATA_DIR", str(tmp_path))
    return tmp_path


def test_identity_is_created_once_and_kept(data_dir):
    mirror_id, name = wp.mirror_identity()
    assert len(mirror_id) == 36
    assert name.startswith("SkyGlass-")
    assert wp.mirror_identity() == (mirror_id, name)


def test_identity_reuses_the_backends(data_dir):
    conn = sqlite3.connect(str(data_dir / "skyglass.db"))
    conn.execute("CREATE TABLE mirror_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("INSERT INTO mirror_settings VALUES ('mirrorId', '0b0e8f4e-4a43-4a8e-9a39-6f4f7d1c2b3a')")
    conn.execute("INSERT INTO mirror_settings VALUES ('mirrorName', 'Hangar')")
    conn.commit()
    conn.close()
    assert wp.mirror_identity() == ("0b0e8f4e-4a43-4a8e-9a39-6f4f7d1c2b3a", "Hangar")


class FakeProvisioning(wp.WiFiProvisioning):
    def __init__(self):
        super().__init__()
        self.joins = []

    def start_join(self, ssid, password):
        if self.join_state["state"] == "connecting":
            return False
        self.joins.append((ssid, password))
        self.join_state = {"state": "connecting", "ssid": ssid, "error": None}
        return True


@pytest.fixture
def client(data_dir):
    prov = FakeProvisioning()
    app = wp.create_flask_app(prov, use_captive_portal=False)
    return app.test_client(), prov


def test_discovery_reports_identity_and_join_state(client):
    c, prov = client
    body = c.get("/api/discovery").get_json()
    assert body["provisioning"] is True
    assert body["mirrorId"] == wp.mirror_identity()[0]
    assert body["wifi"] == {"state": "idle", "ssid": None, "error": None}

    prov.join_state = {"state": "failed", "ssid": "Home", "error": "nope"}
    assert c.get("/api/discovery").get_json()["wifi"]["state"] == "failed"


def test_setup_status_starts_at_wifi(client):
    c, _ = client
    body = c.get("/api/setup/status").get_json()
    assert body["step"] == "wifi"
    assert body["wifiConfigured"] is False


def test_connect_answers_before_joining(client):
    c, prov = client
    res = c.post("/api/wifi/connect", json={"ssid": "Home", "password": "correct horse"})
    assert res.status_code == 200
    assert res.get_json() == {"success": True, "pending": True}
    assert prov.joins == [("Home", "correct horse")]

    again = c.post("/api/wifi/connect", json={"ssid": "Home", "password": "correct horse"})
    assert again.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"ssid": ""},
        {"ssid": "bad\nssid", "password": "12345678"},
        {"ssid": "x" * 33, "password": "12345678"},
        {"ssid": "Home", "password": "short"},
    ],
)
def test_connect_rejects_bad_input(client, body):
    c, prov = client
    res = c.post("/api/wifi/connect", json=body)
    assert res.status_code == 400
    assert res.get_json()["success"] is False
    assert prov.joins == []


def test_stop_ap_is_a_no_op_when_not_in_ap_mode(monkeypatch):
    calls = []
    monkeypatch.setattr(wp.subprocess, "run", lambda *a, **k: calls.append(a))
    wp.WiFiProvisioning().stop_ap()
    assert calls == []


def test_connect_accepts_quotes_spaces_and_colons(client):
    c, prov = client
    ssid, pw = 'Hangar "B": Ops ✈', 'pa ss "word" ;$(x)'
    res = c.post("/api/wifi/connect", json={"ssid": ssid, "password": pw})
    assert res.status_code == 200
    assert prov.joins == [(ssid, pw)]


# ------------------------------------------------------------ hotspot flow


class FakeNM:
    def __init__(self):
        self.calls = []
        self.networks = [
            wp.WiFiNetwork("Home", 70, "wpa2"),
            wp.WiFiNetwork("Cafe", 40, "open"),
        ]
        self.join_result = (True, None)
        self.hotspot_fails = 0
        self.ap = False
        self.saved = [("skyglass-wifi", "u-home")]
        self.reconnect_result = None
        self.clients = 0

    def radio_on(self):
        self.calls.append(("radio_on",))

    def scan(self, rescan=True):
        self.calls.append(("scan", rescan))
        if self.ap:
            return []  # an access point doesn't scan
        return list(self.networks)

    def start_hotspot(self, captive_dns=True):
        self.calls.append(("start_hotspot", captive_dns))
        if self.hotspot_fails:
            self.hotspot_fails -= 1
            raise wp.NMError("activation failed")
        self.ap = True

    def stop_hotspot(self):
        self.calls.append(("stop_hotspot",))
        self.ap = False

    def join(self, ssid, password):
        self.calls.append(("join", ssid, password))
        return self.join_result

    def online(self):
        return None

    def saved_wifi_profiles(self):
        self.calls.append(("saved_wifi_profiles",))
        return list(self.saved)

    def reconnect_saved(self, profiles, timeout):
        self.calls.append(("reconnect_saved", tuple(profiles), timeout))
        assert not self.ap, "the hotspot must be down before saved networks are tried"
        return self.reconnect_result

    def hotspot_clients(self):
        return self.clients

    def current_ssid(self):
        return None


@pytest.fixture
def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(wp, "PROVISIONING_COMPLETE_FLAG", tmp_path / "face_data" / ".wifi_configured")
    monkeypatch.setattr(wp.time, "sleep", lambda s: None)
    nm = FakeNM()
    prov = wp.WiFiProvisioning(nm=nm)
    normal = []
    prov.enter_normal_mode = lambda: normal.append(True)
    return prov, nm, normal


def test_start_ap_scans_first_and_serves_the_cached_list(flow):
    prov, nm, _ = flow
    assert prov.start_ap()
    assert nm.calls[:3] == [("radio_on",), ("scan", True), ("start_hotspot", True)]
    assert [n.ssid for n in prov.scan_networks()] == ["Home", "Cafe"]

    app = wp.create_flask_app(prov, use_captive_portal=False)
    body = app.test_client().get("/api/wifi/scan").get_json()
    assert body == [
        {"ssid": "Home", "signal": 70, "security": "wpa2", "secure": True, "connected": False},
        {"ssid": "Cafe", "signal": 40, "security": "open", "secure": False, "connected": False},
    ]


def test_start_ap_failure_reports_false_and_cleans_up(flow):
    prov, nm, _ = flow
    nm.hotspot_fails = 1
    assert prov.start_ap() is False
    assert prov.ap_active is False
    assert ("stop_hotspot",) in nm.calls


def test_join_success_writes_flag_and_enters_normal_mode(flow):
    prov, nm, normal = flow
    prov.start_ap()
    prov._join("Home", "correct horse")
    assert ("stop_hotspot",) in nm.calls
    assert nm.calls.index(("stop_hotspot",)) < nm.calls.index(("join", "Home", "correct horse"))
    assert wp.PROVISIONING_COMPLETE_FLAG.read_text() == "Home"
    assert prov.get_join_state() == {"state": "connected", "ssid": "Home", "error": None}
    assert normal == [True]
    assert prov.ap_active is False


def test_join_failure_reports_reason_and_brings_hotspot_back(flow):
    prov, nm, normal = flow
    prov.start_ap()
    nm.join_result = (False, 'The password for "Home" was not accepted.')
    prov._join("Home", "wrongpass")
    state = prov.get_join_state()
    assert state["state"] == "failed" and "password" in state["error"]
    assert not wp.PROVISIONING_COMPLETE_FLAG.exists()
    assert normal == []
    assert prov.ap_active is True
    assert [c[0] for c in nm.calls].count("start_hotspot") == 2


def test_join_exception_still_brings_hotspot_back(flow):
    prov, nm, _ = flow
    prov.start_ap()

    def boom(ssid, password):
        raise RuntimeError("nmcli vanished")

    nm.join = boom
    prov._join("Home", "12345678")
    assert prov.get_join_state()["state"] == "failed"
    assert prov.ap_active is True


def test_hotspot_retry_exhausted_exits_for_systemd_restart(flow, monkeypatch):
    prov, nm, _ = flow
    nm.hotspot_fails = 99
    exits = []
    monkeypatch.setattr(wp.os, "_exit", lambda code: exits.append(code))
    prov.restart_ap()
    assert exits == [1]
    assert [c[0] for c in nm.calls].count("start_hotspot") == wp.AP_RESTART_ATTEMPTS


def test_captive_dns_follows_portal_setting(flow):
    prov, nm, _ = flow
    prov.captive_dns = False
    prov.start_ap()
    assert ("start_hotspot", False) in nm.calls


# ------------------------------------------------------------ saved networks


@pytest.fixture
def clock(flow):
    prov, _, _ = flow
    now = {"t": 1000.0}
    prov.clock = lambda: now["t"]
    return now


def names(nm):
    return [c[0] for c in nm.calls]


def test_saved_network_back_enters_normal_mode(flow, clock):
    prov, nm, normal = flow
    prov.start_ap()
    nm.reconnect_result = "skyglass-wifi"
    assert prov.try_saved_networks() is True
    calls = names(nm)
    assert calls.index("stop_hotspot") < calls.index("reconnect_saved")
    assert ("reconnect_saved", (("skyglass-wifi", "u-home"),), wp.RECONNECT_TIMEOUT_SECONDS) in nm.calls
    assert normal == [True]
    assert prov.ap_active is False
    assert calls.count("start_hotspot") == 1  # not brought back
    # The mirror is leaving: a join from a late phone is refused
    assert prov.start_join("Other", "12345678") is False


def test_saved_network_still_away_brings_hotspot_back(flow, clock):
    prov, nm, normal = flow
    prov.start_ap()
    nm.reconnect_result = None
    assert prov.try_saved_networks() is False
    assert normal == []
    assert prov.ap_active is True
    assert names(nm).count("start_hotspot") == 2
    assert prov.reconnecting is False
    assert prov.get_join_state()["state"] == "idle"


def test_reconnect_error_still_brings_hotspot_back(flow, clock):
    prov, nm, _ = flow
    prov.start_ap()

    def boom(profiles, timeout):
        raise RuntimeError("nmcli vanished")

    nm.reconnect_saved = boom
    assert prov.try_saved_networks() is False
    assert prov.ap_active is True


def test_no_retry_while_a_phone_is_on_the_hotspot(flow, clock):
    prov, nm, _ = flow
    prov.start_ap()
    nm.clients = 1
    assert prov.try_saved_networks() is False
    assert "stop_hotspot" not in names(nm)


def test_no_retry_right_after_a_request_from_a_phone(flow, clock):
    prov, nm, _ = flow
    prov.start_ap()
    nm.reconnect_result = None
    nm.clients = None  # iw unavailable: only requests tell
    app = wp.create_flask_app(prov, use_captive_portal=True)
    app.test_client().get("/hotspot-detect.html")
    assert prov.try_saved_networks() is False
    assert "stop_hotspot" not in names(nm)

    clock["t"] += wp.PHONE_ACTIVITY_SECONDS + 1
    assert prov.try_saved_networks() is False  # tried, network still away
    assert "reconnect_saved" in names(nm)


def test_no_retry_during_a_join_or_without_saved_networks_or_hotspot(flow, clock):
    prov, nm, _ = flow
    assert prov.try_saved_networks() is False  # hotspot not up
    prov.start_ap()
    prov.join_state = {"state": "connecting", "ssid": "Home", "error": None}
    assert prov.try_saved_networks() is False
    prov.join_state = {"state": "failed", "ssid": "Home", "error": "nope"}
    nm.saved = []
    assert prov.try_saved_networks() is False
    assert "stop_hotspot" not in names(nm)


def test_join_refused_while_retrying_saved_networks(flow, clock):
    prov, nm, _ = flow
    prov.start_ap()
    seen = []

    def slow(profiles, timeout):
        seen.append(prov.start_join("Home", "12345678"))
        return None

    nm.reconnect_saved = slow
    prov.try_saved_networks()
    assert seen == [False]


def test_reconnect_loop_runs_until_success(flow, monkeypatch):
    prov, _, _ = flow
    results = [False, False, True, False]
    monkeypatch.setattr(prov, "try_saved_networks", lambda: results.pop(0))
    prov.reconnect_loop(interval=0)
    assert results == [False]


def test_reconnect_loop_stops_on_shutdown(flow, monkeypatch):
    prov, _, _ = flow
    tries = []
    monkeypatch.setattr(prov, "try_saved_networks", lambda: tries.append(1))
    prov.stop()
    prov.reconnect_loop(interval=0)
    assert tries == []
