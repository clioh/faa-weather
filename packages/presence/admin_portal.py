"""
Admin Portal for SkyGlass.

Provides a polished web interface for configuration and monitoring.
"""

import os
import subprocess
import platform
import hashlib
import secrets
from pathlib import Path
from functools import wraps
from datetime import datetime, timedelta

from flask import Blueprint, render_template_string, request, jsonify, session, redirect, url_for

admin = Blueprint('admin', __name__)

# Session configuration
ADMIN_PASSWORD_FILE = Path(__file__).parent / "face_data" / ".admin_password"
SETUP_COMPLETE_FILE = Path(__file__).parent / "face_data" / ".setup_complete"
SESSION_TIMEOUT = timedelta(hours=24)

# ============================================================
# Authentication
# ============================================================

def hash_password(password: str) -> str:
    """Hash a password with salt."""
    salt = secrets.token_hex(16)
    hashed = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{hashed}"

def verify_password(password: str, stored: str) -> bool:
    """Verify a password against stored hash."""
    try:
        salt, hashed = stored.split(":")
        return hashlib.sha256((salt + password).encode()).hexdigest() == hashed
    except:
        return False

def get_stored_password() -> str | None:
    """Get stored admin password hash."""
    if ADMIN_PASSWORD_FILE.exists():
        return ADMIN_PASSWORD_FILE.read_text().strip()
    return None

def set_admin_password(password: str):
    """Set admin password."""
    ADMIN_PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    ADMIN_PASSWORD_FILE.write_text(hash_password(password))

def is_password_set() -> bool:
    """Check if admin password is configured."""
    return ADMIN_PASSWORD_FILE.exists()

def is_setup_complete() -> bool:
    """Check if initial setup has been completed."""
    return SETUP_COMPLETE_FILE.exists()

def mark_setup_complete():
    """Mark setup as complete."""
    SETUP_COMPLETE_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETUP_COMPLETE_FILE.write_text(datetime.now().isoformat())

