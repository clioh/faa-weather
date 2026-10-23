"""
NetworkManager (nmcli) WiFi helpers for SkyGlass.

Raspberry Pi OS Bookworm and Trixie (the supported releases, see
scripts/setup-pi.sh) manage wlan0 with NetworkManager: there is no dhcpcd, NM
ignores /etc/wpa_supplicant/wpa_supplicant.conf and there is no wpa_cli
control socket. Everything here goes through ``nmcli``:

- every call is an argv list (never a shell), so SSIDs and passphrases with
  spaces, quotes, colons or unicode reach nmcli unchanged;
- output is read in terse mode (``-t``), where nmcli escapes ``:`` as ``\\:``
  and ``\\`` as ``\\\\`` inside values (see ``split_terse``).

Used by wifi_provisioning.py (the SkyGlass-Setup hotspot, runs as root) and
admin_portal.py (the /api/admin/wifi/* API, runs as the install user; the
polkit rule from scripts/setup-pi.sh lets that user change NM connections).

Profiles:
- ``skyglass-setup``: the setup hotspot. Created in memory only (``save no``),
  802-11-wireless mode ap, band bg, open, ipv4.method shared on 10.42.0.1/24.
  NM's shared mode runs its own dnsmasq (DHCP + DNS); the captive-portal
  redirect (every name -> 10.42.0.1) is a file in
  /etc/NetworkManager/dnsmasq-shared.d/ that exists only while the hotspot
  is up.
- ``skyglass-wifi``: the home network joined from the phone app.

While the hotspot is up NetworkManager can't use wlan0 for anything else, so
it never retries saved networks by itself; wifi_provisioning.py takes the
hotspot down now and then and calls ``reconnect_saved``.
"""

import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

NMCLI = "nmcli"
DEFAULT_INTERFACE = "wlan0"

HOTSPOT_PROFILE = "skyglass-setup"
HOTSPOT_SSID = "SkyGlass-Setup"
HOTSPOT_ADDRESS = "10.42.0.1"
HOTSPOT_PREFIX = 24
HOTSPOT_CHANNEL = 7

HOME_PROFILE = "skyglass-wifi"
# Above NM's default (0), so the network joined from the app wins over an
# older profile (e.g. Raspberry Pi Imager's "preconfigured").
HOME_PRIORITY = 10

CAPTIVE_DNS_CONF = Path("/etc/NetworkManager/dnsmasq-shared.d/skyglass-captive.conf")

IW = "iw"

# Seconds nmcli waits for an activation, and for scans.
JOIN_TIMEOUT_SECONDS = 45
HOTSPOT_TIMEOUT_SECONDS = 30
SCAN_TIMEOUT_SECONDS = 30

Runner = Callable[..., subprocess.CompletedProcess]


class NMError(Exception):
    """nmcli failed (missing, timed out or returned non-zero)."""


# ------------------------------------------------------------ validation


def ssid_problem(ssid: object) -> Optional[str]:
    """Why an SSID can't be used, or None.

    1-32 bytes of UTF-8. Spaces, quotes, colons and unicode are fine (the SSID
    is passed to nmcli as one argv element); control characters are not
    (nmcli's line-based output could not represent them).
    """
    if not isinstance(ssid, str) or not ssid:
        return "SSID required"
    if len(ssid.encode("utf-8")) > 32:
        return "SSID must be 1-32 bytes"
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in ssid):
        return "SSID contains unsupported characters"
    return None


def password_problem(password: object) -> Optional[str]:
    """Empty (open network) or a WPA passphrase of 8-63 printable ASCII characters."""
    if not isinstance(password, str):
        return "Password must be text"
    if password and not re.fullmatch(r"[\x20-\x7e]{8,63}", password):
        return "WiFi passwords are 8-63 characters"
    return None


# ------------------------------------------------------------ parsing


def split_terse(line: str) -> List[str]:
    """Split one line of ``nmcli -t`` output into unescaped fields.

    nmcli separates fields with ``:`` and escapes ``:`` and ``\\`` inside
    values with a backslash.
    """
    fields: List[str] = []
    cur: List[str] = []
    i = 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            cur.append(line[i + 1])
            i += 2
            continue
        if c == ":":
            fields.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    fields.append("".join(cur))
    return fields


def split_key_value(line: str) -> Tuple[str, str]:
    """``KEY:value`` from ``nmcli -t ... show`` (only the first ``:`` separates)."""
    fields = split_terse(line)
    return fields[0], ":".join(fields[1:])


