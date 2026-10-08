"""
Gunicorn configuration for SkyGlass Presence Server.

Run with: gunicorn -c gunicorn.conf.py wsgi:app
"""

import os
import multiprocessing

# Server socket
bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:5000")

# Worker processes
# IMPORTANT: Use only 1 worker because camera access must be single-process
workers = 1

# Use threads for concurrency instead of multiple workers
threads = 4

# Worker class - use sync for compatibility with OpenCV
worker_class = "sync"

# Timeout for worker response (increase for slow operations)
timeout = 120

# Keep-alive connections
keepalive = 5

# Logging
accesslog = "-"  # stdout
errorlog = "-"   # stderr
loglevel = os.environ.get("LOG_LEVEL", "info")

# Process naming
proc_name = "skyglass-presence"

# Server hooks
def on_starting(server):
    """Called just before the master process is initialized."""
    print("Starting SkyGlass Presence Server...")

def post_fork(server, worker):
    """Called just after a worker has been forked."""
    # Import and initialize camera in worker
    from web_server import init_camera
    camera_index = int(os.environ.get("CAMERA_INDEX", "0"))
    if not init_camera(camera_index):
        print(f"WARNING: Worker {worker.pid} failed to initialize camera")
    else:
        print(f"Worker {worker.pid} initialized camera {camera_index}")

def worker_exit(server, worker):
    """Called when a worker exits."""
    from web_server import release_camera
    release_camera()
    print(f"Worker {worker.pid} released camera")

def on_exit(server):
    """Called just before exiting Gunicorn."""
    print("Shutting down SkyGlass Presence Server...")
