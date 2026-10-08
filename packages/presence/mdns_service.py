#!/usr/bin/env python3
"""
mDNS/Bonjour Service for SkyGlass.

Announces the SkyGlass on the local network so it can be discovered
as 'skyglass.local' without needing to know the IP address.

This uses the zeroconf library to advertise the service.
On Raspberry Pi, avahi-daemon provides the underlying mDNS responder.

Usage:
    python mdns_service.py

The service advertises:
    - skyglass.local -> HTTP (port 80)
    - _skyglass._tcp -> SkyGlass service discovery
    - _http._tcp -> Web server
"""

import socket
import signal
import sys
import time
import argparse
from typing import Optional

try:
    from zeroconf import ServiceInfo, Zeroconf
    ZEROCONF_AVAILABLE = True
except ImportError:
    ZEROCONF_AVAILABLE = False


def get_local_ip() -> str:
    """Get the local IP address."""
    try:
        # Create a socket to determine the local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_hostname() -> str:
    """Get the hostname."""
    return socket.gethostname()


class SkyGlassMDNS:
    """Manages mDNS service advertisement for SkyGlass."""

    def __init__(self, http_port: int = 80, https_port: int = 443, admin_port: int = 5000):
        self.http_port = http_port
        self.https_port = https_port
        self.admin_port = admin_port
        self.zeroconf: Optional[Zeroconf] = None
        self.services: list[ServiceInfo] = []
        self.running = False

    def start(self):
        """Start advertising mDNS services."""
        if not ZEROCONF_AVAILABLE:
            print("ERROR: zeroconf library not available")
            print("Install with: pip install zeroconf")
            return False

        self.zeroconf = Zeroconf()
        ip_addr = get_local_ip()
        hostname = get_hostname()

        print(f"Starting mDNS advertisement...")
        print(f"  Hostname: {hostname}")
        print(f"  IP Address: {ip_addr}")
        print()

        # Convert IP to bytes for ServiceInfo
        ip_bytes = socket.inet_aton(ip_addr)

        # Service properties
        properties = {
            b"version": b"1.0",
            b"device": b"SkyGlass",
            b"path": b"/",
        }

        # Register SkyGlass-specific service type
        skyglass_service = ServiceInfo(
            "_skyglass._tcp.local.",
            f"SkyGlass ({hostname})._skyglass._tcp.local.",
            addresses=[ip_bytes],
            port=self.http_port,
            properties=properties,
            server=f"{hostname}.local.",
        )
        self.services.append(skyglass_service)

        # Register as HTTP service
        http_service = ServiceInfo(
            "_http._tcp.local.",
            f"SkyGlass._http._tcp.local.",
            addresses=[ip_bytes],
            port=self.http_port,
            properties={b"path": b"/"},
            server=f"{hostname}.local.",
        )
        self.services.append(http_service)

        # Register admin portal
        admin_service = ServiceInfo(
            "_http._tcp.local.",
            f"SkyGlass Admin._http._tcp.local.",
            addresses=[ip_bytes],
            port=self.admin_port,
            properties={b"path": b"/admin"},
            server=f"{hostname}.local.",
        )
        self.services.append(admin_service)

        # Register all services
        for service in self.services:
            try:
                self.zeroconf.register_service(service)
                print(f"  Registered: {service.name}")
            except Exception as e:
                print(f"  Failed to register {service.name}: {e}")

        print()
        print("SkyGlass is now discoverable on the local network:")
        print(f"  http://skyglass.local/")
        print(f"  http://{hostname}.local/")
        print(f"  http://{ip_addr}/")
        print()

        self.running = True
        return True

    def stop(self):
        """Stop advertising and clean up."""
        if self.zeroconf:
            print("\nStopping mDNS advertisement...")
            for service in self.services:
                try:
                    self.zeroconf.unregister_service(service)
                except Exception:
                    pass
            self.zeroconf.close()
            self.zeroconf = None
        self.services = []
        self.running = False

    def run_forever(self):
        """Run until interrupted."""
        if not self.start():
            return

        print("Press Ctrl+C to stop")

        def signal_handler(sig, frame):
            self.stop()
            sys.exit(0)

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


def check_avahi():
    """Check if avahi-daemon is running (Linux only)."""
    import platform
    if platform.system() != "Linux":
        return True  # Not applicable on other systems

    import subprocess
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "avahi-daemon"],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.stdout.strip() == "active"
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(
        description="SkyGlass mDNS/Bonjour service advertisement"
    )
    parser.add_argument(
        "--http-port",
        type=int,
        default=80,
        help="HTTP port (default: 80)"
    )
    parser.add_argument(
        "--https-port",
        type=int,
        default=443,
        help="HTTPS port (default: 443)"
    )
    parser.add_argument(
        "--admin-port",
        type=int,
        default=5000,
        help="Admin portal port (default: 5000)"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if mDNS is available and exit"
    )

    args = parser.parse_args()

    if args.check:
        if not ZEROCONF_AVAILABLE:
            print("zeroconf library not installed")
            sys.exit(1)
        if not check_avahi():
            print("avahi-daemon not running (required on Linux)")
            sys.exit(1)
        print("mDNS is available")
        sys.exit(0)

    if not ZEROCONF_AVAILABLE:
        print("ERROR: zeroconf library required")
        print("Install with: pip install zeroconf")
        sys.exit(1)

    mdns = SkyGlassMDNS(
        http_port=args.http_port,
        https_port=args.https_port,
        admin_port=args.admin_port
    )
    mdns.run_forever()


if __name__ == "__main__":
    main()
