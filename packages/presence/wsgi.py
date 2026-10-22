#!/usr/bin/env python3
"""
WSGI entry point for the SkyGlass presence/admin server (web_server.py).

Production (PM2 app skyglass-admin):
    gunicorn -c gunicorn.conf.py wsgi:app

gunicorn.conf.py runs a single worker (the camera is single-process) and its
post_fork/worker_exit hooks open and release the camera in that worker.
For local development run `python web_server.py` instead.
"""

import os
import sys

# Ensure the package directory is in the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from web_server import app  # noqa: E402,F401  (needs the sys.path entry above)
