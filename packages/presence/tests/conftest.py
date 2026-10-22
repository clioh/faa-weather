import os
import sys
import tempfile
from pathlib import Path

import pytest

# Make the presence package modules (detector.py, web_server.py, ...) importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Secrets (session key, admin password, internal token) go to a throwaway
# directory, never the repo's data/. Set before web_server is imported: it
# loads the session key at import time.
_DATA = Path(tempfile.mkdtemp(prefix="skyglass-test-data-"))
os.environ["SKYGLASS_DATA_DIR"] = str(_DATA)
os.environ["SKYGLASS_INTERNAL_TOKEN_FILE"] = str(_DATA / "internal-token")


@pytest.fixture
def internal():
    """Headers carrying the internal service token (what the backend sends)."""
    import security

    return {security.INTERNAL_HEADER: security.get_internal_token()}


@pytest.fixture(autouse=True)
def _clean_auth_state():
    """No admin password, fresh limiter and no enrollment session per test."""
    import security

    security.clear_password()
    yield
    security.clear_password()
    if "admin_portal" in sys.modules:
        sys.modules["admin_portal"].login_limiter.reset()
    if "web_server" in sys.modules:
        sys.modules["web_server"].end_enrollment(notify=False)
