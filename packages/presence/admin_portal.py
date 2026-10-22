"""
Slim admin portal for SkyGlass (Flask blueprint registered by web_server.py).

Mirror setup happens only in the phone app. This portal keeps:
- the WiFi API (/api/admin/wifi/status, /scan, /connect), which the backend's
  /api/wifi/* routes (packages/backend/src/routes/device.ts) call with the
  internal service token;
- a minimal /admin page (WiFi status + PM2 log viewer + password change) and
  /api/admin/logs, for an owner who has set an admin password on the device.

Access rules (docs/SECURITY.md): device controls need the internal token or an
admin session (+ CSRF check). With no admin password set the portal is off;
the first password is set on the device with set_admin_password.py.
"""

import os
import platform
import re
import subprocess
from collections import deque
from pathlib import Path

from flask import Blueprint, render_template_string, request, jsonify, session, redirect, url_for

import security
from auth import admin_page, device_auth_required, render_portal_disabled

admin = Blueprint('admin', __name__)

# PM2 writes each app's stdout/stderr to <install dir>/logs/<app>-{out,error}.log
# (config/pm2.config.cjs; SKYGLASS_DIR overrides the install dir there too).
LOG_DIR = Path(os.environ.get("SKYGLASS_DIR") or Path(__file__).resolve().parent.parent.parent) / "logs"
LOG_SOURCES = ("backend", "detector", "admin")
LOG_STREAMS = ("out", "error")
MAX_LOG_LINES = 1000

# Failed admin logins, per client address and overall (security.LoginLimiter).
login_limiter = security.LoginLimiter()


