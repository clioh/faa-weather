"""nm_wifi.py: the exact nmcli argv for the hotspot and joins, and parsing of
nmcli's terse output. No real nmcli: subprocess.run is a fake that records
every argv and answers from a script of (match, result) pairs."""

import subprocess

import pytest

import nm_wifi as nm

UUID = "5b3c9e4e-1f7a-4c1e-9d2a-0a1b2c3d4e5f"
OLD_UUID = "11111111-2222-3333-4444-555555555555"


class FakeRun:
    """subprocess.run stand-in. ``rules`` maps an argv prefix (after "nmcli")
    to a CompletedProcess, an exception, or a callable(argv) returning one."""

    def __init__(self):
        self.calls = []
        self.rules = []
        self.kwargs = []

    def on(self, *prefix, out="", err="", rc=0, raises=None):
        self.rules.append((tuple(prefix), (out, err, rc, raises)))

    def __call__(self, argv, **kwargs):
        assert isinstance(argv, list), "nmcli must get an argv list, never a shell string"
        assert "shell" not in kwargs
        self.calls.append(argv)
        self.kwargs.append(kwargs)
        assert argv[0] == "nmcli"
        args = tuple(argv[1:])
        for prefix, (out, err, rc, raises) in self.rules:
            if args[:len(prefix)] == prefix:
                if raises is not None:
                    raise raises
                return subprocess.CompletedProcess(argv, rc, out, err)
        return subprocess.CompletedProcess(argv, 0, "", "")

    def args(self):
        return [tuple(c[1:]) for c in self.calls]


@pytest.fixture
def run():
    return FakeRun()


@pytest.fixture
def mgr(run, tmp_path):
    clock = {"t": 0.0}

    def sleep(s):
        clock["t"] += s

    return nm.NetworkManager(
        "wlan0", run=run, sleep=sleep, clock=lambda: clock["t"],
        captive_conf=tmp_path / "dnsmasq-shared.d" / "skyglass-captive.conf",
    )


SCAN_PREFIX = ("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list")


# ------------------------------------------------------------ parsing


@pytest.mark.parametrize("line, fields", [
    ("a:b:c", ["a", "b", "c"]),
    (r"*:My\:Net:80:WPA2", ["*", "My:Net", "80", "WPA2"]),
    (r" :back\\slash:5:", [" ", "back\\slash", "5", ""]),
    (r" :end\:\::5:WPA2", [" ", "end::", "5", "WPA2"]),
    ("", [""]),
])
def test_split_terse(line, fields):
    assert nm.split_terse(line) == fields


def test_parse_scan_escapes_duplicates_hidden_and_sort():
    text = "\n".join([
        r" :Home:40:WPA2",
        r"*:Home:72:WPA2",            # same SSID, second AP: in use and stronger
        r" :Home:65:WPA2",
        r" :Café \"Guest\":90:",   # literal backslash-u in a name? no: see below
        r" :Hangar\: Ops:55:WPA1 WPA2",
        r" ::99:WPA2",                  # hidden network: no SSID
        r" :Tower:30:WPA3",
        r" :Ramp:30:WPA2 WPA3",
        r" :Corp:20:WPA2 802.1X",
        "garbage line",
    ])
    nets = nm.parse_scan(text)
    names = [n.ssid for n in nets]
    assert names == ['Café "Guest"', "Home", "Hangar: Ops", "Ramp", "Tower", "Corp"]
    home = nets[1]
    assert (home.signal, home.connected, home.security, home.secure) == (72, True, "wpa2", True)
    assert nets[0].security == "open" and nets[0].secure is False
    assert {n.ssid: n.security for n in nets}["Tower"] == "wpa3"
    assert {n.ssid: n.security for n in nets}["Ramp"] == "wpa2"
    assert {n.ssid: n.security for n in nets}["Corp"] == "enterprise"


def test_parse_scan_unicode_and_connected_on_weaker_ap():
    nets = nm.parse_scan("*:Café ✈:30:WPA2\n :Café ✈:60:WPA2\n")
    assert len(nets) == 1
    assert nets[0].ssid == "Café ✈" and nets[0].signal == 60 and nets[0].connected