def security_kind(security: str) -> str:
    """nmcli's SECURITY column ("WPA1 WPA2", "WPA3", "", "--") as one word."""
    s = (security or "").strip()
    if not s or s == "--":
        return "open"
    upper = s.upper()
    if "802.1X" in upper:
        return "enterprise"
    if "WPA3" in upper and "WPA2" not in upper and "WPA1" not in upper:
        return "wpa3"
    if "WPA2" in upper or "WPA3" in upper:
        return "wpa2"
    if "WPA" in upper:
        return "wpa"
    if "WEP" in upper:
        return "wep"
    if "OWE" in upper:
        return "owe"
    return "wpa2"


@dataclass
class WiFiNetwork:
    """A network from a scan (one entry per SSID, strongest BSS)."""
    ssid: str
    signal: int  # 0-100
    security: str  # "open", "wpa", "wpa2", "wpa3", "enterprise", ...
    connected: bool = False

    @property
    def secure(self) -> bool:
        return self.security not in ("open", "owe")


def parse_scan(text: str) -> List[WiFiNetwork]:
    """Parse ``nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list``.

    Hidden networks (empty SSID) are skipped. An SSID seen on several access
    points is listed once with its strongest signal (connected if any of them
    is in use). Sorted by signal, strongest first.
    """
    best: Dict[str, WiFiNetwork] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        fields = split_terse(line)
        if len(fields) != 4:
            continue
        in_use, ssid, signal_text, security = fields
        if ssid in ("", "--"):
            continue
        try:
            signal = max(0, min(100, int(signal_text)))
        except ValueError:
            signal = 0
        connected = in_use.strip() == "*"
        net = WiFiNetwork(ssid=ssid, signal=signal, security=security_kind(security), connected=connected)
        prev = best.get(ssid)
        if prev is None:
            best[ssid] = net
        else:
            if net.signal > prev.signal:
                net.connected = net.connected or prev.connected
                best[ssid] = net
            else:
                prev.connected = prev.connected or net.connected
    return sorted(best.values(), key=lambda n: (-n.signal, n.ssid))


def parse_device_show(text: str) -> dict:
    """``nmcli -t -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS device show``."""
    info = {"state": 0, "connection": "", "ipv4": []}
    for line in text.splitlines():
        if not line.strip():
            continue
        key, value = split_key_value(line)
        if key == "GENERAL.STATE":
            m = re.match(r"\s*(\d+)", value)
            info["state"] = int(m.group(1)) if m else 0
        elif key == "GENERAL.CONNECTION":
            info["connection"] = "" if value == "--" else value
        elif key.startswith("IP4.ADDRESS") and value:
            info["ipv4"].append(value.split("/")[0])
    return info


def explain_failure(ssid: str, stderr: str) -> str:
    """A message for the phone from nmcli's error output."""
    text = (stderr or "").strip()
    low = text.lower()
    if "secrets were required" in low or "802-11-wireless-security" in low or "psk" in low:
        return f"The password for \"{ssid}\" was not accepted. Check it and try again."
    if "no network with ssid" in low:
        return (
            f"The mirror couldn't find \"{ssid}\". Check the name and that the network "
            "is in range (2.4 GHz works on every Raspberry Pi)."
        )
    first = text.splitlines()[0] if text else "unknown error"
    return f"Couldn't join \"{ssid}\": {first}"


# ------------------------------------------------------------ NetworkManager