def login_required(f):
    """Decorator to require login for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Skip auth if no password is set
        if not is_password_set():
            return f(*args, **kwargs)
        # Check session
        if not session.get('authenticated'):
            if request.is_json:
                return jsonify({"error": "Authentication required"}), 401
            return redirect(url_for('admin.login_page'))
        return f(*args, **kwargs)
    return decorated_function


# ============================================================
# Dashboard HTML Template
# ============================================================

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>SkyGlass Admin</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪞</text></svg>">
    <style>
        :root {
            --bg-primary: #0f0f1a;
            --bg-secondary: #1a1a2e;
            --bg-card: #242442;
            --accent: #4ecca3;
            --accent-dim: rgba(78, 204, 163, 0.2);
            --text: #ffffff;
            --text-dim: #8888aa;
            --danger: #ef5350;
            --warning: #ffa726;
            --success: #4ecca3;
            --border: rgba(255,255,255,0.1);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text);
            min-height: 100vh;
        }

        /* Layout */
        .app { display: flex; min-height: 100vh; }
        .sidebar {
            width: 260px;
            background: var(--bg-secondary);
            padding: 20px 0;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--border);
        }
        .main { flex: 1; overflow-y: auto; }
        .content { padding: 30px; max-width: 1200px; margin: 0 auto; }

        /* Sidebar */
        .logo {
            padding: 0 20px 20px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 20px;
        }
        .logo h1 {
            font-size: 1.25rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .logo h1 span { font-size: 1.5rem; }
        .logo p { font-size: 0.75rem; color: var(--text-dim); margin-top: 5px; }

        .nav { flex: 1; }
        .nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 20px;
            color: var(--text-dim);
            text-decoration: none;
            transition: all 0.2s;
            cursor: pointer;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            font-size: 0.95rem;
        }
        .nav-item:hover { background: var(--accent-dim); color: var(--text); }
        .nav-item.active { background: var(--accent-dim); color: var(--accent); border-right: 3px solid var(--accent); }
        .nav-item .icon { font-size: 1.2rem; width: 24px; text-align: center; }

        .nav-section {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: var(--text-dim);
            padding: 20px 20px 10px;
        }

        .sidebar-footer {
            padding: 15px 20px;
            border-top: 1px solid var(--border);
            font-size: 0.75rem;
            color: var(--text-dim);
        }

        /* Header */
        .header {
            background: var(--bg-secondary);
            padding: 20px 30px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h2 { font-size: 1.5rem; font-weight: 400; }
        .header-actions { display: flex; gap: 10px; }

        /* Cards */
        .card {
            background: var(--bg-card);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .card-title {
            font-size: 1rem;
            font-weight: 500;
            color: var(--accent);
        }

        /* Status Grid */
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .status-card {
            background: var(--bg-secondary);
            border-radius: 10px;
            padding: 20px;
            text-align: center;
        }
        .status-card .icon { font-size: 2rem; margin-bottom: 10px; }
        .status-card .label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; }
        .status-card .value { font-size: 1.5rem; font-weight: 300; margin-top: 5px; }
        .status-card .value.online { color: var(--success); }
        .status-card .value.offline { color: var(--danger); }

        /* Forms */
        .form-group { margin-bottom: 20px; }
        .form-group label {
            display: block;
            font-size: 0.85rem;
            color: var(--text-dim);
            margin-bottom: 8px;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 12px 15px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-primary);
            color: var(--text);
            font-size: 1rem;
            transition: border-color 0.2s;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: var(--accent);
        }
        .form-group .hint {
            font-size: 0.75rem;
            color: var(--text-dim);
            margin-top: 5px;
        }
        .form-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        /* Buttons */
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .btn-primary { background: var(--accent); color: var(--bg-primary); font-weight: 600; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 4px 15px var(--accent-dim); }
        .btn-secondary { background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border); }
        .btn-secondary:hover { border-color: var(--accent); }
        .btn-danger { background: var(--danger); color: white; }
        .btn-sm { padding: 8px 16px; font-size: 0.85rem; }

        /* Quick Actions */
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
        }
        .quick-action {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
        }
        .quick-action:hover {
            border-color: var(--accent);
            transform: translateY(-2px);
        }
        .quick-action .icon { font-size: 2rem; margin-bottom: 10px; }
        .quick-action .label { font-size: 0.85rem; color: var(--text-dim); }

        /* Logs */
        .log-viewer {
            background: #000;
            border-radius: 8px;
            padding: 15px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.8rem;
            max-height: 400px;
            overflow-y: auto;
            line-height: 1.6;
        }
        .log-line { white-space: pre-wrap; word-break: break-all; }
        .log-line.error { color: var(--danger); }
        .log-line.warn { color: var(--warning); }
        .log-line.info { color: var(--text-dim); }

        /* Toast */
        .toast {
            position: fixed;
            bottom: 30px;
            right: 30px;
            padding: 15px 25px;
            background: var(--accent);
            color: var(--bg-primary);
            border-radius: 10px;
            font-weight: 500;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s;
            z-index: 1000;
        }
        .toast.show { transform: translateY(0); opacity: 1; }
        .toast.error { background: var(--danger); color: white; }

        /* Pages */
        .page { display: none; }
        .page.active { display: block; }

        /* WiFi */
        .wifi-network {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            background: var(--bg-secondary);
            border-radius: 8px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .wifi-network:hover { background: var(--accent-dim); }
        .wifi-network .ssid { flex: 1; }
        .wifi-network .signal { color: var(--text-dim); }
        .wifi-network.connected { border-left: 3px solid var(--accent); }

        /* Responsive */
        @media (max-width: 768px) {
            .sidebar {
                position: fixed;
                left: -260px;
                top: 0;
                bottom: 0;
                z-index: 100;
                transition: left 0.3s;
            }
            .sidebar.open { left: 0; }
            .mobile-header {
                display: flex;
                align-items: center;
                padding: 15px;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border);
            }
            .menu-toggle {
                background: none;
                border: none;
                color: var(--text);
                font-size: 1.5rem;
                cursor: pointer;
                margin-right: 15px;
            }
            .content { padding: 15px; }
            .header { display: none; }
        }
        @media (min-width: 769px) {
            .mobile-header { display: none; }
        }

        /* Layout Editor */
        .layout-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            grid-template-rows: repeat(3, 100px);
            gap: 10px;
            background: var(--bg-primary);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .grid-cell {
            background: var(--bg-secondary);
            border: 2px dashed var(--border);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            position: relative;
        }
        .grid-cell:hover { border-color: var(--accent); }
        .grid-cell.has-widget { border-style: solid; border-color: var(--accent); }
        .grid-cell .cell-label {
            font-size: 0.7rem;
            color: var(--text-dim);
            position: absolute;
            top: 5px;
            left: 8px;
        }
        .grid-cell .widget-chip {
            background: var(--accent);
            color: var(--bg-primary);
            padding: 8px 12px;
            border-radius: 6px;
            cursor: move;
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            font-weight: 500;
        }
        .grid-cell .widget-chip:hover { transform: scale(1.05); }

        .widget-palette {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }
        .palette-widget {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            padding: 10px 15px;
            border-radius: 8px;
            cursor: grab;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        .palette-widget:hover { border-color: var(--accent); background: var(--accent-dim); }
        .palette-widget.disabled { opacity: 0.5; cursor: not-allowed; }
        .palette-widget .widget-icon { font-size: 1.2rem; }
        .palette-widget .widget-name { font-size: 0.9rem; }

        /* Modal */
        .modal {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .modal-content {
            background: var(--bg-card);
            border-radius: 12px;
            width: 90%;
            max-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-header {
            padding: 15px 20px;
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modal-header h3 { font-size: 1.1rem; margin: 0; }
        .modal-close {
            background: none;
            border: none;
            color: var(--text-dim);
            font-size: 1.5rem;
            cursor: pointer;
        }
        .modal-body { padding: 20px; }
        .modal-footer {
            padding: 15px 20px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
        }

        /* Animations */
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .spinning { animation: spin 1s linear infinite; }
    </style>
</head>
<body>
    <div class="app">
        <!-- Sidebar -->
        <aside class="sidebar" id="sidebar">
            <div class="logo">
                <h1><span>🪞</span> SkyGlass</h1>
                <p>Admin Portal</p>
            </div>

            <nav class="nav">
                <button class="nav-item active" data-page="dashboard">
                    <span class="icon">📊</span> Dashboard
                </button>
                <button class="nav-item" data-page="settings">
                    <span class="icon">⚙️</span> Settings
                </button>
                <button class="nav-item" data-page="registration">
                    <span class="icon">👤</span> Face Registration
                </button>
                <button class="nav-item" data-page="layout">
                    <span class="icon">📐</span> Widget Layout
                </button>

                <div class="nav-section">System</div>
                <button class="nav-item" data-page="wifi">
                    <span class="icon">📶</span> WiFi
                </button>
                <button class="nav-item" data-page="logs">
                    <span class="icon">📝</span> Logs
                </button>
                <button class="nav-item" data-page="updates">
                    <span class="icon">🔄</span> Updates
                </button>
                <button class="nav-item" data-page="security">
                    <span class="icon">🔒</span> Security
                </button>
            </nav>

            <div class="sidebar-footer">
                <div id="system-ip">IP: Loading...</div>
                <div id="system-uptime">Uptime: --</div>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="main">
            <!-- Mobile Header -->
            <div class="mobile-header">
                <button class="menu-toggle" onclick="toggleSidebar()">☰</button>
                <h1 style="font-size: 1.1rem;">SkyGlass Admin</h1>
            </div>

            <!-- Dashboard Page -->
            <div id="dashboard" class="page active">
                <div class="header">
                    <h2>Dashboard</h2>
                    <div class="header-actions">
                        <button class="btn btn-secondary btn-sm" onclick="refreshStatus()">
                            <span id="refresh-icon">🔄</span> Refresh
                        </button>
                    </div>
                </div>
                <div class="content">
                    <div class="status-grid">
                        <div class="status-card">
                            <div class="icon">🖥️</div>
                            <div class="label">Backend</div>
                            <div class="value" id="status-backend">--</div>
                        </div>
                        <div class="status-card">
                            <div class="icon">🌐</div>
                            <div class="label">Frontend</div>
                            <div class="value" id="status-frontend">--</div>
                        </div>
                        <div class="status-card">
                            <div class="icon">📷</div>
                            <div class="label">Camera</div>
                            <div class="value" id="status-camera">--</div>
                        </div>
                        <div class="status-card">
                            <div class="icon">👁️</div>
                            <div class="label">Presence</div>
                            <div class="value" id="status-presence">--</div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">Quick Actions</span>
                        </div>
                        <div class="quick-actions">
                            <div class="quick-action" onclick="navigateTo('registration')">
                                <div class="icon">👤</div>
                                <div class="label">Register Face</div>
                            </div>
                            <div class="quick-action" onclick="openMirror()">
                                <div class="icon">🪞</div>
                                <div class="label">Open Mirror</div>
                            </div>
                            <div class="quick-action" onclick="restartServices()">
                                <div class="icon">🔄</div>
                                <div class="label">Restart Services</div>
                            </div>
                            <div class="quick-action" onclick="navigateTo('settings')">
                                <div class="icon">⚙️</div>
                                <div class="label">Settings</div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">System Information</span>
                        </div>
                        <div class="form-row">
                            <div>
                                <div style="color: var(--text-dim); font-size: 0.8rem;">Platform</div>
                                <div id="info-platform">--</div>
                            </div>
                            <div>
                                <div style="color: var(--text-dim); font-size: 0.8rem;">Device</div>
                                <div id="info-device">--</div>
                            </div>
                            <div>
                                <div style="color: var(--text-dim); font-size: 0.8rem;">Disk Free</div>
                                <div id="info-disk">--</div>
                            </div>
                            <div>
                                <div style="color: var(--text-dim); font-size: 0.8rem;">Airport</div>
                                <div id="info-airport">--</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Settings Page -->
            <div id="settings" class="page">
                <div class="header">
                    <h2>Settings</h2>
                    <div class="header-actions">
                        <button class="btn btn-primary" onclick="saveSettings()">Save Changes</button>
                    </div>
                </div>
                <div class="content">
                    <div class="card">
                        <div class="card-title">General</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Airport (ICAO)</label>
                                <input type="text" id="cfg-airport" placeholder="KJFK" maxlength="4" style="text-transform: uppercase;">
                                <div class="hint">4-letter ICAO code for aviation data</div>
                            </div>
                            <div class="form-group">
                                <label>Timezone</label>
                                <input type="text" id="cfg-timezone" placeholder="America/New_York">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Latitude</label>
                                <input type="number" id="cfg-latitude" step="0.0001" placeholder="40.6413">
                            </div>
                            <div class="form-group">
                                <label>Longitude</label>
                                <input type="number" id="cfg-longitude" step="0.0001" placeholder="-73.7781">
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title">Display</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Sleep Timeout (seconds)</label>
                                <input type="number" id="cfg-timeout" min="30" max="600" placeholder="120">
                                <div class="hint">Time before display sleeps when you leave</div>
                            </div>
                            <div class="form-group">
                                <label>Brightness (%)</label>
                                <input type="range" id="cfg-brightness" min="10" max="100" value="80">
                                <div class="hint"><span id="cfg-brightness-val">80</span>%</div>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title">Presence Detection</div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Detection Method</label>
                                <select id="cfg-detection-method">
                                    <option value="haar">Basic (Haar Cascade)</option>
                                    <option value="face">Face Recognition</option>
                                    <option value="motion">Motion Only</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Camera</label>
                                <select id="cfg-camera">
                                    <option value="0">Camera 0 (Default)</option>
                                    <option value="1">Camera 1</option>
                                    <option value="2">Camera 2</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Registration Page -->
            <div id="registration" class="page">
                <div class="header">
                    <h2>Face Registration</h2>
                </div>
                <div class="content">
                    <div class="card" style="text-align: center; padding: 40px;">
                        <div style="font-size: 4rem; margin-bottom: 20px;">👤</div>
                        <h3 style="margin-bottom: 10px;">Register Your Face</h3>
                        <p style="color: var(--text-dim); margin-bottom: 30px;">
                            Stand in front of the mirror and use your phone to capture face samples.
                        </p>
                        <a href="/" class="btn btn-primary" style="text-decoration: none;">
                            Start Registration
                        </a>
                        <div style="margin-top: 30px;">
                            <img id="qr-code" src="/qr" alt="QR Code" style="width: 150px; height: 150px; border-radius: 8px;">
                            <p style="color: var(--text-dim); font-size: 0.85rem; margin-top: 10px;">
                                Scan to open on your phone
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- WiFi Page -->
            <div id="wifi" class="page">
                <div class="header">
                    <h2>WiFi Configuration</h2>
                    <div class="header-actions">
                        <button class="btn btn-secondary btn-sm" onclick="scanWifi()">
                            <span id="wifi-scan-icon">📶</span> Scan
                        </button>
                    </div>
                </div>
                <div class="content">
                    <div class="card">
                        <div class="card-title">Current Connection</div>
                        <div id="current-wifi" style="padding: 15px; background: var(--bg-secondary); border-radius: 8px;">
                            Loading...
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title">Available Networks</div>
                        <div id="wifi-networks">
                            <p style="color: var(--text-dim);">Click Scan to find networks</p>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title">Connect to Network</div>
                        <div class="form-group">
                            <label>Network Name (SSID)</label>
                            <input type="text" id="wifi-ssid" placeholder="Enter network name">
                        </div>
                        <div class="form-group">
                            <label>Password</label>
                            <input type="password" id="wifi-password" placeholder="Enter password">
                        </div>
                        <button class="btn btn-primary" onclick="connectWifi()">Connect</button>
                    </div>
                </div>
            </div>

            <!-- Logs Page -->
            <div id="logs" class="page">
                <div class="header">
                    <h2>System Logs</h2>
                    <div class="header-actions">
                        <select id="log-source" onchange="loadLogs()" style="padding: 8px; border-radius: 6px; background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border);">
                            <option value="backend">Backend</option>
                            <option value="frontend">Frontend</option>
                            <option value="presence">Presence</option>
                            <option value="system">System</option>
                        </select>
                        <button class="btn btn-secondary btn-sm" onclick="loadLogs()">Refresh</button>
                        <button class="btn btn-secondary btn-sm" onclick="clearLogs()">Clear</button>
                    </div>
                </div>
                <div class="content">
                    <div class="card" style="padding: 0;">
                        <div class="log-viewer" id="log-viewer">
                            <div class="log-line info">Select a log source and click Refresh</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Updates Page -->
            <div id="updates" class="page">
                <div class="header">
                    <h2>Software Updates</h2>
                </div>
                <div class="content">
                    <div class="card">
                        <div class="card-title">Current Version</div>
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <span id="current-version" style="font-size: 1.5rem;">--</span>
                            <span id="update-status" class="btn btn-sm btn-secondary">Checking...</span>
                        </div>
                    </div>

                    <div class="card" id="update-available" style="display: none;">
                        <div class="card-title">Update Available</div>
                        <p style="color: var(--text-dim); margin-bottom: 15px;">
                            A new version is available. Review the changes before updating.
                        </p>
                        <div id="update-changelog" style="background: var(--bg-secondary); padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 0.9rem;">
                        </div>
                        <button class="btn btn-primary" onclick="applyUpdate()">Install Update</button>
                    </div>

                    <div class="card">
                        <div class="card-title">Actions</div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="btn btn-secondary" onclick="checkUpdates()">Check for Updates</button>
                            <button class="btn btn-secondary" onclick="restartServices()">Restart Services</button>
                            <button class="btn btn-danger" onclick="rebootSystem()">Reboot System</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Security Page -->
            <div id="security" class="page">
                <div class="header">
                    <h2>Security</h2>
                </div>
                <div class="content">
                    <div class="card">
                        <div class="card-title">Admin Password</div>
                        <p style="color: var(--text-dim); margin-bottom: 15px;">
                            Protect the admin portal with a password. Leave blank to disable.
                        </p>
                        <div class="form-group">
                            <label>Current Password</label>
                            <input type="password" id="sec-current-password" placeholder="Enter current password">
                        </div>
                        <div class="form-group">
                            <label>New Password</label>
                            <input type="password" id="sec-new-password" placeholder="Enter new password">
                        </div>
                        <div class="form-group">
                            <label>Confirm Password</label>
                            <input type="password" id="sec-confirm-password" placeholder="Confirm new password">
                        </div>
                        <button class="btn btn-primary" onclick="changePassword()">Update Password</button>
                    </div>
                </div>
            </div>

            <!-- Layout Editor Page -->
            <div id="layout" class="page">
                <div class="header">
                    <h2>Widget Layout</h2>
                    <div class="header-actions">
                        <button class="btn btn-secondary btn-sm" onclick="resetLayout()">Reset to Default</button>
                        <button class="btn btn-primary" onclick="saveLayout()">Save Layout</button>
                    </div>
                </div>
                <div class="content">
                    <div class="card">
                        <div class="card-title">Mirror Layout</div>
                        <p style="color: var(--text-dim); margin-bottom: 15px;">
                            Drag widgets to rearrange. Click a widget to configure it.
                        </p>

                        <!-- Grid Preview -->
                        <div class="layout-grid" id="layout-grid">
                            <div class="grid-cell" data-position="top-left" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Top Left</span>
                            </div>
                            <div class="grid-cell" data-position="top-center" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Top Center</span>
                            </div>
                            <div class="grid-cell" data-position="top-right" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Top Right</span>
                            </div>
                            <div class="grid-cell" data-position="center-left" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Center Left</span>
                            </div>
                            <div class="grid-cell" data-position="center-center" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Center</span>
                            </div>
                            <div class="grid-cell" data-position="center-right" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Center Right</span>
                            </div>
                            <div class="grid-cell" data-position="bottom-left" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Bottom Left</span>
                            </div>
                            <div class="grid-cell" data-position="bottom-center" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Bottom Center</span>
                            </div>
                            <div class="grid-cell" data-position="bottom-right" ondrop="dropWidget(event)" ondragover="allowDrop(event)">
                                <span class="cell-label">Bottom Right</span>
                            </div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-title">Available Widgets</div>
                        <div class="widget-palette" id="widget-palette">
                            <!-- Populated by JavaScript -->
                        </div>
                    </div>

                    <!-- Widget Config Modal -->
                    <div id="widget-config-modal" class="modal" style="display: none;">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h3 id="modal-widget-name">Configure Widget</h3>
                                <button class="modal-close" onclick="closeWidgetModal()">&times;</button>
                            </div>
                            <div class="modal-body" id="modal-widget-config">
                                <!-- Config form populated by JS -->
                            </div>
                            <div class="modal-footer">
                                <button class="btn btn-danger" onclick="removeWidget()">Remove</button>
                                <button class="btn btn-primary" onclick="saveWidgetConfig()">Save</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <div id="toast" class="toast"></div>

    <script>
        let config = {};

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                navigateTo(page);
            });
        });

        function navigateTo(page) {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelector(`[data-page="${page}"]`).classList.add('active');
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(page).classList.add('active');

            // Close mobile sidebar
            document.getElementById('sidebar').classList.remove('open');

            // Load page-specific data
            if (page === 'logs') loadLogs();
            if (page === 'updates') checkUpdates();
            if (page === 'wifi') loadWifiStatus();
        }

        function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('open');
        }

        // Toast notifications
        function showToast(message, isError = false) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.className = 'toast show' + (isError ? ' error' : '');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // Status refresh
        async function refreshStatus() {
            const icon = document.getElementById('refresh-icon');
            icon.classList.add('spinning');

            try {
                const [statusRes, systemRes, configRes] = await Promise.all([
                    fetch('/api/settings/status'),
                    fetch('/api/settings/system'),
                    fetch('/api/settings')
                ]);

                const status = await statusRes.json();
                const system = await systemRes.json();
                config = await configRes.json();

                // Update status cards
                updateStatusCard('status-backend', status.backend?.running);
                updateStatusCard('status-frontend', status.frontend?.running);
                updateStatusCard('status-camera', status.presence?.running);
                updateStatusCard('status-presence', status.presence?.running);

                // Update system info
                document.getElementById('system-ip').textContent = `IP: ${system.local_ip}`;
                document.getElementById('info-platform').textContent = system.platform || '--';
                document.getElementById('info-device').textContent = system.device_model || '--';
                document.getElementById('info-disk').textContent = system.disk_free_gb ? `${system.disk_free_gb} GB` : '--';
                document.getElementById('info-airport').textContent = config.airport || '--';

                // Populate settings form
                populateSettings(config);

            } catch (error) {
                showToast('Failed to refresh status', true);
            }

            icon.classList.remove('spinning');
        }

        function updateStatusCard(id, isRunning) {
            const el = document.getElementById(id);
            el.textContent = isRunning ? 'Online' : 'Offline';
            el.className = 'value ' + (isRunning ? 'online' : 'offline');
        }

        function populateSettings(cfg) {
            document.getElementById('cfg-airport').value = cfg.airport || '';
            document.getElementById('cfg-timezone').value = cfg.location?.timezone || '';
            document.getElementById('cfg-latitude').value = cfg.location?.latitude || '';
            document.getElementById('cfg-longitude').value = cfg.location?.longitude || '';
            document.getElementById('cfg-timeout').value = cfg.display?.presence_timeout || 120;
            document.getElementById('cfg-brightness').value = cfg.display?.brightness || 80;
            document.getElementById('cfg-brightness-val').textContent = cfg.display?.brightness || 80;
            document.getElementById('cfg-detection-method').value = cfg.presence?.detection_method || 'haar';
            document.getElementById('cfg-camera').value = cfg.presence?.camera_index || 0;
        }

        async function saveSettings() {
            config.airport = document.getElementById('cfg-airport').value.toUpperCase();
            config.location = {
                latitude: parseFloat(document.getElementById('cfg-latitude').value) || 0,
                longitude: parseFloat(document.getElementById('cfg-longitude').value) || 0,
                timezone: document.getElementById('cfg-timezone').value
            };
            config.display = {
                ...config.display,
                presence_timeout: parseInt(document.getElementById('cfg-timeout').value) || 120,
                brightness: parseInt(document.getElementById('cfg-brightness').value) || 80
            };
            config.presence = {
                ...config.presence,
                detection_method: document.getElementById('cfg-detection-method').value,
                camera_index: parseInt(document.getElementById('cfg-camera').value) || 0
            };

            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (res.ok) {
                    showToast('Settings saved!');
                } else {
                    throw new Error();
                }
            } catch {
                showToast('Failed to save settings', true);
            }
        }

        // Actions
        function openMirror() {
            window.open('http://' + location.hostname + ':3001', '_blank');
        }

        async function restartServices() {
            if (!confirm('Restart all SkyGlass services?')) return;
            try {
                await fetch('/api/settings/restart', { method: 'POST' });
                showToast('Services restarting...');
            } catch {
                showToast('Failed to restart', true);
            }
        }

        async function rebootSystem() {
            if (!confirm('Reboot the system? The mirror will be offline for a minute.')) return;
            try {
                await fetch('/api/settings/reboot', { method: 'POST' });
                showToast('Rebooting...');
            } catch {
                showToast('Failed to reboot', true);
            }
        }

        // Logs
        async function loadLogs() {
            const source = document.getElementById('log-source').value;
            const viewer = document.getElementById('log-viewer');
            viewer.innerHTML = '<div class="log-line info">Loading...</div>';

            try {
                const res = await fetch(`/api/admin/logs?source=${source}`);
                const data = await res.json();

                viewer.innerHTML = data.logs.map(line => {
                    let cls = 'log-line';
                    if (line.toLowerCase().includes('error')) cls += ' error';
                    else if (line.toLowerCase().includes('warn')) cls += ' warn';
                    else cls += ' info';
                    return `<div class="${cls}">${escapeHtml(line)}</div>`;
                }).join('');

                viewer.scrollTop = viewer.scrollHeight;
            } catch {
                viewer.innerHTML = '<div class="log-line error">Failed to load logs</div>';
            }
        }

        function clearLogs() {
            document.getElementById('log-viewer').innerHTML = '<div class="log-line info">Logs cleared</div>';
        }

        // Updates
        async function checkUpdates() {
            document.getElementById('update-status').textContent = 'Checking...';
            try {
                const res = await fetch('/api/admin/updates');
                const data = await res.json();

                document.getElementById('current-version').textContent = data.current_version || 'Unknown';

                if (data.update_available) {
                    document.getElementById('update-status').textContent = 'Update Available';
                    document.getElementById('update-status').className = 'btn btn-sm btn-primary';
                    document.getElementById('update-available').style.display = 'block';
                    document.getElementById('update-changelog').textContent = data.changelog || 'No changelog available';
                } else {
                    document.getElementById('update-status').textContent = 'Up to Date';
                    document.getElementById('update-status').className = 'btn btn-sm btn-secondary';
                    document.getElementById('update-available').style.display = 'none';
                }
            } catch {
                document.getElementById('update-status').textContent = 'Check Failed';
            }
        }

        async function applyUpdate() {
            if (!confirm('Install update? Services will restart.')) return;
            showToast('Installing update...');
            try {
                await fetch('/api/admin/updates/apply', { method: 'POST' });
                showToast('Update installed! Restarting...');
            } catch {
                showToast('Update failed', true);
            }
        }

        // WiFi
        async function loadWifiStatus() {
            try {
                const res = await fetch('/api/admin/wifi/status');
                const data = await res.json();
                document.getElementById('current-wifi').innerHTML = data.connected
                    ? `<strong>${data.ssid}</strong> - ${data.ip}`
                    : 'Not connected';
            } catch {
                document.getElementById('current-wifi').textContent = 'Unable to get WiFi status';
            }
        }

        async function scanWifi() {
            const icon = document.getElementById('wifi-scan-icon');
            icon.classList.add('spinning');

            try {
                const res = await fetch('/api/admin/wifi/scan');
                const data = await res.json();

                document.getElementById('wifi-networks').innerHTML = data.networks.map(net => `
                    <div class="wifi-network ${net.connected ? 'connected' : ''}" onclick="selectWifi('${net.ssid}')">
                        <span class="ssid">${net.ssid}</span>
                        <span class="signal">${net.signal}%</span>
                    </div>
                `).join('') || '<p style="color: var(--text-dim);">No networks found</p>';
            } catch {
                showToast('Scan failed', true);
            }

            icon.classList.remove('spinning');
        }

        function selectWifi(ssid) {
            document.getElementById('wifi-ssid').value = ssid;
            document.getElementById('wifi-password').focus();
        }

        async function connectWifi() {
            const ssid = document.getElementById('wifi-ssid').value;
            const password = document.getElementById('wifi-password').value;

            if (!ssid) {
                showToast('Enter network name', true);
                return;
            }

            showToast('Connecting...');
            try {
                const res = await fetch('/api/admin/wifi/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ssid, password })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Connected!');
                    loadWifiStatus();
                } else {
                    showToast(data.error || 'Connection failed', true);
                }
            } catch {
                showToast('Connection failed', true);
            }
        }

        // Security
        async function changePassword() {
            const current = document.getElementById('sec-current-password').value;
            const newPass = document.getElementById('sec-new-password').value;
            const confirm = document.getElementById('sec-confirm-password').value;

            if (newPass !== confirm) {
                showToast('Passwords do not match', true);
                return;
            }

            try {
                const res = await fetch('/api/admin/password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ current_password: current, new_password: newPass })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Password updated');
                    document.getElementById('sec-current-password').value = '';
                    document.getElementById('sec-new-password').value = '';
                    document.getElementById('sec-confirm-password').value = '';
                } else {
                    showToast(data.error || 'Failed', true);
                }
            } catch {
                showToast('Failed to update password', true);
            }
        }

        // Utilities
        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // Brightness slider
        document.getElementById('cfg-brightness').addEventListener('input', (e) => {
            document.getElementById('cfg-brightness-val').textContent = e.target.value;
        });

        // ============================================
        // Layout Editor
        // ============================================
        const widgetMeta = {
            clock: { name: 'Clock', icon: '🕐', desc: 'Local and Zulu time' },
            aviation: { name: 'Aviation', icon: '✈️', desc: 'METAR/TAF' },
            schedule: { name: 'Schedule', icon: '📅', desc: 'Calendar events' },
            radar: { name: 'Radar', icon: '🌧️', desc: 'Weather radar' },
            tfr: { name: 'TFRs', icon: '⚠️', desc: 'Flight restrictions' },
            notam: { name: 'NOTAMs', icon: '📋', desc: 'Notices' },
            astro: { name: 'Sun/Moon', icon: '🌅', desc: 'Sunrise/sunset' },
        };

        let layoutWidgets = [];
        let selectedWidget = null;

        function initLayoutEditor() {
            // Populate widget palette
            const palette = document.getElementById('widget-palette');
            palette.innerHTML = Object.entries(widgetMeta).map(([type, meta]) => `
                <div class="palette-widget" draggable="true" ondragstart="dragWidget(event, '${type}')" data-type="${type}">
                    <span class="widget-icon">${meta.icon}</span>
                    <span class="widget-name">${meta.name}</span>
                </div>
            `).join('');

            // Load current layout from config
            loadLayoutFromConfig();
        }

        function loadLayoutFromConfig() {
            if (!config.widgets) return;
            layoutWidgets = [...config.widgets];
            renderLayout();
        }

        function renderLayout() {
            // Clear all cells
            document.querySelectorAll('.grid-cell').forEach(cell => {
                cell.classList.remove('has-widget');
                const chip = cell.querySelector('.widget-chip');
                if (chip) chip.remove();
            });

            // Place widgets
            layoutWidgets.forEach((widget, index) => {
                const cell = document.querySelector(`.grid-cell[data-position="${widget.position}"]`);
                if (cell && widgetMeta[widget.type]) {
                    cell.classList.add('has-widget');
                    const chip = document.createElement('div');
                    chip.className = 'widget-chip';
                    chip.draggable = true;
                    chip.dataset.index = index;
                    chip.innerHTML = `${widgetMeta[widget.type].icon} ${widgetMeta[widget.type].name}`;
                    chip.onclick = () => openWidgetConfig(index);
                    chip.ondragstart = (e) => dragExistingWidget(e, index);
                    cell.appendChild(chip);
                }
            });

            // Update palette (disable used widgets)
            document.querySelectorAll('.palette-widget').forEach(pw => {
                const type = pw.dataset.type;
                const inUse = layoutWidgets.some(w => w.type === type);
                pw.classList.toggle('disabled', inUse);
                pw.draggable = !inUse;
            });
        }

        function dragWidget(e, type) {
            e.dataTransfer.setData('widget-type', type);
            e.dataTransfer.setData('is-new', 'true');
        }

        function dragExistingWidget(e, index) {
            e.dataTransfer.setData('widget-index', index.toString());
            e.dataTransfer.setData('is-new', 'false');
        }

        function allowDrop(e) {
            e.preventDefault();
            e.currentTarget.style.borderColor = 'var(--accent)';
        }

        function dropWidget(e) {
            e.preventDefault();
            e.currentTarget.style.borderColor = '';
            const position = e.currentTarget.dataset.position;
            const isNew = e.dataTransfer.getData('is-new') === 'true';

            if (isNew) {
                const type = e.dataTransfer.getData('widget-type');
                if (!type || layoutWidgets.some(w => w.type === type)) return;

                // Remove any widget in this position
                layoutWidgets = layoutWidgets.filter(w => w.position !== position);
                // Add new widget
                layoutWidgets.push({ type, position, enabled: true });
            } else {
                const index = parseInt(e.dataTransfer.getData('widget-index'));
                // Remove any widget in target position
                layoutWidgets = layoutWidgets.filter(w => w.position !== position);
                // Move widget to new position
                if (layoutWidgets[index]) {
                    layoutWidgets[index].position = position;
                }
            }

            renderLayout();
        }

        function openWidgetConfig(index) {
            selectedWidget = index;
            const widget = layoutWidgets[index];
            const meta = widgetMeta[widget.type];

            document.getElementById('modal-widget-name').textContent = `Configure ${meta.name}`;
            document.getElementById('widget-config-modal').style.display = 'flex';

            // Simple config form
            document.getElementById('modal-widget-config').innerHTML = `
                <div class="form-group">
                    <label>Widget</label>
                    <input type="text" value="${meta.icon} ${meta.name}" disabled>
                </div>
                <div class="form-group">
                    <label>Position</label>
                    <input type="text" value="${widget.position}" disabled>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="widget-enabled" ${widget.enabled !== false ? 'checked' : ''}>
                        Enabled
                    </label>
                </div>
            `;
        }

        function closeWidgetModal() {
            document.getElementById('widget-config-modal').style.display = 'none';
            selectedWidget = null;
        }

        function saveWidgetConfig() {
            if (selectedWidget === null) return;
            layoutWidgets[selectedWidget].enabled = document.getElementById('widget-enabled').checked;
            closeWidgetModal();
            renderLayout();
        }

        function removeWidget() {
            if (selectedWidget === null) return;
            layoutWidgets.splice(selectedWidget, 1);
            closeWidgetModal();
            renderLayout();
        }

        async function saveLayout() {
            config.widgets = layoutWidgets;
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (res.ok) {
                    showToast('Layout saved! Refresh mirror to see changes.');
                } else {
                    throw new Error();
                }
            } catch {
                showToast('Failed to save layout', true);
            }
        }

        function resetLayout() {
            if (!confirm('Reset to default layout?')) return;
            layoutWidgets = [
                { type: 'clock', position: 'top-left', enabled: true },
                { type: 'aviation', position: 'top-right', enabled: true },
                { type: 'schedule', position: 'center-right', enabled: true },
                { type: 'radar', position: 'center-left', enabled: true },
                { type: 'tfr', position: 'bottom-left', enabled: true },
                { type: 'notam', position: 'bottom-center', enabled: true },
                { type: 'astro', position: 'bottom-right', enabled: true },
            ];
            renderLayout();
            showToast('Layout reset to default');
        }

        // Initialize layout editor when navigating to layout page
        const origNavigateTo = navigateTo;
        navigateTo = function(page) {
            origNavigateTo(page);
            if (page === 'layout') initLayoutEditor();
        };

        // Initialize
        refreshStatus();
        setInterval(refreshStatus, 30000);
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
@login_required
def dashboard():
    """Main admin dashboard."""
    # Redirect to setup wizard if first time
    if not is_setup_complete():
        return redirect(url_for('admin.setup_wizard'))
    return render_template_string(DASHBOARD_HTML)


@admin.route('/admin/login', methods=['GET', 'POST'])
def login_page():
    """Login page."""
    if request.method == 'POST':
        password = request.form.get('password', '')
        stored = get_stored_password()

        if stored and verify_password(password, stored):
            session['authenticated'] = True
            session.permanent = True
            return redirect(url_for('admin.dashboard'))
        else:
            return render_template_string(LOGIN_HTML, error="Invalid password")

    return render_template_string(LOGIN_HTML, error=None)


@admin.route('/admin/logout')
def logout():
    """Logout."""
    session.pop('authenticated', None)
    return redirect(url_for('admin.login_page'))


# ============================================================
# API Endpoints
# ============================================================

@admin.route('/api/admin/logs')
@login_required
def api_logs():
    """Get system logs."""
    source = request.args.get('source', 'backend')
    lines = int(request.args.get('lines', 100))

    log_paths = {
        'backend': Path(__file__).parent.parent.parent / 'logs' / 'backend-out.log',
        'frontend': Path(__file__).parent.parent.parent / 'logs' / 'frontend-out.log',
        'presence': Path(__file__).parent.parent.parent / 'logs' / 'presence-out.log',
        'system': Path('/var/log/syslog'),
    }

    log_file = log_paths.get(source)
    logs = []

    if log_file and log_file.exists():
        try:
            with open(log_file, 'r') as f:
                logs = f.readlines()[-lines:]
        except Exception as e:
            logs = [f"Error reading log: {e}"]
    else:
        # Try journalctl on Linux
        try:
            result = subprocess.run(
                ['journalctl', '-u', f'skyglass-{source}', '-n', str(lines), '--no-pager'],
                capture_output=True, text=True, timeout=5
            )
            logs = result.stdout.split('\n')
        except:
            logs = ["Log file not found"]

    return jsonify({"logs": [l.strip() for l in logs if l.strip()]})


@admin.route('/api/admin/updates')
@login_required
def api_updates():
    """Check for updates."""
    try:
        # Try to get version from git
        result = subprocess.run(
            ['git', 'describe', '--tags', '--always'],
            capture_output=True, text=True, timeout=5,
            cwd=Path(__file__).parent.parent.parent
        )
        current_version = result.stdout.strip() or 'unknown'

        # Check for updates
        subprocess.run(['git', 'fetch'], capture_output=True, timeout=30,
                      cwd=Path(__file__).parent.parent.parent)

        result = subprocess.run(
            ['git', 'log', 'HEAD..origin/main', '--oneline'],
            capture_output=True, text=True, timeout=5,
            cwd=Path(__file__).parent.parent.parent
        )

        update_available = bool(result.stdout.strip())
        changelog = result.stdout.strip() if update_available else ''

        return jsonify({
            "current_version": current_version,
            "update_available": update_available,
            "changelog": changelog
        })
    except Exception as e:
        return jsonify({
            "current_version": "unknown",
            "update_available": False,
            "error": str(e)
        })


@admin.route('/api/admin/updates/apply', methods=['POST'])
@login_required
def api_apply_update():
    """Apply available updates."""
    try:
        script = Path(__file__).parent.parent.parent / 'scripts' / 'update.sh'
        if script.exists():
            subprocess.Popen(['bash', str(script), '--apply'])
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "Update script not found"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@admin.route('/api/admin/wifi/status')
@login_required
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
@login_required
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
        current_ssid = None
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
                except:
                    current_signal = 50

        return jsonify({"networks": sorted(networks, key=lambda x: -x['signal'])})
    except Exception as e:
        return jsonify({"networks": [], "error": str(e)})


@admin.route('/api/admin/wifi/connect', methods=['POST'])
@login_required
def api_wifi_connect():
    """Connect to a WiFi network."""
    if platform.system() != 'Linux':
        return jsonify({"success": False, "error": "WiFi only on Linux"})

    data = request.get_json()
    ssid = data.get('ssid')
    password = data.get('password')

    if not ssid:
        return jsonify({"success": False, "error": "SSID required"})

    try:
        # Create wpa_supplicant config
        config = f'''
network={{
    ssid="{ssid}"
    psk="{password}"
}}
'''
        config_file = Path('/tmp/wpa_temp.conf')
        config_file.write_text(config)

        # Add to wpa_supplicant
        subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', 'add_network'],
            capture_output=True, timeout=10
        )

        subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', 'set_network', '0', 'ssid', f'"{ssid}"'],
            capture_output=True, timeout=10
        )

        subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', 'set_network', '0', 'psk', f'"{password}"'],
            capture_output=True, timeout=10
        )

        subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', 'enable_network', '0'],
            capture_output=True, timeout=10
        )

        subprocess.run(
            ['sudo', 'wpa_cli', '-i', 'wlan0', 'save_config'],
            capture_output=True, timeout=10
        )

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@admin.route('/api/admin/password', methods=['POST'])
def api_change_password():
    """Change admin password."""
    data = request.get_json()
    current = data.get('current_password', '')
    new_pass = data.get('new_password', '')

    stored = get_stored_password()

    # If password is set, verify current
    if stored and not verify_password(current, stored):
        return jsonify({"success": False, "error": "Current password incorrect"})

    if new_pass:
        set_admin_password(new_pass)
        return jsonify({"success": True})
    else:
        # Remove password (disable auth)
        if ADMIN_PASSWORD_FILE.exists():
            ADMIN_PASSWORD_FILE.unlink()
        return jsonify({"success": True})


# ============================================================
# First-Time Setup Wizard
# ============================================================

SETUP_WIZARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>SkyGlass Setup</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪞</text></svg>">
    <style>
        :root {
            --bg-primary: #0f0f1a;
            --bg-secondary: #1a1a2e;
            --bg-card: #242442;
            --accent: #4ecca3;
            --accent-dim: rgba(78, 204, 163, 0.2);
            --text: #ffffff;
            --text-dim: #8888aa;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-primary);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .wizard {
            width: 100%;
            max-width: 500px;
        }
        .wizard-header {
            text-align: center;
            margin-bottom: 30px;
        }
        .wizard-header .logo { font-size: 4rem; margin-bottom: 15px; }
        .wizard-header h1 { font-size: 1.5rem; font-weight: 400; }
        .wizard-header p { color: var(--text-dim); margin-top: 10px; }

        .step-indicator {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 30px;
        }
        .step-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--bg-card);
            transition: all 0.3s;
        }
        .step-dot.active { background: var(--accent); transform: scale(1.2); }
        .step-dot.completed { background: var(--accent); opacity: 0.5; }

        .step { display: none; }
        .step.active { display: block; }

        .card {
            background: var(--bg-card);
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 20px;
        }
        .card h2 {
            font-size: 1.2rem;
            font-weight: 500;
            margin-bottom: 20px;
            color: var(--accent);
        }

        .form-group { margin-bottom: 20px; }
        .form-group label {
            display: block;
            font-size: 0.9rem;
            color: var(--text-dim);
            margin-bottom: 8px;
        }
        .form-group input, .form-group select {
            width: 100%;
            padding: 14px 16px;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            background: var(--bg-primary);
            color: var(--text);
            font-size: 1rem;
        }
        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: var(--accent);
        }
        .form-group .hint {
            font-size: 0.8rem;
            color: var(--text-dim);
            margin-top: 6px;
        }

        .btn {
            padding: 14px 28px;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary {
            background: var(--accent);
            color: var(--bg-primary);
            font-weight: 600;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px var(--accent-dim);
        }
        .btn-secondary {
            background: transparent;
            color: var(--text);
            border: 1px solid rgba(255,255,255,0.2);
        }

        .button-row {
            display: flex;
            gap: 10px;
            justify-content: space-between;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin: 20px 0;
        }
        .feature-item {
            background: var(--bg-secondary);
            padding: 15px;
            border-radius: 10px;
            text-align: center;
        }
        .feature-item .icon { font-size: 1.5rem; margin-bottom: 8px; }
        .feature-item .label { font-size: 0.85rem; color: var(--text-dim); }

        .success-icon {
            font-size: 5rem;
            text-align: center;
            margin-bottom: 20px;
        }

        .detection-test {
            background: #000;
            border-radius: 10px;
            overflow: hidden;
            margin: 15px 0;
        }
        .detection-test img {
            width: 100%;
            display: block;
        }
        .detection-status {
            padding: 10px;
            text-align: center;
            font-size: 0.9rem;
        }
        .detection-status.success { color: var(--accent); }
        .detection-status.warning { color: #ffa726; }

        @media (max-width: 480px) {
            .card { padding: 20px; }
            .feature-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="wizard">
        <div class="wizard-header">
            <div class="logo">🪞</div>
            <h1>Welcome to SkyGlass</h1>
            <p>Let's get your smart mirror set up</p>
        </div>

        <div class="step-indicator">
            <div class="step-dot active" data-step="1"></div>
            <div class="step-dot" data-step="2"></div>
            <div class="step-dot" data-step="3"></div>
            <div class="step-dot" data-step="4"></div>
        </div>

        <!-- Step 1: Welcome -->
        <div id="step1" class="step active">
            <div class="card">
                <h2>What SkyGlass Does</h2>
                <div class="feature-grid">
                    <div class="feature-item">
                        <div class="icon">✈️</div>
                        <div class="label">Aviation Weather</div>
                    </div>
                    <div class="feature-item">
                        <div class="icon">📅</div>
                        <div class="label">Flight Schedule</div>
                    </div>
                    <div class="feature-item">
                        <div class="icon">👁️</div>
                        <div class="label">Presence Detection</div>
                    </div>
                    <div class="feature-item">
                        <div class="icon">🌅</div>
                        <div class="label">Sun/Moon Times</div>
                    </div>
                </div>
                <p style="color: var(--text-dim); font-size: 0.9rem; line-height: 1.6;">
                    Your mirror wakes up when you approach, displays aviation weather and your schedule,
                    then sleeps when you leave.
                </p>
            </div>
            <button class="btn btn-primary" onclick="nextStep()" style="width: 100%;">
                Get Started
            </button>
        </div>

        <!-- Step 2: Location -->
        <div id="step2" class="step">
            <div class="card">
                <h2>Your Location</h2>
                <div class="form-group">
                    <label>Primary Airport (ICAO Code)</label>
                    <input type="text" id="setup-airport" placeholder="KJFK" maxlength="4" style="text-transform: uppercase;">
                    <div class="hint">4-letter ICAO code for METAR/TAF data</div>
                </div>
                <div class="form-group">
                    <label>Timezone</label>
                    <select id="setup-timezone">
                        <option value="America/New_York">Eastern (New York)</option>
                        <option value="America/Chicago">Central (Chicago)</option>
                        <option value="America/Denver">Mountain (Denver)</option>
                        <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                        <option value="America/Anchorage">Alaska</option>
                        <option value="Pacific/Honolulu">Hawaii</option>
                        <option value="Europe/London">UK (London)</option>
                        <option value="Europe/Paris">Central Europe (Paris)</option>
                        <option value="Asia/Tokyo">Japan (Tokyo)</option>
                        <option value="Australia/Sydney">Australia (Sydney)</option>
                    </select>
                </div>
            </div>
            <div class="button-row">
                <button class="btn btn-secondary" onclick="prevStep()">Back</button>
                <button class="btn btn-primary" onclick="nextStep()">Continue</button>
            </div>
        </div>

        <!-- Step 3: Camera Test -->
        <div id="step3" class="step">
            <div class="card">
                <h2>Camera Setup</h2>
                <p style="color: var(--text-dim); margin-bottom: 15px;">
                    The camera detects when you're in front of the mirror.
                </p>
                <div class="detection-test">
                    <img id="camera-preview" src="/video_feed" alt="Camera preview">
                </div>
                <div id="camera-status" class="detection-status">
                    Looking for camera...
                </div>
                <div class="form-group" style="margin-top: 15px;">
                    <label>Detection Mode</label>
                    <select id="setup-detection">
                        <option value="haar">Basic Face Detection (Fast)</option>
                        <option value="face_recognition">Advanced Recognition (Accurate)</option>
                        <option value="motion">Motion Only</option>
                    </select>
                    <div class="hint">Basic detection works without registration</div>
                </div>
            </div>
            <div class="button-row">
                <button class="btn btn-secondary" onclick="prevStep()">Back</button>
                <button class="btn btn-primary" onclick="nextStep()">Continue</button>
            </div>
        </div>

        <!-- Step 4: Complete -->
        <div id="step4" class="step">
            <div class="card" style="text-align: center;">
                <div class="success-icon">🎉</div>
                <h2 style="text-align: center;">You're All Set!</h2>
                <p style="color: var(--text-dim); margin: 20px 0; line-height: 1.6;">
                    Your SkyGlass is configured and ready to use.
                    You can access the admin portal anytime to change settings.
                </p>
                <div class="form-group">
                    <label>Set Admin Password (Optional)</label>
                    <input type="password" id="setup-password" placeholder="Leave blank to skip">
                    <div class="hint">Protect the admin portal with a password</div>
                </div>
            </div>
            <button class="btn btn-primary" onclick="completeSetup()" style="width: 100%;">
                Open Dashboard
            </button>
        </div>
    </div>

    <script>
        let currentStep = 1;
        const totalSteps = 4;

        function updateStepIndicator() {
            document.querySelectorAll('.step-dot').forEach((dot, i) => {
                const stepNum = i + 1;
                dot.classList.remove('active', 'completed');
                if (stepNum === currentStep) {
                    dot.classList.add('active');
                } else if (stepNum < currentStep) {
                    dot.classList.add('completed');
                }
            });

            document.querySelectorAll('.step').forEach((step, i) => {
                step.classList.toggle('active', i + 1 === currentStep);
            });
        }

        function nextStep() {
            if (currentStep < totalSteps) {
                currentStep++;
                updateStepIndicator();

                // Start camera status polling on step 3
                if (currentStep === 3) {
                    pollCameraStatus();
                }
            }
        }

        function prevStep() {
            if (currentStep > 1) {
                currentStep--;
                updateStepIndicator();
            }
        }

        function pollCameraStatus() {
            fetch('/api/faces')
                .then(r => r.json())
                .then(data => {
                    const status = document.getElementById('camera-status');
                    if (data.faces && data.faces.length > 0) {
                        status.textContent = 'Face detected! Camera is working.';
                        status.className = 'detection-status success';
                    } else {
                        status.textContent = 'Camera active - try moving in front of it';
                        status.className = 'detection-status warning';
                    }
                })
                .catch(() => {
                    const status = document.getElementById('camera-status');
                    status.textContent = 'Camera not available';
                    status.className = 'detection-status';
                });

            if (currentStep === 3) {
                setTimeout(pollCameraStatus, 1000);
            }
        }

        async function completeSetup() {
            // Save settings
            const config = {
                airport: document.getElementById('setup-airport').value.toUpperCase() || 'KJFK',
                location: {
                    timezone: document.getElementById('setup-timezone').value
                },
                presence: {
                    detection_method: document.getElementById('setup-detection').value,
                    camera_index: 0
                }
            };

            try {
                // Save config
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });

                // Set password if provided
                const password = document.getElementById('setup-password').value;
                if (password) {
                    await fetch('/api/admin/password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ new_password: password })
                    });
                }

                // Mark setup complete
                await fetch('/api/admin/setup/complete', { method: 'POST' });

                // Redirect to dashboard
                window.location.href = '/admin';
            } catch (error) {
                alert('Setup failed. Please try again.');
            }
        }

        // Try to detect timezone
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const select = document.getElementById('setup-timezone');
            for (let opt of select.options) {
                if (opt.value === tz) {
                    opt.selected = true;
                    break;
                }
            }
        } catch (e) {}
    </script>
</body>
</html>
"""


@admin.route('/admin/setup')
def setup_wizard():
    """First-time setup wizard."""
    return render_template_string(SETUP_WIZARD_HTML)


@admin.route('/api/admin/setup/status')
def api_setup_status():
    """Check if setup is complete."""
    return jsonify({
        "setup_complete": is_setup_complete(),
        "password_set": is_password_set()
    })


@admin.route('/api/admin/setup/complete', methods=['POST'])
def api_setup_complete():
    """Mark setup as complete."""
    mark_setup_complete()
    return jsonify({"success": True})
