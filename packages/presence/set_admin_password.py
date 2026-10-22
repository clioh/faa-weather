#!/usr/bin/env python3
"""
Set, reset or clear the SkyGlass admin portal password. Run it ON THE MIRROR
(keyboard or SSH); there is deliberately no way to set the first password
over the network.

    venv/bin/python set_admin_password.py            # prompt for a new password
    venv/bin/python set_admin_password.py --clear    # turn the network admin portal off
    venv/bin/python set_admin_password.py --status

The hash (scrypt) is written to data/admin-password (mode 0600) at the repo
root, or $SKYGLASS_DATA_DIR/admin-password. Setting or clearing it signs out
every existing admin session. Restarting the server is not needed.
"""

import argparse
import getpass
import sys

import security


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Set the SkyGlass admin portal password")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--clear", action="store_true", help="remove the password (disables the admin portal)")
    group.add_argument("--status", action="store_true", help="show whether a password is set")
    group.add_argument("--stdin", action="store_true", help="read the new password from stdin (scripts)")
    args = parser.parse_args(argv)

    path = security.admin_password_path()

    if args.status:
        if security.is_password_set():
            print(f"Admin password is set ({path}). The admin portal is enabled.")
        elif security.has_legacy_password():
            print(f"{path} uses an old, unsupported format. Run this tool to set a new password.")
        else:
            print("No admin password. The network admin portal is disabled.")
        return 0

    if args.clear:
        security.clear_password()
        print("Admin password removed. The network admin portal is now disabled.")
        return 0

    if args.stdin:
        password = sys.stdin.readline().rstrip("\n")
    else:
        password = getpass.getpass("New admin password: ")
        if getpass.getpass("Repeat: ") != password:
            print("Passwords do not match.", file=sys.stderr)
            return 1

    problem = security.password_problem(password)
    if problem:
        print(problem, file=sys.stderr)
        return 1

    security.store_password(password)
    print(f"Admin password saved to {path}. Sign in at http://<mirror>:5000/admin")
    return 0


if __name__ == "__main__":
    sys.exit(main())
