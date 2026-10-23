#!/usr/bin/env python3
"""
WiFi Provisioning Service for SkyGlass.

Creates a WiFi hotspot with a captive portal for initial device setup.
When the device has no working network, it:
1. Creates an open access point "SkyGlass-Setup" on 10.42.0.1
2. Runs a captive portal web server on port 80
3. Lets users select their home WiFi and enter credentials
4. Connects to the home network and disables the hotspot

This enables true "out of box" experience - no technical knowledge required.

The SkyGlass phone app talks to the same server (http://10.42.0.1:80):
    GET  /api/health, /api/discovery   identity (persistent mirror id) + join progress
    GET  /api/setup/status             "wifi" step, so the app's setup flow starts here
    GET  /api/wifi/scan
    POST /api/wifi/connect             answers at once ({"success": true, "pending": true}),
                                       then joins in the background
Joining drops the hotspot. On success the boot-mode unit is re-run, which
stops this service and starts the mirror's apps on the home network (where
the app finds the mirror again by its id). On failure the hotspot comes back
and /api/discovery reports wifi.state "failed" with the reason.

Saved networks: boot-mode.sh also starts the hotspot on a mirror that was set
up before but found no network at boot (moved to a new router, or the router
is still booting after a power cut). While the hotspot is up NetworkManager
can't retry the saved network on wlan0, so every RECONNECT_INTERVAL_SECONDS,
when no phone is on the hotspot and no setup is in progress, the hotspot goes
down for up to RECONNECT_TIMEOUT_SECONDS while the saved WiFi profiles are
tried. If one connects, the mirror goes to normal mode exactly as after a
join from the phone; otherwise the hotspot comes back.

Networking is NetworkManager (nm_wifi.py): the hotspot is an in-memory NM
profile (mode ap, ipv4.method shared; NM's own dnsmasq does DHCP and, through
/etc/NetworkManager/dnsmasq-shared.d/skyglass-captive.conf, the captive-portal
DNS redirect). The radio can't scan while it is an access point, so the list
the phone sees is the scan taken just before the hotspot came up.

Usage (skyglass-provision.service, started by scripts/boot-mode.sh):
    sudo python wifi_provisioning.py

Requirements: NetworkManager with dnsmasq-base (Raspberry Pi OS Bookworm and
Trixie; scripts/setup-pi.sh installs them).
"""

import os
import sys
import socket
import sqlite3
import subprocess
import time
import signal
import uuid
from pathlib import Path
from typing import Optional, List, Tuple
from threading import Event, Lock, Thread

from flask import Flask, render_template_string, request, jsonify, redirect

import nm_wifi
from nm_wifi import NMError, WiFiNetwork, password_problem, ssid_problem  # noqa: F401 (re-exported)

# Constants (the phone app, frontend ProvisioningScreen and backend
# /api/provisioning/status all expect these)
AP_SSID = nm_wifi.HOTSPOT_SSID
AP_PASSWORD = ""  # Open network for easy setup
AP_IP = nm_wifi.HOTSPOT_ADDRESS

PROVISIONING_COMPLETE_FLAG = Path(__file__).parent / "face_data" / ".wifi_configured"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Seconds between answering POST /api/wifi/connect and dropping the hotspot,
# so the response reaches the phone first.
JOIN_DELAY_SECONDS = 2
# Attempts to bring the hotspot back after a failed join before exiting
# (systemd then restarts this service, which starts the hotspot again).
AP_RESTART_ATTEMPTS = 3
# Retrying saved networks while the hotspot is up (see the module docstring)
RECONNECT_INTERVAL_SECONDS = 300
RECONNECT_TIMEOUT_SECONDS = 45
# A request to this server within this many seconds means a phone is using the
# hotspot (on top of `iw station dump`, which may be unavailable)
PHONE_ACTIVITY_SECONDS = 120


def _data_dir() -> Path:
    """The data/ directory shared with the backend (see security.data_dir)."""
    return Path(os.environ.get("SKYGLASS_DATA_DIR") or (REPO_ROOT / "data"))


