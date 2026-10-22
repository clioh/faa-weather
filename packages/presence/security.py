"""
Authentication and request-hardening helpers for the presence/admin server.

Kept free of cv2 / face_recognition so it can be unit tested on its own.
See docs/SECURITY.md for the trust model this implements.

Credentials
-----------
* Internal service token: 32 random bytes (hex) in ``data/internal-token``
  (repo root; env SKYGLASS_INTERNAL_TOKEN_FILE overrides the path). Shared
  with the Node backend, which sends it as ``X-SkyGlass-Internal`` when it
  calls this server on the phone's behalf. Whichever process starts first
  creates it (atomically, mode 0600).
* Admin session: a Flask session cookie issued by /admin/login after the
  admin password is verified. There is no admin access at all until a
  password has been set on the device (set_admin_password.py).
* Enrollment token: short-lived random token minted when a face enrollment
  session starts; the only thing that opens the camera stream.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

INTERNAL_HEADER = "X-SkyGlass-Internal"
ENROLLMENT_HEADER = "X-SkyGlass-Enrollment"
# Sent by the portal's own JavaScript on every request. A cross-site page can
# only add a custom header through a CORS preflight, which this server never
# approves, so its presence proves the request came from a same-origin script.
CSRF_HEADER = "X-SkyGlass-Request"

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_TOKEN_RE = re.compile(r"^[0-9a-f]{64}$")


# ============================================================
# Files and secrets
# ============================================================


def data_dir() -> Path:
    """Directory for the presence server's own secrets (session key, password).

    Default: <repo>/data (shared with the backend). Env SKYGLASS_DATA_DIR
    overrides it (tests, unusual installs).
    """
    return Path(os.environ.get("SKYGLASS_DATA_DIR") or (REPO_ROOT / "data"))


def internal_token_path() -> Path:
    """Path of the token shared with the backend (same default as the backend)."""
    override = os.environ.get("SKYGLASS_INTERNAL_TOKEN_FILE")
    return Path(override) if override else REPO_ROOT / "data" / "internal-token"


def admin_password_path() -> Path:
    return data_dir() / "admin-password"


def session_secret_path() -> Path:
    return data_dir() / "admin-session-secret"


def _tighten_mode(path: Path) -> None:
    """Best effort: make an existing secret file owner-only."""
    try:
        if path.stat().st_mode & 0o077:
            os.chmod(path, 0o600)
    except OSError:
        pass


def write_secret_file(path: Path, content: str, *, replace: bool) -> bool:
    """Write ``content`` to ``path`` with mode 0600, atomically.

    The content goes to a private temp file in the same directory first, so
    readers never see a partial file. With ``replace=False`` the temp file is
    hard-linked into place, which fails if ``path`` already exists (another
    process won the race) and returns False. With ``replace=True`` it is
    renamed over any existing file.
    """
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.parent / f".{path.name}.{os.getpid()}.{secrets.token_hex(6)}.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        if replace:
            os.replace(tmp, path)
            return True
        try:
            os.link(tmp, path)
            return True
        except FileExistsError:
            return False
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def load_or_create_token(path: Path) -> str:
    """Return the 64-hex-char secret in ``path``, creating it if missing."""
    for _ in range(3):
        try:
            value = path.read_text().strip()
        except FileNotFoundError:
            write_secret_file(path, secrets.token_hex(32) + "\n", replace=False)
            continue
        if not _TOKEN_RE.fullmatch(value):
            raise RuntimeError(
                f"{path} does not contain a 64-character hex secret. "
                "Delete it and restart the backend and presence server to regenerate it."
            )
        _tighten_mode(path)
        return value
    raise RuntimeError(f"Could not create {path}")


_internal_cache: dict[str, str] = {}
_internal_lock = threading.Lock()


def get_internal_token() -> str:
    path = internal_token_path()
    key = str(path)
    with _internal_lock:
        if key not in _internal_cache:
            _internal_cache[key] = load_or_create_token(path)
        return _internal_cache[key]


def reset_internal_token_cache() -> None:
    with _internal_lock:
        _internal_cache.clear()


def get_session_secret() -> str:
    return load_or_create_token(session_secret_path())


def tokens_equal(supplied: Optional[str], expected: Optional[str]) -> bool:
    """Constant-time comparison; False for missing values."""
    if not supplied or not expected:
        return False
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def has_internal_token(req) -> bool:
    supplied = req.headers.get(INTERNAL_HEADER)
    if not supplied:
        return False
    try:
        expected = get_internal_token()
    except (OSError, RuntimeError) as e:
        print(f"[Security] Internal token unavailable: {e}")
        return False
    return tokens_equal(supplied, expected)


# ============================================================
# Admin password (scrypt)
# ============================================================

SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
SCRYPT_MAXMEM = 64 * 1024 * 1024
PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 256


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(password: str) -> str:
    """Return ``scrypt$N$r$p$<salt b64>$<hash b64>``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM, dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def is_valid_password_hash(stored: Optional[str]) -> bool:
    if not stored:
        return False
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    try:
        n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        base64.b64decode(parts[4], validate=True)
        base64.b64decode(parts[5], validate=True)
    except (ValueError, TypeError):
        return False
    # Refuse parameters weaker than ours or expensive enough to be a DoS.
    return SCRYPT_N <= n <= 2**17 and (n & (n - 1)) == 0 and r == SCRYPT_R and 1 <= p <= 2


