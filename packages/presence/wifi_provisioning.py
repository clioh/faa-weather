#!/usr/bin/env python3
"""
WiFi Provisioning Service for SkyGlass.

Creates a WiFi hotspot with a captive portal for initial device setup.
When the device has no WiFi configured, it:
1. Creates an access point "SkyGlass-Setup"
2. Runs a captive portal web server
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

Usage:
    sudo python wifi_provisioning.py

Requirements (installed by setup-pi.sh):
    - hostapd (creates access point)
    - dnsmasq (DHCP + DNS for captive portal)
"""

import os
import sys
import socket
import sqlite3
import subprocess
import time
import signal
import re
import uuid
from pathlib import Path
from typing import Optional, List, Tuple
from dataclasses import dataclass
from threading import Lock, Thread

from flask import Flask, render_template_string, request, jsonify, redirect

# Constants
AP_SSID = "SkyGlass-Setup"
AP_PASSWORD = ""  # Open network for easy setup
AP_CHANNEL = 7
# Using 10.42.0.x subnet - less likely to conflict with home networks
# (most home routers use 192.168.0.x or 192.168.1.x)
AP_IP = "10.42.0.1"
AP_NETMASK = "255.255.255.0"
AP_DHCP_START = "10.42.0.10"
AP_DHCP_END = "10.42.0.50"

WPA_SUPPLICANT_CONF = "/etc/wpa_supplicant/wpa_supplicant.conf"
HOSTAPD_CONF = "/tmp/skyglass_hostapd.conf"
DNSMASQ_CONF = "/tmp/skyglass_dnsmasq.conf"

PROVISIONING_COMPLETE_FLAG = Path(__file__).parent / "face_data" / ".wifi_configured"
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
# Seconds between answering POST /api/wifi/connect and dropping the hotspot,
# so the response reaches the phone first.
JOIN_DELAY_SECONDS = 2


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


def ssid_problem(ssid: object) -> Optional[str]:
    """Why an SSID can't be used, or None. It ends up in wpa_supplicant.conf."""
    if not isinstance(ssid, str) or not ssid:
        return "SSID required"
    if len(ssid.encode("utf-8")) > 32:
        return "SSID must be 1-32 bytes"
    if any(c in ssid for c in '"\n\r\x00'):
        return "SSID contains unsupported characters"
    return None


def password_problem(password: object) -> Optional[str]:
    """Empty (open network) or a WPA passphrase of 8-63 printable ASCII characters."""
    if not isinstance(password, str):
        return "Password must be text"
    if password and not re.fullmatch(r"[\x20-\x7e]{8,63}", password):
        return "WiFi passwords are 8-63 characters"
    return None


@dataclass
class WiFiNetwork:
    """Represents a discovered WiFi network."""
    ssid: str
    signal: int  # Signal strength 0-100
    security: str  # "open", "wpa", "wpa2", etc.
    connected: bool = False