# ============================================================
# Dashboard HTML Template
# ============================================================

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass Admin</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f1a;
            color: #fff;
            padding: 24px 16px;
        }
        main { max-width: 960px; margin: 0 auto; display: grid; gap: 20px; }
        header { display: flex; justify-content: space-between; align-items: center; }
        header h1 { font-size: 1.4rem; font-weight: 400; }
        a { color: #4ecca3; }
        .card { background: #1a1a2e; border-radius: 12px; padding: 20px; }
        .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 12px; }
        .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
        .muted { color: #888; font-size: 0.9rem; }
        select, input, button {
            padding: 8px 12px;
            border: 1px solid #333;
            border-radius: 8px;
            background: #0f0f1a;
            color: #fff;
            font-size: 0.9rem;
        }
        button { background: #4ecca3; color: #0f0f1a; border: none; font-weight: 600; cursor: pointer; }
        pre {
            background: #0f0f1a;
            border-radius: 8px;
            padding: 12px;
            max-height: 480px;
            overflow: auto;
            font-size: 0.8rem;
            line-height: 1.4;
            white-space: pre-wrap;
            word-break: break-all;
        }
    </style>
</head>
<body>
<main>
    <header>
        <h1>SkyGlass Admin</h1>
        <form method="POST" action="{{ url_for('admin.logout') }}"><button type="submit">Log out</button></form>
    </header>
    <p class="muted">Mirror setup (location, widgets, faces, WiFi) is done in the SkyGlass phone app.
       The camera is only reachable during an enrollment session started from the app.</p>

    <section class="card">
        <h2>WiFi</h2>
        <div class="row">
            <span id="wifi-status" class="muted">Loading...</span>
            <button type="button" onclick="loadWifi()">Refresh</button>
        </div>
    </section>

    <section class="card">
        <h2>Logs</h2>
        <div class="row">
            <select id="log-source">
                <option value="backend">backend</option>
                <option value="detector">detector</option>
                <option value="admin">admin</option>
            </select>
            <select id="log-stream">
                <option value="out">out</option>
                <option value="error">error</option>
            </select>
            <select id="log-lines">
                <option>100</option>
                <option>500</option>
                <option>1000</option>
            </select>
            <button type="button" onclick="loadLogs()">Refresh</button>
        </div>
        <pre id="log-output">Loading...</pre>
    </section>

    <section class="card">
        <h2>Admin password</h2>
        <form class="row" onsubmit="changePassword(event)">
            <input type="password" id="pw-current" placeholder="Current password" autocomplete="current-password">
            <input type="password" id="pw-new" placeholder="New password (10+ characters)" autocomplete="new-password" minlength="10">
            <button type="submit">Save</button>
            <span id="pw-result" class="muted"></span>
        </form>
    </section>
</main>
<script>
    // Every request carries the CSRF header the server requires for
    // cookie-authenticated changes; a 401 means the session ended.
    async function getJson(url, options = {}) {
        const headers = Object.assign({ 'X-SkyGlass-Request': '1' }, options.headers || {});
        const res = await fetch(url, Object.assign({}, options, { headers, credentials: 'same-origin' }));
        if (res.status === 401) { window.location = '/admin/login'; throw new Error('signed out'); }
        return res.json();
    }

    async function loadWifi() {
        const el = document.getElementById('wifi-status');
        try {
            const s = await getJson('/api/admin/wifi/status');
            if (s.error) el.textContent = s.error;
            else if (s.connected) el.textContent = `Connected to ${s.ssid} (${s.ip || 'no IP'})`;
            else el.textContent = 'Not connected';
        } catch (e) {
            el.textContent = 'Failed to load WiFi status';
        }
    }

    async function loadLogs() {
        const source = document.getElementById('log-source').value;
        const stream = document.getElementById('log-stream').value;
        const lines = document.getElementById('log-lines').value;
        const out = document.getElementById('log-output');
        try {
            const data = await getJson(`/api/admin/logs?source=${source}&stream=${stream}&lines=${lines}`);
            out.textContent = data.error ? data.error : (data.logs.join('\\n') || '(empty)');
            out.scrollTop = out.scrollHeight;
        } catch (e) {
            out.textContent = 'Failed to load logs';
        }
    }

    async function changePassword(event) {
        event.preventDefault();
        const result = document.getElementById('pw-result');
        const data = await getJson('/api/admin/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_password: document.getElementById('pw-current').value,
                new_password: document.getElementById('pw-new').value,
            }),
        });
        result.textContent = data.success ? 'Saved. Sign in again with the new password.' : (data.error || 'Failed');
        if (data.success) setTimeout(() => { window.location = '/admin/login'; }, 1500);
    }

    document.getElementById('log-source').onchange = loadLogs;
    document.getElementById('log-stream').onchange = loadLogs;
    document.getElementById('log-lines').onchange = loadLogs;
    loadWifi();
    loadLogs();
</script>
</body>
</html>
"""


LOGIN_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass Login</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f1a;
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-card {
            background: #1a1a2e;
            padding: 40px;
            border-radius: 16px;
            width: 100%;
            max-width: 400px;
            text-align: center;
        }
        .logo { font-size: 3rem; margin-bottom: 20px; }
        h1 { font-size: 1.5rem; font-weight: 400; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; text-align: left; }
        .form-group label { display: block; font-size: 0.85rem; color: #888; margin-bottom: 8px; }
        .form-group input {
            width: 100%;
            padding: 12px 15px;
            border: 1px solid #333;
            border-radius: 8px;
            background: #0f0f1a;
            color: #fff;
            font-size: 1rem;
        }
        .form-group input:focus { outline: none; border-color: #4ecca3; }
        .btn {
            width: 100%;
            padding: 14px;
            background: #4ecca3;
            color: #0f0f1a;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
        }
        .btn:hover { transform: translateY(-2px); }
        .error { color: #ef5350; font-size: 0.9rem; margin-bottom: 15px; }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="logo">🪞</div>
        <h1>SkyGlass Admin</h1>
        {% if error %}
        <div class="error">{{ error }}</div>
        {% endif %}
        <form method="POST">
            <div class="form-group">
                <label>Password</label>
                <input type="password" name="password" placeholder="Enter admin password" autofocus>
            </div>
            <button type="submit" class="btn">Login</button>
        </form>
    </div>
</body>
</html>
"""

# ============================================================
# Routes
# ============================================================