def mirror_identity() -> Tuple[str, str]:
    """The mirror's persistent (id, name), as the backend reports them.

    They live in the backend's SQLite database (mirror_settings, see
    packages/backend/src/db/index.ts). On a fresh mirror the backend may never
    have run, so create them here the same way the backend would: the backend
    keeps an existing id. The phone app stores this id and uses it to find the
    mirror again once it has a new address on the home network.
    """
    data_dir = _data_dir()
    db_path = data_dir / "skyglass.db"
    created_dir = not data_dir.exists()
    created_db = not db_path.exists()
    data_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mirror_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        rows = dict(conn.execute(
            "SELECT key, value FROM mirror_settings WHERE key IN ('mirrorId', 'mirrorName')"
        ).fetchall())
        mirror_id = rows.get("mirrorId")
        name = rows.get("mirrorName")
        if not mirror_id:
            mirror_id = str(uuid.uuid4())
            name = name or f"SkyGlass-{socket.gethostname().split('.')[0]}"
            conn.execute("INSERT OR IGNORE INTO mirror_settings (key, value) VALUES ('mirrorId', ?)", (mirror_id,))
            conn.execute("INSERT OR IGNORE INTO mirror_settings (key, value) VALUES ('mirrorName', ?)", (name,))
            conn.commit()
    finally:
        conn.close()

    # This service runs as root; the backend runs as the install user and
    # must be able to open what we created.
    if os.geteuid() == 0:
        owner = REPO_ROOT.stat()
        for path, created in ((data_dir, created_dir), (db_path, created_db)):
            if created:
                try:
                    os.chown(path, owner.st_uid, owner.st_gid)
                except OSError:
                    pass

    return mirror_id, name or "SkyGlass"


def _chown_to_repo_owner(path: Path) -> None:
    """Files this root service writes belong to the install user."""
    if os.geteuid() != 0:
        return
    try:
        owner = REPO_ROOT.stat()
        os.chown(path, owner.st_uid, owner.st_gid)
    except OSError:
        pass