def test_parse_device_show():
    info = nm.parse_device_show(
        "GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:skyglass-wifi\n"
        "IP4.ADDRESS[1]:192.168.1.20/24\nIP4.ADDRESS[2]:10.0.0.5/8\n"
    )
    assert info == {"state": 100, "connection": "skyglass-wifi", "ipv4": ["192.168.1.20", "10.0.0.5"]}
    assert nm.parse_device_show("GENERAL.STATE:30 (disconnected)\nGENERAL.CONNECTION:--\n") == \
        {"state": 30, "connection": "", "ipv4": []}


@pytest.mark.parametrize("ssid, ok", [
    ("Home", True),
    ('My "quoted" net', True),
    ("Hangar: Ops", True),
    ("  spaces  ", True),
    ("Café ✈", True),
    ("x" * 32, True),
    ("é" * 17, False),  # 34 bytes
    ("", False),
    ("bad\nssid", False),
    ("nul\x00", False),
    (None, False),
])
def test_ssid_problem(ssid, ok):
    assert (nm.ssid_problem(ssid) is None) == ok


@pytest.mark.parametrize("pw, ok", [
    ("", True),
    ("12345678", True),
    ('pa ss "word" \\ $(rm -rf) ;', True),
    ("x" * 63, True),
    ("x" * 64, False),
    ("short", False),
    ("pässwörd", False),
    ("line\nbreak!", False),
])
def test_password_problem(pw, ok):
    assert (nm.password_problem(pw) is None) == ok


# ------------------------------------------------------------ scan


def test_scan_argv(mgr, run):
    run.on(*SCAN_PREFIX, out=r"*:Home:72:WPA2" + "\n")
    nets = mgr.scan()
    assert run.calls == [[
        "nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
        "--rescan", "yes", "ifname", "wlan0",
    ]]
    assert nets[0].ssid == "Home"
    mgr.scan(rescan=False)
    assert run.calls[1][8] == "no"


def test_scan_failure_raises(mgr, run):
    run.on(*SCAN_PREFIX, err="Error: Device 'wlan0' not found.", rc=10)
    with pytest.raises(nm.NMError, match="not found"):
        mgr.scan()


def test_nmcli_timeout_and_missing_binary(mgr, run):
    run.on("radio", raises=subprocess.TimeoutExpired("nmcli", 15))
    with pytest.raises(nm.NMError, match="timed out"):
        mgr.nmcli("radio", "wifi")
    run.rules.clear()
    run.on("radio", raises=FileNotFoundError("nmcli"))
    with pytest.raises(nm.NMError):
        mgr.nmcli("radio", "wifi")


# ------------------------------------------------------------ hotspot


HOTSPOT_ADD = (
    "connection", "add", "save", "no", "type", "wifi", "ifname", "wlan0",
    "con-name", "skyglass-setup", "autoconnect", "no", "ssid", "SkyGlass-Setup",
    "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg", "802-11-wireless.channel", "7",
    "802-11-wireless.powersave", "2", "ipv4.method", "shared", "ipv4.addresses", "10.42.0.1/24",
    "ipv6.method", "disabled",
)


def test_hotspot_up_argv_and_captive_dns(mgr, run):
    mgr.start_hotspot()
    assert run.args() == [
        ("radio", "wifi", "on"),
        ("connection", "delete", "id", "skyglass-setup"),
        HOTSPOT_ADD,
        ("--wait", "30", "connection", "up", "id", "skyglass-setup"),
    ]
    # Open network: no wireless-security settings at all.
    assert not any("802-11-wireless-security" in a for a in HOTSPOT_ADD)
    assert mgr.captive_conf.read_text().splitlines()[-1] == "address=/#/10.42.0.1"


def test_hotspot_without_captive_dns(mgr, run):
    mgr.start_hotspot(captive_dns=False)
    assert not mgr.captive_conf.exists()


def test_hotspot_up_failure_raises(mgr, run):
    run.on("--wait", "30", "connection", "up", err="Error: Connection activation failed", rc=4)
    with pytest.raises(nm.NMError, match="activation failed"):
        mgr.start_hotspot()