@admin.route('/admin')
@admin_page
def dashboard():
    """Minimal admin page: WiFi status, logs, password."""
    return render_template_string(DASHBOARD_HTML)


@admin.route('/admin/login', methods=['GET', 'POST'])
def login_page():
    """Login page. Off (explanatory page) until a password is set on the device."""
    if not security.is_password_set():
        return render_portal_disabled()
    if request.method == 'GET':
        return render_template_string(LOGIN_HTML, error=None)

    # Login CSRF: the form must be posted from this origin.
    if not security.same_origin(request):
        return render_template_string(LOGIN_HTML, error="Request refused"), 403

    client = request.remote_addr or "unknown"
    wait = login_limiter.retry_after(client)
    if wait:
        minutes = max(1, (wait + 59) // 60)
        resp = render_template_string(
            LOGIN_HTML, error=f"Too many failed attempts. Try again in {minutes} min."
        ), 429, {"Retry-After": str(wait)}
        return resp

    password = request.form.get('password', '')
    if security.verify_password(password, security.read_password_hash()):
        login_limiter.record_success(client)
        security.start_admin_session(session)
        return redirect(url_for('admin.dashboard'))

    login_limiter.record_failure(client)
    return render_template_string(LOGIN_HTML, error="Invalid password"), 401


@admin.route('/admin/logout', methods=['POST'])
def logout():
    """Logout (POST from the dashboard form)."""
    session.clear()
    return redirect(url_for('admin.login_page'))


# ============================================================
# API Endpoints
# ============================================================

@admin.route('/api/admin/logs')
@device_auth_required
def api_logs():
    """Tail a PM2 log file: ?source=backend|detector|admin&stream=out|error&lines=N."""
    source = request.args.get('source', 'backend')
    stream = request.args.get('stream', 'out')
    if source not in LOG_SOURCES or stream not in LOG_STREAMS:
        return jsonify({
            "error": f"source must be one of {', '.join(LOG_SOURCES)}; stream one of {', '.join(LOG_STREAMS)}",
        }), 400
    try:
        lines = max(1, min(MAX_LOG_LINES, int(request.args.get('lines', 100))))
    except ValueError:
        return jsonify({"error": "lines must be an integer"}), 400

    log_file = LOG_DIR / f"{source}-{stream}.log"
    if not log_file.is_file():
        return jsonify({"logs": [], "error": f"Log file not found: {log_file}"})
    try:
        with open(log_file, 'r', errors='replace') as f:
            tail = deque(f, maxlen=lines)
    except OSError as e:
        return jsonify({"logs": [], "error": f"Error reading {log_file}: {e}"})
    return jsonify({"logs": [line.rstrip('\n') for line in tail]})


@admin.route('/api/admin/wifi/status')
@device_auth_required
def api_wifi_status():
    """Get current WiFi status."""
    if platform.system() != 'Linux':
        return jsonify({"connected": False, "error": "WiFi management only on Linux"})

    try:
        result = subprocess.run(['iwgetid', '-r'], capture_output=True, text=True, timeout=5)
        ssid = result.stdout.strip()

        result = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=5)
        ip = result.stdout.strip().split()[0] if result.stdout.strip() else ''

        return jsonify({
            "connected": bool(ssid),
            "ssid": ssid,
            "ip": ip
        })
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)})


@admin.route('/api/admin/wifi/scan')
@device_auth_required
def api_wifi_scan():
    """Scan for WiFi networks."""
    if platform.system() != 'Linux':
        return jsonify({"networks": [], "error": "WiFi scan only on Linux"})

    try:
        result = subprocess.run(
            ['sudo', 'iwlist', 'wlan0', 'scan'],
            capture_output=True, text=True, timeout=30
        )

        networks = []
        current_signal = 0

        for line in result.stdout.split('\n'):
            if 'ESSID:' in line:
                ssid = line.split('ESSID:')[1].strip().strip('"')
                if ssid and ssid not in [n['ssid'] for n in networks]:
                    networks.append({
                        'ssid': ssid,
                        'signal': current_signal,
                        'connected': False
                    })
            elif 'Signal level' in line:
                try:
                    # Parse signal level (varies by system)
                    if 'dBm' in line:
                        dbm = int(line.split('Signal level=')[1].split(' ')[0])
                        current_signal = max(0, min(100, 2 * (dbm + 100)))
                    else:
                        current_signal = int(line.split('Signal level=')[1].split('/')[0])
                except (IndexError, ValueError):
                    current_signal = 50

        return jsonify({"networks": sorted(networks, key=lambda x: -x['signal'])})
    except Exception as e:
        return jsonify({"networks": [], "error": str(e)})


