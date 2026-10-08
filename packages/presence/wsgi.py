#!/usr/bin/env python3
"""
WSGI entry point for SkyGlass Presence Server.

For production, run with Gunicorn:
    gunicorn -w 1 -b 0.0.0.0:5000 --threads 4 wsgi:app

Note: Use only 1 worker (-w 1) because camera access must be single-threaded.
Use threads instead for concurrent request handling.
"""

import os
import sys

# Ensure the package directory is in the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from web_server import app, init_camera, release_camera, get_local_ip

# Initialize camera on startup
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))

def on_starting(server):
    """Called just before the master process is initialized."""
    pass

def post_fork(server, worker):
    """Called just after a worker has been forked."""
    # Initialize camera in the worker process
    if not init_camera(CAMERA_INDEX):
        print("WARNING: Failed to initialize camera")

def worker_exit(server, worker):
    """Called when a worker exits."""
    release_camera()

# For running directly (development)
if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "0.0.0.0")

    if not init_camera(CAMERA_INDEX):
        print("Failed to initialize camera")
        sys.exit(1)

    local_ip = get_local_ip()
    print()
    print("=" * 60)
    print("  SkyGlass Presence Server (Development)")
    print("=" * 60)
    print()
    print(f"  Registration: http://{local_ip}:{port}")
    print(f"  Settings:     http://{local_ip}:{port}/settings")
    print()
    print("  For production, use: gunicorn wsgi:app")
    print("=" * 60)
    print()

    try:
        app.run(host=host, port=port, threaded=True)
    finally:
        release_camera()
