"""
Flask decorators that enforce the trust model in docs/SECURITY.md.

* ``device_auth_required``: device controls (settings, restart, reboot, face
  data, WiFi, updates, logs, password). Internal service token OR an admin
  session (plus the CSRF check for state-changing requests).
* ``admin_page``: HTML pages of the network admin portal. Admin session only;
  with no admin password set, explains how to enable the portal.
* ``enrollment_required``: camera / capture endpoints. A valid token of the
  active enrollment session (``allow_internal`` also admits the backend).
"""

from __future__ import annotations

from functools import wraps

from flask import jsonify, redirect, render_template_string, request, session, url_for

import security

PORTAL_DISABLED_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyGlass Admin</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0f0f1a; color: #fff; min-height: 100vh; display: flex;
               align-items: center; justify-content: center; padding: 16px; }
        .card { background: #1a1a2e; padding: 32px; border-radius: 16px; max-width: 560px; width: 100%; }
        h1 { font-size: 1.4rem; font-weight: 500; margin-bottom: 16px; color: #4ecca3; }
        p { color: #bbb; line-height: 1.5; margin-bottom: 12px; }
        code { display: block; background: #0f0f1a; padding: 12px; border-radius: 8px;
               color: #4ecca3; margin: 12px 0; overflow-x: auto; white-space: pre; }
    </style>
</head>
<body>
    <div class="card">
        <h1>The network admin portal is turned off</h1>
        {% if legacy %}
        <p>The stored admin password uses an old format that is no longer accepted.
           Set a new one on the mirror itself.</p>
        {% else %}
        <p>Your mirror is managed from the SkyGlass phone app. The browser admin
           portal stays off until an admin password is set on the mirror itself,
           so nobody else on your network can change settings or reach the camera.</p>
        {% endif %}
        <p>To turn it on, open a terminal on the mirror (keyboard or SSH) and run:</p>
        <code>cd ~/SkyGlass/packages/presence
venv/bin/python set_admin_password.py</code>
        <p>Then reload this page and sign in.</p>
    </div>
</body>
</html>
"""


def _wants_json() -> bool:
    return request.path.startswith("/api/") or request.is_json or \
        "application/json" in (request.headers.get("Accept") or "")


def _unauthorized():
    if not security.is_password_set():
        message = "Admin access is disabled until an admin password is set on the device"
    else:
        message = "Authentication required"
    return jsonify({"success": False, "error": message, "message": message}), 401


def device_auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if security.has_internal_token(request):
            return f(*args, **kwargs)
        if security.is_admin_session(session):
            if not security.csrf_ok(request):
                return jsonify({"success": False, "error": "Cross-site request refused"}), 403
            return f(*args, **kwargs)
        if not _wants_json() and request.method == "GET":
            return redirect(url_for("admin.login_page"))
        return _unauthorized()
    return wrapper


def render_portal_disabled():
    return render_template_string(
        PORTAL_DISABLED_HTML, legacy=security.has_legacy_password()
    ), 403


def admin_page(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not security.is_password_set():
            return render_portal_disabled()
        if not security.is_admin_session(session):
            return redirect(url_for("admin.login_page"))
        return f(*args, **kwargs)
    return wrapper


def enrollment_token_from_request(allow_query: bool = False):
    token = request.headers.get(security.ENROLLMENT_HEADER)
    if not token and allow_query:
        token = request.args.get("token")
    return token


def enrollment_required(gate_getter, *, allow_internal: bool = False, allow_query: bool = False):
    """``gate_getter`` returns the EnrollmentGate (looked up per request so
    tests can replace it)."""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if allow_internal and security.has_internal_token(request):
                return f(*args, **kwargs)
            if gate_getter().check(enrollment_token_from_request(allow_query)):
                return f(*args, **kwargs)
            return jsonify({
                "success": False,
                "error": "No active enrollment session",
                "message": "No active enrollment session",
            }), 403
        return wrapper
    return decorator
