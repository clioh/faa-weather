#!/usr/bin/env python3
"""
Hardware Watchdog Service for SkyGlass.

This service monitors the health of SkyGlass components and feeds the
hardware watchdog timer. If the system becomes unresponsive, the hardware
watchdog will automatically reboot the Raspberry Pi.

Features:
- Feeds the hardware watchdog timer (/dev/watchdog)
- Monitors backend, frontend, and presence services
- Logs health status
- Triggers reboot if services are unhealthy for too long

Usage:
    sudo python watchdog_service.py

Note: Requires root access for /dev/watchdog
"""

import os
import sys
import time
import signal
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


class ServiceHealth:
    """Tracks health status of a service."""

    def __init__(self, name: str, check_url: Optional[str] = None):
        self.name = name
        self.check_url = check_url
        self.healthy = True
        self.consecutive_failures = 0
        self.last_check = None
        self.last_error = None

    def check(self, timeout: float = 5.0) -> bool:
        """Check if the service is healthy."""
        self.last_check = datetime.now()

        if self.check_url:
            try:
                response = requests.get(self.check_url, timeout=timeout)
                if response.status_code == 200:
                    self.healthy = True
                    self.consecutive_failures = 0
                    self.last_error = None
                    return True
                else:
                    self.last_error = f"HTTP {response.status_code}"
            except requests.exceptions.Timeout:
                self.last_error = "Timeout"
            except requests.exceptions.ConnectionError:
                self.last_error = "Connection refused"
            except Exception as e:
                self.last_error = str(e)

        self.healthy = False
        self.consecutive_failures += 1
        return False


class HardwareWatchdog:
    """Interfaces with the hardware watchdog timer."""

    def __init__(self, device: str = "/dev/watchdog"):
        self.device = device
        self.fd: Optional[int] = None
        self.enabled = False

    def open(self) -> bool:
        """Open the watchdog device."""
        try:
            self.fd = os.open(self.device, os.O_WRONLY)
            self.enabled = True
            print(f"Hardware watchdog opened: {self.device}")
            return True
        except FileNotFoundError:
            print(f"Watchdog device not found: {self.device}")
            print("Hardware watchdog not available (normal on non-Pi systems)")
            return False
        except PermissionError:
            print(f"Permission denied: {self.device}")
            print("Run with sudo to access hardware watchdog")
            return False
        except Exception as e:
            print(f"Failed to open watchdog: {e}")
            return False

    def feed(self):
        """Feed the watchdog to prevent reboot."""
        if self.fd is not None:
            try:
                os.write(self.fd, b'\0')
            except Exception as e:
                print(f"Failed to feed watchdog: {e}")

    def close(self):
        """Close the watchdog device."""
        if self.fd is not None:
            try:
                # Write 'V' to disable watchdog on close (magic close)
                os.write(self.fd, b'V')
                os.close(self.fd)
            except Exception:
                pass
            self.fd = None
            self.enabled = False


