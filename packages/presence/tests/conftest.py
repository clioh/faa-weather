import sys
from pathlib import Path

# Make the presence package modules (detector.py, web_server.py, ...) importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