def test_hotspot_down_argv_removes_captive_dns(mgr, run):
    mgr.write_captive_dns()
    run.on("connection", "down", err="not active", rc=10)  # errors are ignored
    mgr.stop_hotspot()
    assert run.args() == [
        ("connection", "down", "id", "skyglass-setup"),
        ("connection", "delete", "id", "skyglass-setup"),
    ]
    assert not mgr.captive_conf.exists()


# ------------------------------------------------------------ join


def added(uuid=UUID):
    return f"Connection 'skyglass-wifi' ({uuid}) successfully added.\n"


def connected_device():
    return "GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:skyglass-wifi\nIP4.ADDRESS[1]:192.168.1.20/24\n"


def setup_join(run, scan_out, up_rc=0, up_err="", device=None):
    run.on(*SCAN_PREFIX, out=scan_out)
    run.on("connection", "add", out=added())
    run.on("--wait", "45", "connection", "up", "uuid", UUID, rc=up_rc, err=up_err)
    run.on("-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS", "device", "show",
           out=device if device is not None else connected_device())
    run.on("-t", "-f", "NAME,UUID", "connection", "show",
           out=f"preconfigured:aaaa\nskyglass-wifi:{OLD_UUID}\nskyglass-wifi:{UUID}\n")


def add_call(run):
    return next(a for a in run.args() if a[:2] == ("connection", "add"))


@pytest.mark.parametrize("ssid, password", [
    ("Home", "correct horse"),
    ('My "Quoted" Net', 'pa ss "word" $(reboot) ;'),
    ("Hangar: Ops", "colon:pass:word"),
    ("Café ✈", "unicode-ssid"),
])
def test_join_success_argv(mgr, run, ssid, password):
    escaped = ssid.replace("\\", "\\\\").replace(":", "\\:")
    setup_join(run, f"*:{escaped}:70:WPA2\n")
    ok, error = mgr.join(ssid, password)
    assert (ok, error) == (True, None)
    assert add_call(run) == (
        "connection", "add", "type", "wifi", "ifname", "wlan0", "con-name", "skyglass-wifi",
        "autoconnect", "no", "ssid", ssid, "802-11-wireless.hidden", "no",
        "802-11-wireless-security.key-mgmt", "wpa-psk", "802-11-wireless-security.psk", password,
    )
    args = run.args()
    assert ("--wait", "45", "connection", "up", "uuid", UUID) in args
    assert ("connection", "modify", "uuid", UUID, "connection.autoconnect", "yes",
            "connection.autoconnect-priority", "10") in args
    # the older skyglass-wifi profile goes, the new one and others stay
    assert ("connection", "delete", "uuid", OLD_UUID) in args
    assert ("connection", "delete", "uuid", UUID) not in args
    assert not any(a[:3] == ("connection", "delete", "uuid") and a[3] == "aaaa" for a in args)


def test_join_wpa3_only_uses_sae(mgr, run):
    setup_join(run, " :Tower:70:WPA3\n")
    assert mgr.join("Tower", "12345678")[0]
    call = add_call(run)
    assert call[call.index("802-11-wireless-security.key-mgmt") + 1] == "sae"


def test_join_open_network_has_no_security(mgr, run):
    setup_join(run, " :Cafe:70:\n")
    assert mgr.join("Cafe", "")[0]
    assert not any("802-11-wireless-security" in a for a in add_call(run))


def test_join_hidden_network(mgr, run):
    setup_join(run, " :Other:70:WPA2\n")
    assert mgr.join("Secret Hangar", "12345678")[0]
    call = add_call(run)
    assert call[call.index("802-11-wireless.hidden") + 1] == "yes"
    assert call[call.index("802-11-wireless-security.key-mgmt") + 1] == "wpa-psk"
    # scanned a few times (the radio may have just left AP mode) before giving up
    assert sum(1 for a in run.args() if a[:6] == SCAN_PREFIX) == 3


