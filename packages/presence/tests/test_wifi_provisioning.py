"""wifi_provisioning.py: the identity and API the phone app uses on the setup hotspot."""

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
        {"ssid": 'bad"ssid', "password": "12345678"},
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