class NetworkManager:
    """nmcli calls for one WiFi interface. ``run``/``sleep``/``clock`` are injectable for tests."""

    def __init__(
        self,
        interface: str = DEFAULT_INTERFACE,
        run: Optional[Runner] = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        captive_conf: Path = CAPTIVE_DNS_CONF,
    ):
        self.interface = interface
        self._run = run or subprocess.run
        self.sleep = sleep
        self.clock = clock
        self.captive_conf = Path(captive_conf)

    @staticmethod
    def available() -> bool:
        return shutil.which(NMCLI) is not None

    def nmcli(self, *args: str, timeout: float = 15) -> subprocess.CompletedProcess:
        """Run ``nmcli <args>``; raises NMError if it can't run or times out."""
        argv = [NMCLI, *args]
        try:
            return self._run(argv, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as e:
            raise NMError(f"nmcli timed out after {timeout:g}s") from e
        except OSError as e:
            raise NMError(f"nmcli failed: {e}") from e

    def _check(self, *args: str, timeout: float = 15) -> subprocess.CompletedProcess:
        result = self.nmcli(*args, timeout=timeout)
        if result.returncode != 0:
            raise NMError((result.stderr or result.stdout or "nmcli failed").strip())
        return result

    # ---- state

    def scan(self, rescan: bool = True) -> List[WiFiNetwork]:
        """Networks visible on the interface. ``rescan`` asks NM for a fresh scan first."""
        result = self._check(
            "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY",
            "device", "wifi", "list",
            "--rescan", "yes" if rescan else "no",
            "ifname", self.interface,
            timeout=SCAN_TIMEOUT_SECONDS,
        )
        return parse_scan(result.stdout)

    def device_info(self, device: Optional[str] = None) -> dict:
        result = self._check(
            "-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS",
            "device", "show", device or self.interface,
        )
        return parse_device_show(result.stdout)

    def devices(self) -> List[dict]:
        """``nmcli device status`` rows: device, type, state, connection."""
        result = self._check("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status")
        rows = []
        for line in result.stdout.splitlines():
            fields = split_terse(line)
            if len(fields) == 4:
                rows.append(dict(zip(("device", "type", "state", "connection"), fields)))
        return rows

    def online(self) -> Optional[Tuple[str, str]]:
        """(device, IPv4) of a connected wifi/ethernet link other than the hotspot, or None."""
        for row in self.devices():
            if row["type"] not in ("wifi", "ethernet") or row["state"] != "connected":
                continue
            if row["connection"] == HOTSPOT_PROFILE:
                continue
            info = self.device_info(row["device"])
            if info["ipv4"]:
                return row["device"], info["ipv4"][0]
        return None

    def current_ssid(self) -> Optional[str]:
        """SSID the interface is associated with (not the hotspot), or None."""
        for net in self.scan(rescan=False):
            if net.connected and net.ssid != HOTSPOT_SSID:
                return net.ssid
        return None

    def status(self) -> dict:
        """{"connected", "ssid", "ip"} for the WiFi interface."""
        info = self.device_info()
        connected = info["state"] == 100 and info["connection"] != HOTSPOT_PROFILE and bool(info["ipv4"])
        ssid = self.current_ssid() if connected else None
        return {
            "connected": connected,
            "ssid": ssid or "",
            "ip": info["ipv4"][0] if connected else "",
        }

    def profiles(self) -> List[Tuple[str, str]]:
        """(name, uuid) of every saved connection."""
        result = self._check("-t", "-f", "NAME,UUID", "connection", "show")
        out = []
        for line in result.stdout.splitlines():
            fields = split_terse(line)
            if len(fields) == 2:
                out.append((fields[0], fields[1]))
        return out

    def saved_wifi_profiles(self) -> List[Tuple[str, str]]:
        """(name, uuid) of saved WiFi profiles that autoconnect (not the hotspot).

        Highest ``connection.autoconnect-priority`` first, so ``skyglass-wifi``
        (priority 10) comes before e.g. Raspberry Pi Imager's ``preconfigured``.
        """
        result = self._check(
            "-t", "-f", "NAME,UUID,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY", "connection", "show",
        )
        rows = []
        for line in result.stdout.splitlines():
            fields = split_terse(line)
            if len(fields) != 5:
                continue
            name, uuid, ctype, autoconnect, priority = fields
            if ctype not in ("802-11-wireless", "wifi") or name == HOTSPOT_PROFILE:
                continue
            if autoconnect.strip().lower() != "yes":
                continue
            try:
                prio = int(priority)
            except ValueError:
                prio = 0
            rows.append((prio, name, uuid))
        rows.sort(key=lambda r: -r[0])
        return [(name, uuid) for _, name, uuid in rows]

    def hotspot_clients(self) -> Optional[int]:
        """Stations associated with the hotspot (``iw dev <if> station dump``); None if unknown."""
        try:
            result = self._run(
                [IW, "dev", self.interface, "station", "dump"],
                capture_output=True, text=True, timeout=5,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        if result.returncode != 0:
            return None
        return sum(1 for line in result.stdout.splitlines() if line.startswith("Station "))

    # ---- hotspot

    def hotspot_add_args(self) -> List[str]:
        return [
            "connection", "add", "save", "no",
            "type", "wifi",
            "ifname", self.interface,
            "con-name", HOTSPOT_PROFILE,
            "autoconnect", "no",
            "ssid", HOTSPOT_SSID,
            "802-11-wireless.mode", "ap",
            "802-11-wireless.band", "bg",
            "802-11-wireless.channel", str(HOTSPOT_CHANNEL),
            "802-11-wireless.powersave", "2",
            "ipv4.method", "shared",
            "ipv4.addresses", f"{HOTSPOT_ADDRESS}/{HOTSPOT_PREFIX}",
            "ipv6.method", "disabled",
        ]

    def write_captive_dns(self) -> bool:
        """Make NM's shared-mode dnsmasq answer every name with the hotspot address."""
        try:
            self.captive_conf.parent.mkdir(parents=True, exist_ok=True)
            self.captive_conf.write_text(
                "# Written by SkyGlass wifi_provisioning.py while the setup hotspot is up.\n"
                f"address=/#/{HOTSPOT_ADDRESS}\n"
            )
            return True
        except OSError as e:
            print(f"Captive portal DNS not configured ({self.captive_conf}): {e}")
            return False

    def remove_captive_dns(self) -> None:
        try:
            self.captive_conf.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            print(f"Could not remove {self.captive_conf}: {e}")

    def radio_on(self) -> None:
        """Make sure NM's WiFi radio is enabled (errors ignored: the next call reports them)."""
        try:
            self.nmcli("radio", "wifi", "on")
        except NMError as e:
            print(f"nmcli radio wifi on: {e}")

    def start_hotspot(self, captive_dns: bool = True) -> None:
        """Bring up the open SkyGlass-Setup hotspot on 10.42.0.1. Raises NMError."""
        if captive_dns:
            # Read by NM's dnsmasq when the shared connection activates.
            self.write_captive_dns()
        self.radio_on()
        self.nmcli("connection", "delete", "id", HOTSPOT_PROFILE)
        self._check(*self.hotspot_add_args())
        self._check(
            "--wait", str(HOTSPOT_TIMEOUT_SECONDS), "connection", "up", "id", HOTSPOT_PROFILE,
            timeout=HOTSPOT_TIMEOUT_SECONDS + 15,
        )

    def stop_hotspot(self) -> None:
        """Take the hotspot down and forget it (errors ignored)."""
        for args in (
            ("connection", "down", "id", HOTSPOT_PROFILE),
            ("connection", "delete", "id", HOTSPOT_PROFILE),
        ):
            try:
                self.nmcli(*args, timeout=HOTSPOT_TIMEOUT_SECONDS)
            except NMError as e:
                print(f"nmcli {' '.join(args)}: {e}")
        self.remove_captive_dns()

    # ---- home network

    def _find(self, ssid: str, attempts: int = 3) -> Optional[WiFiNetwork]:
        """``ssid`` in a fresh scan (a few tries: the radio may have just left AP mode)."""
        for i in range(attempts):
            try:
                for net in self.scan(rescan=True):
                    if net.ssid == ssid:
                        return net
            except NMError as e:
                print(f"Scan failed: {e}")
            if i + 1 < attempts:
                self.sleep(3)
        return None

    def home_add_args(self, ssid: str, password: str, hidden: bool, security: str,
                      autoconnect: bool) -> List[str]:
        args = [
            "connection", "add",
            "type", "wifi",
            "ifname", self.interface,
            "con-name", HOME_PROFILE,
            "autoconnect", "yes" if autoconnect else "no",
            "ssid", ssid,
            "802-11-wireless.hidden", "yes" if hidden else "no",
        ]
        if autoconnect:
            args += ["connection.autoconnect-priority", str(HOME_PRIORITY)]
        if password:
            key_mgmt = "sae" if security == "wpa3" else "wpa-psk"
            args += [
                "802-11-wireless-security.key-mgmt", key_mgmt,
                "802-11-wireless-security.psk", password,
            ]
        return args

    def _add_home(self, ssid: str, password: str, autoconnect: bool) -> str:
        """Create a profile for ``ssid``; returns its UUID."""
        net = self._find(ssid, attempts=3 if not autoconnect else 1)
        hidden = net is None
        security = net.security if net else ("wpa2" if password else "open")
        result = self._check(*self.home_add_args(ssid, password, hidden, security, autoconnect))
        m = re.search(r"\(([0-9a-fA-F-]{36})\)", result.stdout)
        if not m:
            raise NMError(f"Unexpected nmcli output: {result.stdout.strip()}")
        return m.group(1)

    def _delete_other_home_profiles(self, keep_uuid: str, keep_active: bool = False) -> None:
        active = set()
        if keep_active:
            try:
                result = self._check("-t", "-f", "UUID", "connection", "show", "--active")
                active = {split_terse(line)[0] for line in result.stdout.splitlines() if line.strip()}
            except NMError:
                return
        try:
            profiles = self.profiles()
        except NMError as e:
            print(f"Could not list connections: {e}")
            return
        for name, uuid in profiles:
            if name == HOME_PROFILE and uuid != keep_uuid and uuid not in active:
                self.nmcli("connection", "delete", "uuid", uuid)

    def join(self, ssid: str, password: str, timeout: int = JOIN_TIMEOUT_SECONDS) -> Tuple[bool, Optional[str]]:
        """Connect the interface to ``ssid``. Returns (ok, error message).

        Creates a profile (WPA2/WPA3 personal or open, hidden if the network
        isn't in the scan), activates it and checks the interface got an IPv4
        address. On success the profile autoconnects from then on and older
        skyglass-wifi profiles are removed; on failure it is deleted.
        """
        try:
            uuid = self._add_home(ssid, password, autoconnect=False)
        except NMError as e:
            return False, explain_failure(ssid, str(e))

        ok, error = False, None
        try:
            result = self.nmcli(
                "--wait", str(timeout), "connection", "up", "uuid", uuid,
                timeout=timeout + 15,
            )
            if result.returncode != 0:
                error = explain_failure(ssid, result.stderr or result.stdout)
            elif self._wait_for_ip(profile_name=HOME_PROFILE):
                ok = True
            else:
                error = f"The mirror joined \"{ssid}\" but got no IP address. Check the router's DHCP."
        except NMError:
            error = (
                f"The mirror couldn't join \"{ssid}\" within {timeout} seconds. "
                "Check the password and that the network is in range."
            )

        if ok:
            try:
                self._check(
                    "connection", "modify", "uuid", uuid,
                    "connection.autoconnect", "yes",
                    "connection.autoconnect-priority", str(HOME_PRIORITY),
                )
            except NMError as e:
                print(f"Could not enable autoconnect for {HOME_PROFILE}: {e}")
            self._delete_other_home_profiles(uuid)
            return True, None

        try:
            self.nmcli("connection", "delete", "uuid", uuid)
        except NMError as e:
            print(f"Could not delete failed profile {uuid}: {e}")
        return False, error

    def _wait_for_ip(self, profile_name: str, seconds: float = 20) -> bool:
        deadline = self.clock() + seconds
        while True:
            try:
                info = self.device_info()
                if info["state"] == 100 and info["connection"] == profile_name and info["ipv4"]:
                    return True
            except NMError:
                pass
            if self.clock() >= deadline:
                return False
            self.sleep(1)

    def reconnect_saved(self, profiles: List[Tuple[str, str]],
                        timeout: float = JOIN_TIMEOUT_SECONDS) -> Optional[str]:
        """Try to bring up ``profiles`` (name, uuid) in order, within ``timeout`` seconds in all.

        The hotspot must already be down. Returns the name of the profile that
        connected with an IPv4 address, or None. Profiles are never changed or
        deleted: a network that is only away (router still booting) stays saved.
        """
        deadline = self.clock() + timeout
        for name, uuid in profiles:
            remaining = int(deadline - self.clock())
            if remaining < 5:
                break
            try:
                result = self.nmcli(
                    "--wait", str(remaining), "connection", "up", "uuid", uuid,
                    timeout=remaining + 15,
                )
            except NMError as e:
                print(f"Saved network {name}: {e}")
                continue
            if result.returncode != 0:
                first = (result.stderr or result.stdout or "failed").strip().splitlines()
                print(f"Saved network {name} not available: {first[0] if first else 'failed'}")
                continue
            if self._wait_for_ip(profile_name=name):
                return name
            print(f"Saved network {name} connected but got no IP address")
        return None

    def save_network(self, ssid: str, password: str) -> None:
        """Remember ``ssid`` (autoconnect) without leaving the current network. Raises NMError.

        Older inactive skyglass-wifi profiles are replaced; the active one is
        kept so the mirror stays online.
        """
        uuid = self._add_home(ssid, password, autoconnect=True)
        self._delete_other_home_profiles(uuid, keep_active=True)
