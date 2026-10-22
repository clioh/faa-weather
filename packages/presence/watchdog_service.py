#!/usr/bin/env python3
"""
Hardware Watchdog Service for SkyGlass.

This service monitors the health of SkyGlass components and feeds the
hardware watchdog timer. If the system becomes unresponsive, the hardware
watchdog will automatically reboot the Raspberry Pi.

Features:
- Feeds the hardware watchdog timer (/dev/watchdog)
- Monitors the PM2 apps: skyglass-backend and skyglass-admin over HTTP
  (/api/health), skyglass-detector through `pm2 jlist` (it serves no HTTP)
- Restarts an app via PM2 after --max-failures consecutive failed checks
- Logs health status

Usage (systemd unit skyglass-watchdog.service):
    sudo python watchdog_service.py --pm2-user <install user>

Note: Requires root access for /dev/watchdog. PM2 apps belong to the install
user's PM2 daemon (~<user>/.pm2), so PM2 commands run as that user
(`sudo -u <user> -H pm2 ...`) rather than as root, which would talk to an
empty root PM2 daemon.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


class PM2:
    """Runs pm2 as the install user (whose daemon owns the SkyGlass apps)."""

    def __init__(self, user: Optional[str] = None):
        self.user = user

    def command(self, *args: str) -> list:
        if self.user and os.geteuid() == 0:
            return ["sudo", "-u", self.user, "-H", "pm2", *args]
        return ["pm2", *args]

    def run(self, *args: str, timeout: float = 30) -> subprocess.CompletedProcess:
        return subprocess.run(self.command(*args), capture_output=True, text=True, timeout=timeout)

    def status(self, app: str) -> Optional[str]:
        """PM2 status of ``app`` ("online", "errored", ...), or None if not listed."""
        result = self.run("jlist", timeout=15)
        for proc in json.loads(result.stdout or "[]"):
            if proc.get("name") == app:
                return proc.get("pm2_env", {}).get("status")
        return None


class ServiceHealth:
    """Tracks health status of one PM2 app.

    Checked over HTTP when ``check_url`` is set, otherwise by its PM2 status.
    """

    def __init__(self, name: str, pm2_name: str, pm2: PM2, check_url: Optional[str] = None):
        self.name = name
        self.pm2_name = pm2_name
        self.pm2 = pm2
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
        else:
            try:
                status = self.pm2.status(self.pm2_name)
                if status == "online":
                    self.healthy = True
                    self.consecutive_failures = 0
                    self.last_error = None
                    return True
                self.last_error = f"pm2 status {status or 'missing'}"
            except (OSError, subprocess.SubprocessError, ValueError) as e:
                self.last_error = f"pm2 jlist failed: {e}"

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
        admin_url: str = "http://localhost:5000",
        feed_interval: int = 10,
        max_failures: int = 3,
        use_hardware_watchdog: bool = True,
        pm2_user: Optional[str] = None,
    ):
        self.feed_interval = feed_interval
        self.max_failures = max_failures
        self.running = False
        self.pm2 = PM2(pm2_user)

        # Hardware watchdog
        self.hw_watchdog = HardwareWatchdog() if use_hardware_watchdog else None

        # Services to monitor
        # (names match config/pm2.config.cjs; the display UI is served by the backend)
        self.services = [
            ServiceHealth("backend", "skyglass-backend", self.pm2, f"{backend_url}/api/health"),
            # web_server.py (gunicorn wsgi:app)
            ServiceHealth("admin", "skyglass-admin", self.pm2, f"{admin_url}/api/health"),
            ServiceHealth("detector", "skyglass-detector", self.pm2),
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

    def restart_service(self, service: ServiceHealth):
        """Attempt to restart a service via PM2."""
        try:
            result = self.pm2.run("restart", service.pm2_name)
            if result.returncode == 0:
                print(f"Restarted {service.pm2_name}")
            else:
                print(f"pm2 restart {service.pm2_name} failed: {(result.stderr or result.stdout).strip()}")
        except (OSError, subprocess.SubprocessError) as e:
            print(f"Failed to restart {service.pm2_name}: {e}")
        # Give the restart max_failures more checks before trying again.
        service.consecutive_failures = 0

    def run(self):
        """Main service loop."""
        print("=" * 50)
        print("SkyGlass Watchdog Service")
        print("=" * 50)
        print(f"Feed interval: {self.feed_interval}s")
        print(f"Failed checks before PM2 restart: {self.max_failures}")
        print(f"PM2 command: {' '.join(self.pm2.command('<args>'))}")
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

                    if self.unhealthy_since:
                        # Try to restart failed services
                        for service in self.services:
                            if service.consecutive_failures >= self.max_failures:
                                print(f"Attempting to restart {service.name}...")
                                self.restart_service(service)
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
    # Bookworm moved the firmware config to /boot/firmware; older images use /boot.
    candidates = [Path("/boot/firmware/config.txt"), Path("/boot/config.txt")]
    config_file = next((p for p in candidates if p.exists()), None)

    if config_file is None:
        print("Not a Raspberry Pi (no /boot/firmware/config.txt or /boot/config.txt)")
        return False

    content = config_file.read_text()

    if "dtparam=watchdog=on" in content:
        print(f"Hardware watchdog already enabled in {config_file}")
        return True

    print(f"Enabling hardware watchdog in {config_file}...")
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
        help="Backend base URL (checks /api/health)"
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
        default=3,
        help="Consecutive failed checks before a PM2 restart (default: 3)"
    )
    parser.add_argument(
        "--pm2-user",
        help="Run pm2 as this user (the install user owning the SkyGlass PM2 apps) when running as root"
    )
    parser.add_argument(
        "--no-hardware",
        action="store_true",
        help="Disable hardware watchdog (software monitoring only)"
    )
    parser.add_argument(
        "--enable-watchdog",
        action="store_true",
        help="Enable Pi hardware watchdog in /boot/firmware/config.txt or /boot/config.txt (requires reboot)"
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
        admin_url=args.admin_url,
        feed_interval=args.interval,
        max_failures=args.max_failures,
        use_hardware_watchdog=not args.no_hardware,
        pm2_user=args.pm2_user,
    )
    service.run()


if __name__ == "__main__":
    main()