class WiFiProvisioning:
    """Manages WiFi provisioning via captive portal."""

    def __init__(self, interface: str = "wlan0"):
        self.interface = interface
        self.ap_active = False
        self.flask_app: Optional[Flask] = None
        self.server_thread: Optional[Thread] = None
        self.running = False
        # Progress of the last join started from the app or captive portal.
        self._join_lock = Lock()
        self.join_state = {"state": "idle", "ssid": None, "error": None}
        self.last_join_error: Optional[str] = None

    def is_wifi_configured(self) -> bool:
        """Check if WiFi credentials are already configured."""
        # Check our flag file first
        if PROVISIONING_COMPLETE_FLAG.exists():
            # Verify we're actually connected
            if self._is_connected():
                return True

        # Check wpa_supplicant for configured networks
        try:
            if Path(WPA_SUPPLICANT_CONF).exists():
                content = Path(WPA_SUPPLICANT_CONF).read_text()
                if "network=" in content and "ssid=" in content:
                    return True
        except PermissionError:
            pass

        return False

    def _is_connected(self) -> bool:
        """Check if currently connected to a WiFi network."""
        try:
            result = subprocess.run(
                ["iwgetid", "-r"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return bool(result.stdout.strip())
        except Exception:
            return False

    def _get_current_ssid(self) -> Optional[str]:
        """Get currently connected SSID."""
        try:
            result = subprocess.run(
                ["iwgetid", "-r"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.stdout.strip() or None
        except Exception:
            return None

    def scan_networks(self) -> List[WiFiNetwork]:
        """Scan for available WiFi networks."""
        networks = []
        current_ssid = self._get_current_ssid()

        try:
            # Bring interface up if needed
            subprocess.run(
                ["sudo", "ip", "link", "set", self.interface, "up"],
                capture_output=True,
                timeout=5
            )

            # Scan for networks
            result = subprocess.run(
                ["sudo", "iwlist", self.interface, "scan"],
                capture_output=True,
                text=True,
                timeout=30
            )

            # Parse scan results
            current_cell = {}
            for line in result.stdout.split('\n'):
                line = line.strip()

                if line.startswith("Cell "):
                    if current_cell.get("ssid"):
                        networks.append(WiFiNetwork(
                            ssid=current_cell["ssid"],
                            signal=current_cell.get("signal", 0),
                            security=current_cell.get("security", "open"),
                            connected=current_cell["ssid"] == current_ssid
                        ))
                    current_cell = {}

                elif "ESSID:" in line:
                    ssid = line.split('ESSID:')[1].strip().strip('"')
                    if ssid:  # Skip hidden networks
                        current_cell["ssid"] = ssid

                elif "Signal level=" in line:
                    try:
                        if "dBm" in line:
                            dbm = int(re.search(r'Signal level=(-?\d+)', line).group(1))
                            current_cell["signal"] = max(0, min(100, 2 * (dbm + 100)))
                        else:
                            match = re.search(r'Signal level=(\d+)/(\d+)', line)
                            if match:
                                current_cell["signal"] = int(100 * int(match.group(1)) / int(match.group(2)))
                    except Exception:
                        current_cell["signal"] = 50

                elif "Encryption key:" in line:
                    if "on" in line.lower():
                        current_cell["security"] = "wpa"
                    else:
                        current_cell["security"] = "open"

                elif "WPA" in line or "WPA2" in line:
                    current_cell["security"] = "wpa2"

            # Don't forget the last cell
            if current_cell.get("ssid"):
                networks.append(WiFiNetwork(
                    ssid=current_cell["ssid"],
                    signal=current_cell.get("signal", 0),
                    security=current_cell.get("security", "open"),
                    connected=current_cell["ssid"] == current_ssid
                ))

        except Exception as e:
            print(f"Scan error: {e}")

        # Remove duplicates and sort by signal strength
        seen = set()
        unique_networks = []
        for net in sorted(networks, key=lambda x: -x.signal):
            if net.ssid not in seen:
                seen.add(net.ssid)
                unique_networks.append(net)

        return unique_networks

    def start_ap(self) -> bool:
        """Start the WiFi access point."""
        print(f"Starting access point: {AP_SSID}")

        try:
            # Stop any existing network services
            subprocess.run(["sudo", "systemctl", "stop", "wpa_supplicant"], capture_output=True)
            subprocess.run(["sudo", "systemctl", "stop", "dhcpcd"], capture_output=True)
            subprocess.run(["sudo", "killall", "hostapd"], capture_output=True)
            subprocess.run(["sudo", "killall", "dnsmasq"], capture_output=True)
            time.sleep(1)

            # Configure interface
            subprocess.run([
                "sudo", "ip", "addr", "flush", "dev", self.interface
            ], capture_output=True)
            subprocess.run([
                "sudo", "ip", "addr", "add", f"{AP_IP}/24", "dev", self.interface
            ], capture_output=True)
            subprocess.run([
                "sudo", "ip", "link", "set", self.interface, "up"
            ], capture_output=True)

            # Create hostapd config
            hostapd_config = f"""
interface={self.interface}
driver=nl80211
ssid={AP_SSID}
hw_mode=g
channel={AP_CHANNEL}
wmm_enabled=0
macaddr_acl=0
auth_algs=1
ignore_broadcast_ssid=0
wpa=0
"""
            Path(HOSTAPD_CONF).write_text(hostapd_config)

            # Create dnsmasq config (DHCP + DNS redirect for captive portal)
            dnsmasq_config = f"""
interface={self.interface}
dhcp-range={AP_DHCP_START},{AP_DHCP_END},{AP_NETMASK},24h
address=/#/{AP_IP}
"""
            Path(DNSMASQ_CONF).write_text(dnsmasq_config)

            # Start hostapd
            subprocess.Popen(
                ["sudo", "hostapd", HOSTAPD_CONF],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(2)

            # Start dnsmasq
            subprocess.Popen(
                ["sudo", "dnsmasq", "-C", DNSMASQ_CONF, "-x", "/tmp/dnsmasq.pid"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            time.sleep(1)

            self.ap_active = True
            print(f"Access point started: {AP_SSID}")
            print(f"Connect to WiFi '{AP_SSID}' and open http://{AP_IP}")
            return True

        except Exception as e:
            print(f"Failed to start AP: {e}")
            return False

    def stop_ap(self):
        """Stop the access point and restore normal networking."""
        if not self.ap_active:
            # Already on the home network (e.g. stopped by boot-mode.sh after
            # a successful join): flushing wlan0 now would drop that link.
            return
        print("Stopping access point...")

        try:
            # Stop hostapd and dnsmasq
            subprocess.run(["sudo", "killall", "hostapd"], capture_output=True)
            subprocess.run(["sudo", "killall", "dnsmasq"], capture_output=True)

            # Clean up config files
            Path(HOSTAPD_CONF).unlink(missing_ok=True)
            Path(DNSMASQ_CONF).unlink(missing_ok=True)

            # Reset interface
            subprocess.run([
                "sudo", "ip", "addr", "flush", "dev", self.interface
            ], capture_output=True)

            # Restart normal networking
            subprocess.run(["sudo", "systemctl", "start", "dhcpcd"], capture_output=True)
            subprocess.run(["sudo", "systemctl", "start", "wpa_supplicant"], capture_output=True)

            self.ap_active = False
            print("Access point stopped")

        except Exception as e:
            print(f"Error stopping AP: {e}")

    def connect_to_network(self, ssid: str, password: str) -> bool:
        """Connect to a WiFi network."""
        print(f"Connecting to: {ssid}")

        try:
            # Stop AP mode
            self.stop_ap()
            time.sleep(2)

            # Create wpa_supplicant entry
            if password:
                # Use wpa_passphrase to generate secure config
                result = subprocess.run(
                    ["wpa_passphrase", ssid, password],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                network_block = result.stdout
            else:
                network_block = f'''
network={{
    ssid="{ssid}"
    key_mgmt=NONE
}}
'''

            # Read existing config
            wpa_conf = Path(WPA_SUPPLICANT_CONF)
            if wpa_conf.exists():
                existing = wpa_conf.read_text()
                # Remove any existing network blocks for this SSID
                existing = re.sub(
                    rf'network=\s*\{{[^}}]*ssid="{re.escape(ssid)}"[^}}]*\}}',
                    '',
                    existing
                )
            else:
                existing = """ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=US

"""

            # Append new network
            new_config = existing.strip() + "\n\n" + network_block.strip() + "\n"

            # Write config
            subprocess.run(
                ["sudo", "tee", WPA_SUPPLICANT_CONF],
                input=new_config.encode(),
                capture_output=True
            )

            # Restart wpa_supplicant
            subprocess.run(["sudo", "systemctl", "restart", "wpa_supplicant"], capture_output=True)
            subprocess.run(["sudo", "systemctl", "restart", "dhcpcd"], capture_output=True)

            # Wait for connection
            print("Waiting for connection...")
            for i in range(30):
                time.sleep(1)
                if self._is_connected():
                    current = self._get_current_ssid()
                    if current == ssid:
                        print(f"Connected to {ssid}!")
                        # Mark provisioning complete
                        PROVISIONING_COMPLETE_FLAG.parent.mkdir(parents=True, exist_ok=True)
                        PROVISIONING_COMPLETE_FLAG.write_text(ssid)
                        return True

            print("Connection timeout")
            self.last_join_error = (
                f"The mirror couldn't join \"{ssid}\" within 30 seconds. "
                "Check the password and that the network has a 2.4 GHz band."
            )
            return False

        except Exception as e:
            print(f"Connection error: {e}")
            self.last_join_error = f"Connection error: {e}"
            return False

    def get_join_state(self) -> dict:
        with self._join_lock:
            return dict(self.join_state)

    def start_join(self, ssid: str, password: str) -> bool:
        """Join ``ssid`` in the background. False if a join is already running."""
        with self._join_lock:
            if self.join_state["state"] == "connecting":
                return False
            self.join_state = {"state": "connecting", "ssid": ssid, "error": None}
        Thread(target=self._join, args=(ssid, password), daemon=True).start()
        return True

    def _join(self, ssid: str, password: str) -> None:
        time.sleep(JOIN_DELAY_SECONDS)
        self.last_join_error = None
        ok = self.connect_to_network(ssid, password)
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
            self.start_ap()

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
        """Get current IP address."""
        try:
            result = subprocess.run(
                ["hostname", "-I"],
                capture_output=True,
                text=True,
                timeout=5
            )
            ips = result.stdout.strip().split()
            # Return first non-AP IP
            for ip in ips:
                if not ip.startswith("10.42.0."):
                    return ip
            return ips[0] if ips else None
        except Exception:
            return None


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
        </div>

        <!-- Step 2: Enter Password -->
        <div id="step-password" class="card hidden">
            <h2>Enter Password</h2>
            <div id="error-msg" class="error hidden"></div>
            <div class="form-group">
                <label>Network: <strong id="selected-network"></strong></label>
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

        function selectNetwork(index) {
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

            if (selectedNetwork.security !== 'open' && !password) {
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
                'secure': n.security != 'open',
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

    provisioning = WiFiProvisioning()

    # Check if already configured
    if provisioning.is_wifi_configured():
        print("WiFi is already configured!")
        print(f"Connected to: {provisioning._get_current_ssid()}")
        print(f"IP address: {provisioning.get_ip_address()}")
        print()
        print("To reconfigure, delete the flag file:")
        print(f"  rm {PROVISIONING_COMPLETE_FLAG}")
        sys.exit(0)

    # Start access point
    if not provisioning.start_ap():
        print("Failed to start access point")
        sys.exit(1)

    # Create Flask app
    app = create_flask_app(provisioning, use_captive_portal=use_captive_portal)

    # Signal handler for clean shutdown
    def shutdown(sig, frame):
        print("\nShutting down...")
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
