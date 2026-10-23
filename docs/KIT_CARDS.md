# Kit SD cards

Hardware Kit and Complete Kit customers get an SD card that boots straight into SkyGlass, with no
network needed for the first boot: the mirror opens the `SkyGlass-Setup` hotspot and the phone app
does the rest (WiFi, orientation, license, location, airport, face). DIY builders don't need any of
this; they use Raspberry Pi Imager and `scripts/setup-pi.sh` ([HARDWARE.md](HARDWARE.md)).

Kit cards are **clones of a finished install** (a golden image), not cards that install SkyGlass on
first boot: `setup-pi.sh` downloads Node.js, npm and Python packages, which a customer's mirror with
no network yet can't do.

```
reference Pi:  Raspberry Pi OS  ->  setup-pi.sh --yes  ->  prepare-image.sh --yes  (powers off)
computer:      flash-sd.sh --capture   ->  skyglass-golden.img.xz + .sha256       (once per release)
computer:      flash-sd.sh --image ... --license-key-file ... --orientation ...   (once per kit)
```

## 1. Build the reference Pi

1. Use the same Pi model and the **smallest card model you ship** (see "Card sizes" below).
2. Write Raspberry Pi OS (64-bit, desktop or Lite; the release you support) with Raspberry Pi
   Imager. Any user name works (the units are rewritten for it); set WiFi so the install can
   download. Whatever you set in Imager is removed again in step 2.
3. Install SkyGlass at the version you're shipping:

   ```bash
   git clone https://github.com/clioh/skyglass.git ~/SkyGlass   # or extract a release tarball
   cd ~/SkyGlass && ./scripts/setup-pi.sh --yes
   sudo reboot
   ```