def verify_password(password: str, stored: Optional[str]) -> bool:
    """Verify ``password`` against a scrypt hash.

    Anything else (including the old ``salt:sha256`` format) is rejected; the
    owner resets it with set_admin_password.py.
    """
    if not isinstance(password, str) or not is_valid_password_hash(stored):
        return False
    if len(password) > PASSWORD_MAX_LENGTH:
        return False
    _, n, r, p, salt_b64, hash_b64 = stored.split("$")
    expected = base64.b64decode(hash_b64)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=base64.b64decode(salt_b64), n=int(n), r=int(r), p=int(p),
        maxmem=256 * int(r) * int(n) + 1024 * 1024, dklen=len(expected),
    )
    return hmac.compare_digest(digest, expected)


def password_problem(password) -> Optional[str]:
    """Return why ``password`` is unacceptable, or None."""
    if not isinstance(password, str):
        return "Password required"
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters"
    if len(password) > PASSWORD_MAX_LENGTH:
        return f"Password must be at most {PASSWORD_MAX_LENGTH} characters"
    return None


def read_password_hash() -> Optional[str]:
    try:
        return admin_password_path().read_text().strip() or None
    except FileNotFoundError:
        return None


def is_password_set() -> bool:
    """True only when a usable (scrypt) admin password hash is stored."""
    return is_valid_password_hash(read_password_hash())


def has_legacy_password() -> bool:
    """A password file exists but is in an unsupported (old) format."""
    stored = read_password_hash()
    return stored is not None and not is_valid_password_hash(stored)


def store_password(password: str) -> None:
    problem = password_problem(password)
    if problem:
        raise ValueError(problem)
    write_secret_file(admin_password_path(), hash_password(password) + "\n", replace=True)


def clear_password() -> bool:
    try:
        admin_password_path().unlink()
        return True
    except FileNotFoundError:
        return False


def password_fingerprint() -> Optional[str]:
    """Short digest of the stored hash; sessions are bound to it so changing
    or clearing the password logs every existing session out."""
    stored = read_password_hash()
    if not is_valid_password_hash(stored):
        return None
    return hashlib.sha256(stored.encode("utf-8")).hexdigest()[:32]


# ============================================================
# Admin session + CSRF
# ============================================================


def is_admin_session(sess) -> bool:
    if not sess.get("authenticated"):
        return False
    fingerprint = password_fingerprint()
    return fingerprint is not None and tokens_equal(sess.get("pwv"), fingerprint)


def start_admin_session(sess) -> None:
    sess.clear()  # drop anything set before login (session fixation)
    sess["authenticated"] = True
    sess["pwv"] = password_fingerprint()
    sess.permanent = True


def _netloc(url: Optional[str]) -> Optional[str]:
    if not url or url == "null":
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    return parts.netloc.lower()


def same_origin(req) -> bool:
    """True when the request's Origin (or, failing that, Referer) names this
    host. Requests carrying neither are refused: every browser sends Origin
    on cross-origin and on same-origin POSTs from fetch and forms."""
    host = (req.host or "").lower()
    origin = req.headers.get("Origin")
    if origin is not None:
        return _netloc(origin) == host
    referer = req.headers.get("Referer")
    if referer is not None:
        return _netloc(referer) == host
    return False