def test_join_wrong_password_deletes_profile(mgr, run):
    setup_join(run, " :Home:70:WPA2\n", up_rc=4,
               up_err="Error: Connection activation failed: Secrets were required, but not provided.")
    ok, error = mgr.join("Home", "wrongpass")
    assert not ok
    assert "password" in error and '"Home"' in error
    args = run.args()
    assert ("connection", "delete", "uuid", UUID) in args
    assert not any(a[:2] == ("connection", "modify") for a in args)


def test_join_timeout(mgr, run):
    setup_join(run, " :Home:70:WPA2\n")
    run.rules.insert(0, (("--wait", "45", "connection", "up"),
                         ("", "", 0, subprocess.TimeoutExpired("nmcli", 60))))
    ok, error = mgr.join("Home", "12345678")
    assert not ok and "within 45 seconds" in error
    assert ("connection", "delete", "uuid", UUID) in run.args()
    up = run.calls.index(["nmcli", "--wait", "45", "connection", "up", "uuid", UUID])
    assert run.kwargs[up]["timeout"] == 60


def test_join_without_ip_fails(mgr, run):
    setup_join(run, " :Home:70:WPA2\n",
               device="GENERAL.STATE:70 (connecting (getting IP configuration))\nGENERAL.CONNECTION:skyglass-wifi\n")
    ok, error = mgr.join("Home", "12345678")
    assert not ok and "IP address" in error
    assert ("connection", "delete", "uuid", UUID) in run.args()


def test_join_add_failure(mgr, run):
    run.on(*SCAN_PREFIX, out=" :Home:70:WPA2\n")
    run.on("connection", "add", err="Error: 802-11-wireless-security.psk: property is invalid.", rc=2)
    ok, error = mgr.join("Home", "12345678")
    assert not ok and "password" in error
    assert not any(a[:3] == ("--wait", "45", "connection") for a in run.args())


def test_save_network_keeps_active_profile(mgr, run):
    run.on(*SCAN_PREFIX, out=" :New Net:70:WPA2\n")
    run.on("connection", "add", out=added())
    run.on("-t", "-f", "UUID", "connection", "show", "--active", out=f"{OLD_UUID}\n")
    run.on("-t", "-f", "NAME,UUID", "connection", "show",
           out=f"skyglass-wifi:{OLD_UUID}\nskyglass-wifi:{UUID}\nskyglass-wifi:dead-1\n")
    mgr.save_network("New Net", "12345678")
    call = add_call(run)
    assert call[call.index("autoconnect") + 1] == "yes"
    assert call[call.index("connection.autoconnect-priority") + 1] == "10"
    args = run.args()
    assert ("connection", "delete", "uuid", "dead-1") in args
    assert ("connection", "delete", "uuid", OLD_UUID) not in args  # still in use
    assert not any(a[:2] == ("--wait", "45") for a in args)  # never leaves the current network


# ------------------------------------------------------------ status


def test_online_skips_hotspot_and_unaddressed_links(mgr, run):
    run.on("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status",
           out="wlan0:wifi:connected:skyglass-setup\neth0:ethernet:connected:Wired\nlo:loopback:connected (externally):lo\n")
    run.on("-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS", "device", "show", "eth0",
           out="GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:Wired\nIP4.ADDRESS[1]:192.168.1.9/24\n")
    assert mgr.online() == ("eth0", "192.168.1.9")
    assert not any(a[-1] == "wlan0" and "show" in a for a in run.args())


def test_online_none_when_only_hotspot(mgr, run):
    run.on("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status",
           out="wlan0:wifi:connected:skyglass-setup\neth0:ethernet:unavailable:\n")
    assert mgr.online() is None


def test_status(mgr, run):
    run.on("-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS", out=connected_device())
    run.on(*SCAN_PREFIX, out=r"*:My\:Home:70:WPA2" + "\n :Other:80:WPA2\n")
    assert mgr.status() == {"connected": True, "ssid": "My:Home", "ip": "192.168.1.20"}
    assert run.args()[-1][7] == "no"  # status never forces a rescan


# ------------------------------------------------------------ saved networks