# SSID: 1-32 bytes. Passphrase: empty (open network) or 8-63 printable ASCII.
_PASSPHRASE_RE = re.compile(r"^[\x20-\x7e]{8,63}$")


def wpa_psk(ssid: str, passphrase: str) -> str:
    """WPA2 PSK (hex) for ``passphrase``, as wpa_passphrase computes it."""
    import hashlib
    return hashlib.pbkdf2_hmac("sha1", passphrase.encode("ascii"), ssid.encode("utf-8"), 4096, 32).hex()


@admin.route('/api/admin/wifi/connect', methods=['POST'])
@device_auth_required
def api_wifi_connect():
    """Connect to a WiFi network.

    SSID and key are passed to wpa_cli hex-encoded / as a PSK, so no quoting
    is involved and nothing in them can inject wpa_supplicant directives.
    """
    data = request.get_json(silent=True) or {}
    ssid = data.get('ssid')
    password = data.get('password') or ''

    if not isinstance(ssid, str) or not ssid or len(ssid.encode('utf-8')) > 32 or '\x00' in ssid:
        return jsonify({"success": False, "error": "SSID must be 1-32 bytes"}), 400
    if not isinstance(password, str) or (password and not _PASSPHRASE_RE.fullmatch(password)):
        return jsonify({"success": False, "error": "Password must be 8-63 printable ASCII characters"}), 400

    if platform.system() != 'Linux':
        return jsonify({"success": False, "error": "WiFi only on Linux"})

    def wpa_cli(*args: str) -> str:
        result = subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', *args],
            capture_output=True, text=True, timeout=10,
        )
        return result.stdout.strip()

    try:
        # add_network prints the new network id; configure that id, not 0.
        match = re.search(r'^(\d+)$', wpa_cli('add_network'), re.MULTILINE)
        if not match:
            return jsonify({"success": False, "error": "wpa_cli add_network failed"})
        net_id = match.group(1)
        wpa_cli('set_network', net_id, 'ssid', ssid.encode('utf-8').hex())
        if password:
            wpa_cli('set_network', net_id, 'psk', wpa_psk(ssid, password))
        else:
            wpa_cli('set_network', net_id, 'key_mgmt', 'NONE')
        wpa_cli('enable_network', net_id)
        wpa_cli('save_config')
        return jsonify({"success": True})
    except (OSError, subprocess.SubprocessError) as e:
        return jsonify({"success": False, "error": str(e)})


@admin.route('/api/admin/password', methods=['POST'])
@device_auth_required
def api_change_password():
    """Change the admin password.

    From an admin session the current password is required. With the internal
    token (backend, server to server) it is not; the backend exposes no route
    for this today. A password can never be removed over the network (use
    ``set_admin_password.py --clear`` on the device).
    """
    data = request.get_json(silent=True) or {}
    new_pass = data.get('new_password')

    if not security.has_internal_token(request):
        current = data.get('current_password', '')
        client = request.remote_addr or "unknown"
        if login_limiter.retry_after(client):
            return jsonify({"success": False, "error": "Too many failed attempts"}), 429
        if not security.verify_password(current, security.read_password_hash()):
            login_limiter.record_failure(client)
            return jsonify({"success": False, "error": "Current password incorrect"}), 403

    problem = security.password_problem(new_pass)
    if problem:
        return jsonify({"success": False, "error": problem}), 400
    security.store_password(new_pass)
    # Every existing session (including this one) is now invalid.
    session.clear()
    return jsonify({"success": True})