4. Check the mirror once: the kiosk shows the mirror UI, `pm2 status` lists the three apps. Don't
   pair a phone, enroll a face or enter a license (all of it is wiped anyway, but there's no need).

## 2. Prepare it for cloning

```bash
cd ~/SkyGlass
sudo ./scripts/prepare-image.sh --yes --country US          # add --zero-free-space for a smaller image
```

`prepare-image.sh` refuses to run anywhere but a Pi with a finished SkyGlass install, and without
`--yes`. It:

- stops the watchdog, the kiosk and PM2;
- sets the WiFi country (`raspi-config nonint do_wifi_country`; without one the radio is
  rfkill-blocked on a fresh card and the hotspot never appears) and the hostname (`skyglass`, so
  `skyglass.local`);
- removes per-unit state: everything in `data/` except `.gitkeep` (SQLite DB with the mirror id,
  `paired-devices.json`, `internal-token`, `admin-password`, `admin-session-secret`,
  `update-config.json`, calendar accounts, todos, photos, `camera-claim.json`; the directory stays,
  mode 700), `packages/presence/face_data/*` (faces, `.wifi_configured`), `config/config.yaml`
  (while it exists the pre-flashed orientation is ignored), `logs/`, `.update-*`, `.backup/`,
  `~/.skyglass/` (the license key file marker), PM2 logs, pids and saved process list
  (`boot-mode.sh` starts the apps at every boot);
- removes personal state for the install user and root: shell histories, `~/.ssh`, `~/.cache`,
  `~/.npm`, the kiosk's Chromium profile, Raspberry Pi Connect sign-in; and Imager's leftovers on the
  boot partition (`firstrun.sh`, `user-data`, `network-config`, `custom.toml`, ...); cloud-init is
  disabled if present;
- forgets every saved network (`/etc/NetworkManager/system-connections/*`, leases, NM's
  `secret_key`);
- clears logs (journal, `/var/log`), apt lists and caches, `/var/tmp`;
- arms `config/systemd/skyglass-firstboot.service`: on each card's first boot it creates new SSH
  host keys, grows the root filesystem to the card (`raspi-config nonint do_expand_rootfs`),
  disables itself and reboots once;
- empties `/etc/machine-id` (systemd writes a new one on each card's first boot) and deletes the
  SSH host keys and `/var/lib/systemd/random-seed`;
- disables SSH (`systemctl disable --now ssh`) and locks the install user's and root's passwords
  (`passwd -l`), so a shipped card has no network login; the kiosk's desktop autologin needs none;
- prints a checklist and powers off.

**Do not boot this card again** before capturing it: the first boot re-creates per-unit state. To
reuse the Pi for development afterwards, re-enable SSH from a keyboard (`sudo raspi-config`) and
set a password (`sudo passwd <user>`).

`--dry-run` prints every command without changing anything.

## 3. Capture the golden image

On a Mac or Linux machine with the card in a reader:

```bash
./scripts/flash-sd.sh --capture --device /dev/disk4 --out skyglass-golden.img
```

This reads the whole card (`dd`, `/dev/rdiskN` on macOS), shrinks it with
[PiShrink](https://github.com/Drewsif/PiShrink) when `pishrink.sh` is installed (Linux only; run
with `-s` because the image has its own first-boot resize), compresses it (`xz -T0`) and writes
`skyglass-golden.img.xz.sha256`. Keep both files together; `flash-sd.sh` checks the image against
the `.sha256` before writing.

### Card sizes

The reference card's root partition was grown to that card, so an unshrunk image is exactly as large
as the reference card, and "32 GB" cards of different makes or batches differ by a few MB.
`flash-sd.sh` refuses a card smaller than the image. Either capture on Linux with PiShrink
installed (recommended; the image then fits any card that holds the install), or build the
reference on the smallest card model you ship.

## 4. Write a kit card

```bash
./scripts/flash-sd.sh --image skyglass-golden.img.xz --device /dev/disk4 \
    --license-key-file kit-1234.txt --orientation portrait-cw
```

- `--device`: the whole card (`diskutil list external physical` on macOS, `lsblk -d -o
NAME,SIZE,RM,TRAN,MODEL` on Linux). The script refuses partitions, the disk holding the running
  system, internal SATA/NVMe/Apple Fabric disks and anything not reported as removable (the
  built-in SD slot on a Mac and `mmcblk` readers on Linux are accepted). It shows the device and
  asks you to type its name before erasing it; `--yes` skips that for batch runs.
- License, at most one of:
  - `--license-key KEY` or `--license-key-file FILE` (first line): a key you already have, checked
    for the `XXXX-XXXX-XXXX-XXXX` format;
  - `--license-id UUID`: issues the key for that kit license through the admin API and writes it
    (`scripts/provision-sd.sh`, needs `ADMIN_PASSWORD`; see [LICENSING.md](LICENSING.md),
    "Fulfilment").

  Written to `skyglass-license.txt` on the boot partition; the mirror activates it on the first
  boot with network.

- `--orientation landscape|portrait-cw|portrait-ccw`: written to `skyglass-orientation.txt`, so the
  first setup screen is the right way up for a portrait mount.
- `--dry-run` prints every command (unmount, `dd`, mount, file writes, eject) instead of running it.

The script writes with `dd` in 4 MiB blocks (`ibs=1m obs=4m`) (`conv=fsync` on Linux), syncs, mounts the boot partition to add
the per-unit files, and ejects. It never edits `cmdline.txt` and adds no first-boot script. It
needs root for `dd` and `mount` and uses `sudo` for those.

## 5. Check a card

Boot a freshly written card in a mirror with no known network:

- exactly one automatic reboot early in the first boot (`journalctl -b -1 -u skyglass-firstboot`),
  after which `df -h /` shows the full card;
- about a minute later `SkyGlass-Setup` appears and the mirror shows the hotspot screen (the right
  way up for the written orientation);
- SSH is refused (`ssh <user>@skyglass.local` → connection refused);
- two cards from the same image have different `/etc/machine-id` and SSH host key fingerprints
  (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, checked from a keyboard);
- after WiFi setup in the app, the pre-flashed license activates without typing the key.

## When the network changes later

A mirror that was set up but can't find its network at boot (moved house, new router, or the router
still booting after a power cut) waits 90 seconds, then opens `SkyGlass-Setup` again and shows the
hotspot screen, so the owner can pick a new network in the app. Meanwhile it retries the saved
network every 5 minutes while no phone is on the hotspot, and goes back to normal as soon as that
network is back (`packages/presence/README.md`, "WiFi").