class WiFiProvisioning:
    """Manages WiFi provisioning via captive portal (NetworkManager underneath)."""

    def __init__(self, interface: str = "wlan0", nm: Optional[nm_wifi.NetworkManager] = None):
        self.interface = interface
        self.nm = nm or nm_wifi.NetworkManager(interface)
        self.ap_active = False
        self.captive_dns = True
        self.flask_app: Optional[Flask] = None
        self.server_thread: Optional[Thread] = None
        self.running = False
        # Last scan taken in station mode (the radio can't scan as an AP).
        self.scan_cache: List[WiFiNetwork] = []
        # Progress of the last join started from the app or captive portal.
        self._join_lock = Lock()
        self.join_state = {"state": "idle", "ssid": None, "error": None}
        self.last_join_error: Optional[str] = None
        # Saved-network retry (reconnect_loop)
        self.clock = time.monotonic
        self.reconnecting = False
        self.last_request: Optional[float] = None
        self._stop = Event()

    def is_wifi_configured(self) -> bool:
        """True if the mirror is online (WiFi or Ethernet, not via the hotspot)."""
        return self._is_connected()

    def _is_connected(self) -> bool:
        try:
            return self.nm.online() is not None
        except NMError:
            return False

    def _get_current_ssid(self) -> Optional[str]:
        """Get currently connected SSID."""
        try:
            return self.nm.current_ssid()
        except NMError:
            return None

    def refresh_scan_cache(self) -> List[WiFiNetwork]:
        """Scan now (station mode only) and remember the result."""
        try:
            networks = [n for n in self.nm.scan(rescan=True) if n.ssid != AP_SSID]
        except NMError as e:
            print(f"Scan error: {e}")
            return self.scan_cache
        if networks:
            self.scan_cache = networks
        return self.scan_cache

    def scan_networks(self) -> List[WiFiNetwork]:
        """Networks for the phone's list, strongest first, one entry per SSID."""
        if not self.ap_active:
            return self.refresh_scan_cache()
        # As an access point the radio doesn't scan; NM's list (if it kept
        # one) is no newer than our cache.
        try:
            live = [n for n in self.nm.scan(rescan=False) if n.ssid != AP_SSID]
        except NMError:
            live = []
        return live or self.scan_cache

    def start_ap(self) -> bool:
        """Start the WiFi access point."""
        print(f"Starting access point: {AP_SSID}")
        # Scan while we still can (see scan_networks).
        self.nm.radio_on()
        self.refresh_scan_cache()
        try:
            self.nm.start_hotspot(captive_dns=self.captive_dns)
        except NMError as e:
            print(f"Failed to start AP: {e}")
            self.nm.stop_hotspot()
            return False
        self.ap_active = True
        print(f"Access point started: {AP_SSID}")
        print(f"Connect to WiFi '{AP_SSID}' and open http://{AP_IP}")
        return True

    def stop_ap(self):
        """Stop the access point (NetworkManager then manages wlan0 as usual)."""
        if not self.ap_active:
            # Already on the home network (e.g. stopped by boot-mode.sh after
            # a successful join): touching wlan0 now would drop that link.
            return
        print("Stopping access point...")
        self.nm.stop_hotspot()
        self.ap_active = False
        print("Access point stopped")

    def connect_to_network(self, ssid: str, password: str) -> bool:
        """Connect to a WiFi network (the hotspot is dropped first)."""
        print(f"Connecting to: {ssid}")
        self.stop_ap()
        time.sleep(2)
        ok, error = self.nm.join(ssid, password)
        if not ok:
            print(f"Join failed: {error}")
            self.last_join_error = error
            return False
        print(f"Connected to {ssid}!")
        PROVISIONING_COMPLETE_FLAG.parent.mkdir(parents=True, exist_ok=True)
        PROVISIONING_COMPLETE_FLAG.write_text(ssid)
        _chown_to_repo_owner(PROVISIONING_COMPLETE_FLAG)
        return True

    def get_join_state(self) -> dict:
        with self._join_lock:
            return dict(self.join_state)

    def start_join(self, ssid: str, password: str) -> bool:
        """Join ``ssid`` in the background. False if a join is already running."""
        with self._join_lock:
            if self.join_state["state"] == "connecting" or self.reconnecting:
                return False
            self.join_state = {"state": "connecting", "ssid": ssid, "error": None}
        Thread(target=self._join, args=(ssid, password), daemon=True).start()
        return True

    def _join(self, ssid: str, password: str) -> None:
        time.sleep(JOIN_DELAY_SECONDS)
        self.last_join_error = None
        try:
            ok = self.connect_to_network(ssid, password)
        except Exception as e:  # never leave the mirror without hotspot or network
            print(f"Connection error: {e}")
            self.last_join_error = f"Connection error: {e}"
            ok = False
        with self._join_lock:
            self.join_state = {
                "state": "connected" if ok else "failed",
                "ssid": ssid,
                "error": None if ok else (self.last_join_error or f"Couldn't join \"{ssid}\""),
            }
        if ok:
            self.enter_normal_mode()
        else:
            # Bring the hotspot back so the phone can rejoin it and retry.
            print("Join failed; restarting the setup hotspot")
            self.restart_ap()

    def restart_ap(self) -> None:
        for attempt in range(AP_RESTART_ATTEMPTS):
            if self.start_ap():
                return
            time.sleep(5)
        # systemd (Restart=on-failure) starts the service, and the hotspot, again.
        print("Could not bring the setup hotspot back; exiting for a restart")
        os._exit(1)

    # ---- saved networks while the hotspot is up

    def note_request(self) -> None:
        """A phone talked to this server (captive portal probe, app or setup page)."""
        self.last_request = self.clock()

    def phone_present(self) -> bool:
        """A phone is on the hotspot, or used it recently, or a join is running."""
        if self.get_join_state()["state"] == "connecting":
            return True
        if self.last_request is not None and self.clock() - self.last_request < PHONE_ACTIVITY_SECONDS:
            return True
        clients = self.nm.hotspot_clients()
        return bool(clients)

    def try_saved_networks(self) -> bool:
        """Take the hotspot down and try the saved WiFi profiles; True if one connected.

        Does nothing (False) unless the hotspot is up, a WiFi network is saved
        and no phone is using the hotspot. On success the mirror goes to normal
        mode, as after a join from the phone; otherwise the hotspot comes back.
        """
        if not self.ap_active or self.phone_present():
            return False
        try:
            profiles = self.nm.saved_wifi_profiles()
        except NMError as e:
            print(f"Could not list saved networks: {e}")
            return False
        if not profiles:
            return False
        with self._join_lock:
            if self.join_state["state"] == "connecting":
                return False
            self.reconnecting = True

        names = ", ".join(name for name, _ in profiles)
        print(f"No phone on the hotspot; trying saved network(s) for {RECONNECT_TIMEOUT_SECONDS}s: {names}")
        connected = None
        try:
            self.stop_ap()
            connected = self.nm.reconnect_saved(profiles, RECONNECT_TIMEOUT_SECONDS)
        except Exception as e:  # never leave the mirror without hotspot or network
            print(f"Saved network retry failed: {e}")
        if connected:
            print(f"Back on saved network {connected}; entering normal mode")
            self.enter_normal_mode()
            return True
        print("Saved networks still unavailable; restarting the setup hotspot")
        with self._join_lock:
            self.reconnecting = False
        self.restart_ap()
        return False

    def reconnect_loop(self, interval: float = RECONNECT_INTERVAL_SECONDS) -> None:
        """Call try_saved_networks every ``interval`` seconds until stop() or success."""
        while not self._stop.wait(interval):
            try:
                if self.try_saved_networks():
                    return
            except Exception as e:
                print(f"Saved network retry error: {e}")

    def stop(self) -> None:
        self._stop.set()

    def enter_normal_mode(self) -> None:
        """Hand over to scripts/boot-mode.sh: it stops this service and starts the apps."""
        try:
            subprocess.run(
                ["systemctl", "--no-block", "restart", "skyglass-boot.service"],
                capture_output=True, timeout=10,
            )
        except Exception as e:
            print(f"Could not re-run boot mode detection: {e}")

    def get_ip_address(self) -> Optional[str]:
        """IPv4 address on the home network (not the hotspot's), or None."""
        try:
            found = self.nm.online()
        except NMError:
            return None
        return found[1] if found else None