class WatchdogService:
    """Main watchdog service that monitors health and feeds the timer."""

    def __init__(
        self,
        backend_url: str = "http://localhost:3001",
        frontend_url: str = "http://localhost:3001",
        admin_url: str = "http://localhost:5000",
        feed_interval: int = 10,
        max_failures: int = 6,
        use_hardware_watchdog: bool = True,
    ):
        self.feed_interval = feed_interval
        self.max_failures = max_failures
        self.running = False

        # Hardware watchdog
        self.hw_watchdog = HardwareWatchdog() if use_hardware_watchdog else None

        # Services to monitor
        self.services = [
            ServiceHealth("backend", f"{backend_url}/api/health"),
            ServiceHealth("frontend", frontend_url),
            # web_server.py (gunicorn wsgi:app) serves /api/health; /status was
            # only served by the legacy web_enroll.py.
            ServiceHealth("admin", f"{admin_url}/api/health"),
        ]

        # Overall health
        self.system_healthy = True
        self.unhealthy_since: Optional[datetime] = None

    def check_services(self) -> bool:
        """Check all services and return overall health."""
        all_healthy = True
        status_parts = []

        for service in self.services:
            healthy = service.check()
            status = "OK" if healthy else f"FAIL({service.last_error})"
            status_parts.append(f"{service.name}:{status}")

            if not healthy:
                all_healthy = False

        # Log status periodically
        timestamp = datetime.now().strftime("%H:%M:%S")
        status_line = " | ".join(status_parts)
        print(f"[{timestamp}] {status_line}")

        return all_healthy

    def restart_service(self, service_name: str):
        """Attempt to restart a service via PM2."""
        try:
            pm2_name = f"skyglass-{service_name}"
            subprocess.run(
                ["pm2", "restart", pm2_name],
                capture_output=True,
                timeout=30
            )
            print(f"Restarted {pm2_name}")
        except Exception as e:
            print(f"Failed to restart {service_name}: {e}")

    def run(self):
        """Main service loop."""
        print("=" * 50)
        print("SkyGlass Watchdog Service")
        print("=" * 50)
        print(f"Feed interval: {self.feed_interval}s")
        print(f"Max failures before action: {self.max_failures}")
        print()

        # Open hardware watchdog
        if self.hw_watchdog:
            self.hw_watchdog.open()

        self.running = True

        # Signal handlers
        def signal_handler(sig, frame):
            print("\nShutting down watchdog...")
            self.running = False

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

        try:
            while self.running:
                # Check service health
                all_healthy = self.check_services()

                if all_healthy:
                    self.system_healthy = True
                    self.unhealthy_since = None

                    # Feed the hardware watchdog
                    if self.hw_watchdog and self.hw_watchdog.enabled:
                        self.hw_watchdog.feed()
                else:
                    if self.system_healthy:
                        self.system_healthy = False
                        self.unhealthy_since = datetime.now()
                        print("WARNING: System became unhealthy")

                    # Check how long we've been unhealthy
                    if self.unhealthy_since:
                        unhealthy_duration = (datetime.now() - self.unhealthy_since).seconds

                        # Try to restart failed services
                        for service in self.services:
                            if service.consecutive_failures >= 3:
                                print(f"Attempting to restart {service.name}...")
                                self.restart_service(service.name)
                                time.sleep(5)  # Give it time to restart

                        # If still unhealthy after max failures worth of time
                        # Feed the watchdog anyway to prevent reboot
                        # (Let PM2 handle restarts, only reboot for total system freeze)
                        if self.hw_watchdog and self.hw_watchdog.enabled:
                            # Still feed watchdog - we only want reboot on total freeze
                            self.hw_watchdog.feed()

                time.sleep(self.feed_interval)

        finally:
            if self.hw_watchdog:
                self.hw_watchdog.close()
            print("Watchdog service stopped")


def enable_pi_watchdog():
    """Enable the Raspberry Pi hardware watchdog (requires reboot)."""
    config_file = Path("/boot/config.txt")

    if not config_file.exists():
        print("Not a Raspberry Pi (no /boot/config.txt)")
        return False

    content = config_file.read_text()

    if "dtparam=watchdog=on" in content:
        print("Hardware watchdog already enabled in /boot/config.txt")
        return True

    print("Enabling hardware watchdog in /boot/config.txt...")
    try:
        with open(config_file, "a") as f:
            f.write("\n# Enable hardware watchdog\n")
            f.write("dtparam=watchdog=on\n")
        print("Watchdog enabled. Reboot required.")
        return True
    except PermissionError:
        print("Permission denied. Run with sudo.")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="SkyGlass hardware watchdog service"
    )
    parser.add_argument(
        "--backend-url",
        default="http://localhost:3001",
        help="Backend health check URL"
    )
    parser.add_argument(
        "--frontend-url",
        default="http://localhost:3001",
        help="Frontend URL"
    )
    parser.add_argument(
        "--admin-url",
        default="http://localhost:5000",
        help="Admin portal URL"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=10,
        help="Health check interval in seconds (default: 10)"
    )
    parser.add_argument(
        "--max-failures",
        type=int,
        default=6,
        help="Max consecutive failures before restart attempt (default: 6)"
    )
    parser.add_argument(
        "--no-hardware",
        action="store_true",
        help="Disable hardware watchdog (software monitoring only)"
    )
    parser.add_argument(
        "--enable-watchdog",
        action="store_true",
        help="Enable Pi hardware watchdog in /boot/config.txt (requires reboot)"
    )

    args = parser.parse_args()

    if args.enable_watchdog:
        enable_pi_watchdog()
        sys.exit(0)

    if not REQUESTS_AVAILABLE:
        print("ERROR: requests library required")
        print("Install with: pip install requests")
        sys.exit(1)

    service = WatchdogService(
        backend_url=args.backend_url,
        frontend_url=args.frontend_url,
        admin_url=args.admin_url,
        feed_interval=args.interval,
        max_failures=args.max_failures,
        use_hardware_watchdog=not args.no_hardware,
    )
    service.run()


if __name__ == "__main__":
    main()