def csrf_ok(req, *, require_header: bool = True) -> bool:
    """CSRF check for cookie-authenticated, state-changing requests."""
    if req.method in SAFE_METHODS:
        return True
    if require_header and req.headers.get(CSRF_HEADER) != "1":
        return False
    return same_origin(req)


# ============================================================
# Login rate limiting
# ============================================================


class LoginLimiter:
    """Failed-login throttle: per client address and across all clients.

    After ``per_client`` failures within ``window`` seconds a client is locked
    out until the oldest of those failures ages out; after ``global_limit``
    failures from anyone, every login is refused for the same window (stops
    a LAN attacker rotating addresses). The owner can always reset the
    password on the device with set_admin_password.py.
    """

    def __init__(self, per_client: int = 5, global_limit: int = 30, window: float = 900.0,
                 clock: Callable[[], float] = time.monotonic):
        self.per_client = per_client
        self.global_limit = global_limit
        self.window = window
        self.clock = clock
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        self._global: list[float] = []

    def _prune(self, now: float) -> None:
        cutoff = now - self.window
        self._global = [t for t in self._global if t > cutoff]
        for key in list(self._failures):
            kept = [t for t in self._failures[key] if t > cutoff]
            if kept:
                self._failures[key] = kept
            else:
                del self._failures[key]

    def retry_after(self, client: str) -> int:
        """Seconds until ``client`` may try again (0 = allowed now)."""
        with self._lock:
            now = self.clock()
            self._prune(now)
            waits = []
            mine = self._failures.get(client, [])
            if len(mine) >= self.per_client:
                waits.append(mine[-self.per_client] + self.window - now)
            if len(self._global) >= self.global_limit:
                waits.append(self._global[-self.global_limit] + self.window - now)
            return max(0, int(max(waits) + 0.999)) if waits else 0

    def record_failure(self, client: str) -> None:
        with self._lock:
            now = self.clock()
            self._prune(now)
            self._failures.setdefault(client, []).append(now)
            self._global.append(now)

    def record_success(self, client: str) -> None:
        with self._lock:
            self._failures.pop(client, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()
            self._global.clear()


# ============================================================
# Enrollment (camera) sessions
# ============================================================

ENROLLMENT_TTL_SECONDS = 600


class EnrollmentGate:
    """At most one enrollment session; its token is the only key to the camera.

    The token lives until ``close()`` or ``ttl`` seconds after ``open()``,
    whichever comes first. Opening a new session invalidates the old token.
    """

    def __init__(self, ttl: float = ENROLLMENT_TTL_SECONDS,
                 clock: Callable[[], float] = time.monotonic,
                 wall_clock: Callable[[], float] = time.time):
        self.ttl = ttl
        self.clock = clock
        self.wall_clock = wall_clock
        self._lock = threading.Lock()
        self._token: Optional[str] = None
        self._deadline = 0.0
        self._expires_at_wall = 0.0

    def open(self) -> tuple[str, float]:
        """Start a session; returns (token, expiry as wall-clock epoch seconds)."""
        with self._lock:
            self._token = secrets.token_urlsafe(32)
            self._deadline = self.clock() + self.ttl
            self._expires_at_wall = self.wall_clock() + self.ttl
            return self._token, self._expires_at_wall

    def close(self) -> None:
        with self._lock:
            self._token = None
            self._deadline = 0.0

    def _expired_locked(self) -> bool:
        return self._token is not None and self.clock() >= self._deadline

    def is_open(self) -> bool:
        with self._lock:
            if self._expired_locked():
                self._token = None
            return self._token is not None

    def check(self, supplied: Optional[str]) -> bool:
        with self._lock:
            if self._expired_locked():
                self._token = None
            return self._token is not None and tokens_equal(supplied, self._token)

    @property
    def expires_at(self) -> Optional[float]:
        with self._lock:
            return self._expires_at_wall if self._token else None

    @property
    def remaining(self) -> float:
        with self._lock:
            if self._token is None:
                return 0.0
            return max(0.0, self._deadline - self.clock())