# ============================================================
# Captive Portal Web Interface
# ============================================================

CAPTIVE_PORTAL_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <title>SkyGlass Setup</title>
    <style>
        :root {
            --bg: #0f0f1a;
            --card: #1a1a2e;
            --accent: #4ecca3;
            --accent-dim: rgba(78, 204, 163, 0.2);
            --text: #ffffff;
            --text-dim: #8888aa;
            --danger: #ef5350;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 400px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            padding: 30px 0;
        }
        .logo {
            font-size: 4rem;
            margin-bottom: 15px;
        }
        .header h1 {
            font-size: 1.5rem;
            font-weight: 400;
            margin-bottom: 8px;
        }
        .header p {
            color: var(--text-dim);
            font-size: 0.95rem;
        }
        .card {
            background: var(--card);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
        }
        .card h2 {
            font-size: 1.1rem;
            margin-bottom: 20px;
            color: var(--accent);
        }
        .network-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .network {
            display: flex;
            align-items: center;
            padding: 15px;
            margin-bottom: 10px;
            background: rgba(255,255,255,0.05);
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            border: 2px solid transparent;
        }
        .network:hover {
            background: var(--accent-dim);
        }
        .network.selected {
            border-color: var(--accent);
            background: var(--accent-dim);
        }
        .network-icon {
            font-size: 1.5rem;
            margin-right: 15px;
        }
        .network-info {
            flex: 1;
        }
        .network-name {
            font-weight: 500;
            margin-bottom: 3px;
        }
        .network-detail {
            font-size: 0.8rem;
            color: var(--text-dim);
        }
        .signal-bars {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 20px;
        }
        .signal-bar {
            width: 4px;
            background: var(--text-dim);
            border-radius: 2px;
        }
        .signal-bar.active {
            background: var(--accent);
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            font-size: 0.9rem;
            color: var(--text-dim);
            margin-bottom: 8px;
        }
        .form-group input {
            width: 100%;
            padding: 14px 16px;
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            background: var(--bg);
            color: var(--text);
            font-size: 1rem;
        }
        .form-group input:focus {
            outline: none;
            border-color: var(--accent);
        }
        .btn {
            width: 100%;
            padding: 16px;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: var(--accent);
            color: var(--bg);
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px var(--accent-dim);
        }
        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        .btn-secondary {
            background: transparent;
            color: var(--text);
            border: 2px solid rgba(255,255,255,0.2);
            margin-top: 10px;
        }
        .status {
            text-align: center;
            padding: 40px;
        }
        .status-icon {
            font-size: 4rem;
            margin-bottom: 20px;
        }
        .status h2 {
            margin-bottom: 10px;
        }
        .status p {
            color: var(--text-dim);
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid var(--card);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .error {
            background: rgba(239, 83, 80, 0.2);
            color: var(--danger);
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
        }
        .hidden { display: none; }
        .refresh-btn {
            background: none;
            border: none;
            color: var(--accent);
            cursor: pointer;
            font-size: 0.9rem;
            padding: 5px 10px;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-header h2 {
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🪞</div>
            <h1>SkyGlass Setup</h1>
            <p>Connect your mirror to WiFi</p>
        </div>

        <!-- Step 1: Select Network -->
        <div id="step-network" class="card">
            <div class="card-header">
                <h2>Select WiFi Network</h2>
                <button class="refresh-btn" onclick="scanNetworks()">🔄 Refresh</button>
            </div>
            <div id="network-list" class="network-list">
                <p style="color: var(--text-dim); text-align: center; padding: 20px;">
                    Scanning for networks...
                </p>
            </div>
            <button class="refresh-btn" onclick="otherNetwork()" style="margin-top: 10px;">Other network (hidden)…</button>
        </div>

        <!-- Step 2: Enter Password -->
        <div id="step-password" class="card hidden">
            <h2>Enter Password</h2>
            <div id="error-msg" class="error hidden"></div>
            <div class="form-group" id="known-ssid">
                <label>Network: <strong id="selected-network"></strong></label>
            </div>
            <div class="form-group hidden" id="hidden-ssid">
                <label for="ssid">Network name (SSID)</label>
                <input type="text" id="ssid" placeholder="Network name" autocomplete="off" autocapitalize="off">
            </div>
            <div class="form-group">
                <label for="password">WiFi Password</label>
                <input type="password" id="password" placeholder="Enter password" autocomplete="off">
            </div>
            <button class="btn btn-primary" onclick="connect()">Connect</button>
            <button class="btn btn-secondary" onclick="showNetworks()">Back</button>
        </div>

        <!-- Step 3: Connecting -->
        <div id="step-connecting" class="card hidden">
            <div class="status">
                <div class="spinner"></div>
                <h2>Connecting...</h2>
                <p>Please wait while we connect to your WiFi network</p>
            </div>
        </div>

        <!-- Step 4: Success -->
        <div id="step-success" class="card hidden">
            <div class="status">
                <div class="status-icon">📡</div>
                <h2>Joining your WiFi…</h2>
                <p>The mirror is leaving this network to join yours. Reconnect your phone to your home WiFi, then open the SkyGlass app to finish setup.</p>
                <p style="margin-top: 12px; font-size: 0.85rem; color: var(--text-dim);">
                    If the mirror can't join, the SkyGlass-Setup network comes back within a minute: rejoin it and try again.
                </p>
                <p style="margin-top: 20px; font-size: 0.85rem; color: var(--text-dim);">
                    The app finds the mirror automatically. Mirror address:<br>
                    <span style="color: var(--accent); font-family: monospace;" id="mirror-url">http://skyglass.local:3001</span>
                </p>
                <p style="margin-top: 5px; font-size: 0.8rem;" id="ip-address"></p>
            </div>
        </div>

        <!-- Step 5: Failed -->
        <div id="step-failed" class="card hidden">
            <div class="status">
                <div class="status-icon">❌</div>
                <h2>Connection Failed</h2>
                <p id="fail-reason">Could not connect to the network. Please check the password and try again.</p>
                <button class="btn btn-primary" onclick="showNetworks()" style="margin-top: 20px;">Try Again</button>
            </div>
        </div>
    </div>

    <script>
        let selectedNetwork = null;
        let networks = [];

        function showStep(step) {
            ['network', 'password', 'connecting', 'success', 'failed'].forEach(s => {
                document.getElementById('step-' + s).classList.toggle('hidden', s !== step);
            });
        }

        function createSignalBars(signal) {
            const bars = [
                signal >= 20,
                signal >= 40,
                signal >= 60,
                signal >= 80
            ];
            return `<div class="signal-bars">
                ${bars.map((active, i) =>
                    `<div class="signal-bar ${active ? 'active' : ''}" style="height: ${6 + i * 4}px"></div>`
                ).join('')}
            </div>`;
        }

        async function scanNetworks() {
            const list = document.getElementById('network-list');
            list.innerHTML = '<p style="color: var(--text-dim); text-align: center; padding: 20px;">Scanning...</p>';

            try {
                const response = await fetch('/api/wifi/scan');
                networks = await response.json();

                if (networks.length === 0) {
                    list.innerHTML = '<p style="color: var(--text-dim); text-align: center; padding: 20px;">No networks found</p>';
                    return;
                }

                list.innerHTML = networks.map((net, i) => `
                    <div class="network" onclick="selectNetwork(${i})">
                        <div class="network-icon">${net.security === 'open' ? '📶' : '🔒'}</div>
                        <div class="network-info">
                            <div class="network-name">${escapeHtml(net.ssid)}</div>
                            <div class="network-detail">${net.security === 'open' ? 'Open' : 'Secured'}</div>
                        </div>
                        ${createSignalBars(net.signal)}
                    </div>
                `).join('');

            } catch (error) {
                list.innerHTML = '<p style="color: var(--danger); text-align: center; padding: 20px;">Failed to scan networks</p>';
            }
        }

        function otherNetwork() {
            selectedNetwork = { ssid: '', security: 'unknown', hidden: true };
            document.getElementById('known-ssid').classList.add('hidden');
            document.getElementById('hidden-ssid').classList.remove('hidden');
            document.getElementById('ssid').value = '';
            document.getElementById('password').value = '';
            document.getElementById('error-msg').classList.add('hidden');
            showStep('password');
            document.getElementById('ssid').focus();
        }

        function selectNetwork(index) {
            document.getElementById('known-ssid').classList.remove('hidden');
            document.getElementById('hidden-ssid').classList.add('hidden');
            selectedNetwork = networks[index];
            document.getElementById('selected-network').textContent = selectedNetwork.ssid;
            document.getElementById('password').value = '';
            document.getElementById('error-msg').classList.add('hidden');

            if (selectedNetwork.security === 'open') {
                connect();
            } else {
                showStep('password');
                document.getElementById('password').focus();
            }
        }

        function showNetworks() {
            showStep('network');
            scanNetworks();
        }

        async function connect() {
            const password = document.getElementById('password').value;
            if (selectedNetwork.hidden) {
                selectedNetwork.ssid = document.getElementById('ssid').value;
                if (!selectedNetwork.ssid) {
                    document.getElementById('error-msg').textContent = 'Please enter the network name';
                    document.getElementById('error-msg').classList.remove('hidden');
                    return;
                }
            }

            if (selectedNetwork.security !== 'open' && !selectedNetwork.hidden && !password) {
                document.getElementById('error-msg').textContent = 'Please enter the WiFi password';
                document.getElementById('error-msg').classList.remove('hidden');
                return;
            }

            showStep('connecting');

            try {
                const response = await fetch('/api/wifi/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ssid: selectedNetwork.ssid,
                        password: password
                    })
                });

                const result = await response.json();

                if (result.success) {
                    // The join runs in the background and drops this hotspot.
                    showStep('success');
                } else {
                    document.getElementById('fail-reason').textContent =
                        result.error || 'Connection failed. Please check your password.';
                    showStep('failed');
                }
            } catch (error) {
                // The hotspot can drop before the answer arrives: the join has
                // most likely started.
                showStep('success');
            }
        }

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // Handle enter key in password field
        document.getElementById('password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') connect();
        });

        // Initial scan
        scanNetworks();
    </script>