PROFILES = ("-t", "-f", "NAME,UUID,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY", "connection", "show")


def test_saved_wifi_profiles_order_and_filter(mgr, run):
    run.on(*PROFILES, out="\n".join([
        "preconfigured:aaaa:802-11-wireless:yes:0",
        "skyglass-setup:hhhh:802-11-wireless:no:0",      # the hotspot
        "Wired connection 1:wwww:802-3-ethernet:yes:-999",
        r"Hangar\: Ops:cccc:802-11-wireless:yes:5",
        "skyglass-wifi:bbbb:802-11-wireless:yes:10",
        "old-manual:dddd:802-11-wireless:no:20",           # never autoconnects
        "garbage",
    ]) + "\n")
    assert mgr.saved_wifi_profiles() == [
        ("skyglass-wifi", "bbbb"), ("Hangar: Ops", "cccc"), ("preconfigured", "aaaa"),
    ]


def test_reconnect_saved_tries_each_until_one_has_an_address(mgr, run):
    run.on("--wait", "45", "connection", "up", "uuid", "bbbb", rc=10,
           err="Error: Connection activation failed: No network with SSID 'Home' found.\n")
    run.on("--wait", "45", "connection", "up", "uuid", "aaaa")
    run.on("-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS", "device", "show",
           out="GENERAL.STATE:100 (connected)\nGENERAL.CONNECTION:preconfigured\nIP4.ADDRESS[1]:192.168.7.3/24\n")
    got = mgr.reconnect_saved([("skyglass-wifi", "bbbb"), ("preconfigured", "aaaa")], timeout=45)
    assert got == "preconfigured"
    ups = [a for a in run.args() if a[:3] == ("--wait", "45", "connection")]
    assert ups == [("--wait", "45", "connection", "up", "uuid", "bbbb"),
                   ("--wait", "45", "connection", "up", "uuid", "aaaa")]
    # Saved profiles are never modified or deleted
    assert not any(a[:2] in (("connection", "delete"), ("connection", "modify")) for a in run.args())


def test_reconnect_saved_none_when_nothing_comes_up(mgr, run):
    run.on("--wait", "45", "connection", "up", rc=4, err="Error: activation failed")
    assert mgr.reconnect_saved([("skyglass-wifi", "bbbb")], timeout=45) is None


def test_reconnect_saved_up_but_no_address(mgr, run):
    run.on("-t", "-f", "GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS", "device", "show",
           out="GENERAL.STATE:70 (connecting (getting IP configuration))\nGENERAL.CONNECTION:skyglass-wifi\n")
    assert mgr.reconnect_saved([("skyglass-wifi", "bbbb")], timeout=45) is None


def test_reconnect_saved_keeps_to_the_overall_timeout(mgr, run):
    def slow_up(argv):
        mgr.sleep(43)  # the fake clock moves while nmcli "waits"
        return subprocess.CompletedProcess(argv, 4, "", "Error: timeout")

    calls = []

    def runner(argv, **kwargs):
        calls.append(argv)
        if argv[1] == "--wait" and "up" in argv:
            return slow_up(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    mgr._run = runner
    assert mgr.reconnect_saved([("a", "1"), ("b", "2")], timeout=45) is None
    assert [c for c in calls if "up" in c] == [["nmcli", "--wait", "45", "connection", "up", "uuid", "1"]]


def test_hotspot_clients(mgr):
    out = "Station 3a:11:22:33:44:55 (on wlan0)\n\tinactive time:\t120 ms\nStation 4e:aa:bb:cc:dd:ee (on wlan0)\n"
    seen = []

    def runner(argv, **kwargs):
        seen.append(argv)
        return subprocess.CompletedProcess(argv, 0, out, "")

    mgr._run = runner
    assert mgr.hotspot_clients() == 2
    assert seen == [["iw", "dev", "wlan0", "station", "dump"]]

    mgr._run = lambda argv, **kw: (_ for _ in ()).throw(FileNotFoundError("iw"))
    assert mgr.hotspot_clients() is None
    mgr._run = lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "", "command failed")
    assert mgr.hotspot_clients() is None