</body>
</html>
"""


def create_flask_app(provisioning: WiFiProvisioning, use_captive_portal: bool = True) -> Flask:
    """Create the Flask app for the captive portal.

    Args:
        provisioning: WiFiProvisioning instance
        use_captive_portal: If True (default), redirect captive portal requests to
                           setup page. This auto-opens the browser on most phones.
                           If False, return "success" responses and users navigate manually.
    """
    app = Flask(__name__)

    @app.before_request
    def note_phone():
        # Any request means a phone is on the hotspot: don't take it down to
        # retry the saved network (WiFiProvisioning.phone_present)
        provisioning.note_request()

    @app.route('/')
    def index():
        return render_template_string(CAPTIVE_PORTAL_HTML)

    # Captive portal detection endpoints
    # By default, we redirect to our setup page which triggers phones to
    # auto-open a browser with our WiFi setup wizard.

    @app.route('/generate_204')
    @app.route('/gen_204')
    def android_captive_portal():
        """Android/Chrome captive portal detection.

        Android expects 204 for "no captive portal". Returning anything else
        (like a redirect or HTML) triggers the captive portal flow.
        """
        if use_captive_portal:
            # Return HTML instead of 204 to trigger captive portal
            return redirect('/')
        return '', 204

    @app.route('/hotspot-detect.html')
    @app.route('/library/test/success.html')
    def apple_captive_portal():
        """Apple iOS/macOS captive portal detection.

        Apple checks for the word "Success" in response body.
        Anything else triggers the captive portal sheet.
        """
        if use_captive_portal:
            return redirect('/')
        return '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>'

    @app.route('/ncsi.txt')
    def windows_ncsi():
        """Windows NCSI (Network Connectivity Status Indicator)."""
        if use_captive_portal:
            return redirect('/')
        return 'Microsoft NCSI'

    @app.route('/connecttest.txt')
    def windows_connect_test():
        """Windows connection test."""
        if use_captive_portal:
            return redirect('/')
        return 'Microsoft Connect Test'

    @app.route('/redirect')
    @app.route('/success.txt')
    def generic_captive_portal():
        """Generic captive portal detection."""
        if use_captive_portal:
            return redirect('/')
        return 'success'

    # ---- Phone app API (same paths as the backend on :3001) ----

    @app.route('/api/health')
    def api_health():
        return jsonify({'status': 'ok', 'provisioning': True})

    @app.route('/api/discovery')
    def api_discovery():
        mirror_id, name = mirror_identity()
        return jsonify({
            'mirrorId': mirror_id,
            'name': name,
            'version': 'setup',
            'provisioning': True,
            'setupComplete': False,
            'wifiConfigured': False,
            'port': 80,
            'wifi': provisioning.get_join_state(),
        })

    @app.route('/api/setup/status')
    def api_setup_status():
        # Everything after WiFi happens once the mirror is on the home network.
        return jsonify({
            'step': 'wifi',
            'wifiConfigured': False,
            'licenseActivated': False,
            'locationConfigured': False,
            'airportConfigured': False,
            'faceEnrolled': False,
            'setupComplete': False,
        })

    @app.route('/api/wifi/scan')
    def api_scan():
        networks = provisioning.scan_networks()
        return jsonify([
            {
                'ssid': n.ssid,
                'signal': n.signal,
                'security': n.security,
                'secure': n.secure,
                'connected': n.connected
            }
            for n in networks
        ])

    @app.route('/api/wifi/connect', methods=['POST'])
    def api_connect():
        data = request.get_json(silent=True) or {}
        ssid = data.get('ssid')
        password = data.get('password') or ''

        problem = ssid_problem(ssid) or password_problem(password)
        if problem:
            return jsonify({'success': False, 'error': problem, 'message': problem}), 400

        if not provisioning.start_join(ssid, password):
            message = 'Already joining a network'
            return jsonify({'success': False, 'error': message, 'message': message}), 409

        # The hotspot goes down in a moment; the app finds the mirror on the
        # home network by its id (see /api/discovery).
        return jsonify({'success': True, 'pending': True})

    @app.route('/api/wifi/status')
    def api_status():
        return jsonify({
            'configured': provisioning.is_wifi_configured(),
            'connected': provisioning._is_connected(),
            'ssid': provisioning._get_current_ssid(),
            'ip': provisioning.get_ip_address(),
            'join': provisioning.get_join_state(),
        })

    return app


def run_provisioning():
    """Main entry point for WiFi provisioning."""
    print("=" * 50)
    print("SkyGlass WiFi Provisioning")
    print("=" * 50)

    # Check if running as root
    if os.geteuid() != 0:
        print("ERROR: Must run as root (sudo)")
        sys.exit(1)

    # Check environment variable for captive portal mode
    # Default is True (auto-open browser on phone when it connects to hotspot)
    disable_captive = os.environ.get('DISABLE_CAPTIVE_PORTAL', '').lower() in ('1', 'true', 'yes')
    use_captive_portal = not disable_captive
    if use_captive_portal:
        print("Mode: Captive portal auto-redirect enabled (default)")
        print("      Phone browser should auto-open when connecting")
    else:
        print("Mode: Manual navigation")
        print(f"      Users scan QR code then open http://{AP_IP}")

    if not nm_wifi.NetworkManager.available():
        print("ERROR: nmcli not found; WiFi provisioning needs NetworkManager")
        sys.exit(1)

    provisioning = WiFiProvisioning()
    provisioning.captive_dns = use_captive_portal

    # Online already (the network came up after boot-mode.sh checked):
    # no hotspot; let boot-mode.sh start normal mode.
    if provisioning.is_wifi_configured():
        print("Already online; handing back to normal mode")
        print(f"Connected to: {provisioning._get_current_ssid()}")
        print(f"IP address: {provisioning.get_ip_address()}")
        provisioning.enter_normal_mode()
        sys.exit(0)

    # Start access point
    if not provisioning.start_ap():
        print("Failed to start access point")
        sys.exit(1)

    # Create Flask app
    app = create_flask_app(provisioning, use_captive_portal=use_captive_portal)

    # Retry saved networks now and then (mirror set up before, network away)
    Thread(target=provisioning.reconnect_loop, daemon=True).start()

    # Signal handler for clean shutdown
    def shutdown(sig, frame):
        print("\nShutting down...")
        provisioning.stop()
        provisioning.stop_ap()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Run Flask server
    print()
    print("=" * 50)
    print(f"Connect to WiFi: {AP_SSID}")
    print(f"Then open: http://{AP_IP}")
    print("=" * 50)
    print()

    try:
        app.run(host='0.0.0.0', port=80, debug=False, threaded=True)
    finally:
        provisioning.stop_ap()


if __name__ == "__main__":
    run_provisioning()
