# SkyGlass Hardware Guide

Complete guide to building a smart mirror for pilots, including parts list, assembly instructions, and setup.

## Table of Contents

1. [Parts List](#parts-list)
2. [Frame Assembly](#frame-assembly)
3. [Electronics Installation](#electronics-installation)
4. [Software Setup](#software-setup)
5. [Troubleshooting](#troubleshooting)

---

## Parts List

The complete bill of materials (every part with specs, quantities and prices, a sizing table,
frame cut list, mounting and power options, tools and a printable shopping checklist) is
[`docs/build-guide/SkyGlass-Bill-of-Materials.pdf`](build-guide/SkyGlass-Bill-of-Materials.pdf).
Its source is [`docs/build-guide/bom.html`](build-guide/bom.html); rebuild the PDF with
`npm run docs:bom` after editing it.

Parts cost is about $490 (22", acrylic) to $1,050 (27", smart-mirror glass); the recommended
24" build is about $645. Part codes in this guide (A1, D1, ...) refer to that document:
A = Raspberry Pi and camera, B = display, C = mounting hardware and power, D = mirror,
E = frame materials, F = wall mounting and power options.

---

## Frame Assembly

### Step 1: Plan Your Layout

Before cutting or buying anything:

1. **Measure your monitor:**
   - Overall dimensions (including bezel)
   - Visible display area
   - Depth (including cables)
   - Location of inputs (HDMI, power)

2. **Plan component placement:**

   ```
   ┌─────────────────────────────────────┐
   │            Two-Way Mirror           │
   ├─────────────────────────────────────┤
   │                                     │
   │              Monitor                │
   │           (face down)               │
   │                                     │
   ├─────────────────────────────────────┤
   │  [Pi]    [Power Strip]    [Cables]  │
   └─────────────────────────────────────┘
   ```

3. **Ventilation:** Plan for airflow - the Pi and monitor generate heat.

### Step 2: Build/Prepare the Frame

#### If Using a Picture Frame:

1. Remove the backing and glass
2. Keep the mounting hardware
3. Paint the inside edges matte black (reduces light leakage)
4. Cut a piece of cardboard or foam board as backing

#### If Building Custom:

1. **Cut frame pieces:**
   - 2 vertical sides: monitor height + 4"
   - 2 horizontal sides: monitor width + 4"
   - Use miter cuts (45°) for clean corners

2. **Cut mounting ledge:**
   - Inner rectangle to hold mirror glass
   - Set back ~1/4" from front edge

3. **Assemble:**

   ```
   Front view:
   ┌──────────────────┐
   │ ┌──────────────┐ │
   │ │              │ │
   │ │   (mirror    │ │ <- Ledge
   │ │    sits      │ │
   │ │    here)     │ │
   │ └──────────────┘ │
   └──────────────────┘
   ```

4. **Sand and finish:**
   - Sand all surfaces smooth
   - Apply wood stain or paint
   - Use matte black for inside edges

### Step 3: Install the Mirror

1. **Clean the mirror** (D1) with glass cleaner (D4)
2. **Place mirror** reflective side facing OUT (front)
3. **Secure with clips** or silicone adhesive
4. **Test visibility:** Turn on monitor behind it - you should see text clearly

### Step 4: Mount the Monitor

1. **Position monitor** (B1) face-down against the mirror
2. **Center it** within the visible area
3. **Secure with:**
   - Dual Lock or hook-and-loop strips (C2, removable)
   - L-brackets screwed to frame
   - Or foam padding pressed against backing

4. **Route cables** to one side/corner

---

## Electronics Installation

### Step 1: Prepare the Raspberry Pi

1. **Install heatsinks/cooler:**
   - Clean CPU surface
   - Apply thermal pad or paste
   - Attach the Active Cooler (A3; Pi 5) or heatsinks (Pi 4)

2. **Connect the camera ribbon cable (A6) to the Camera Module 3 (A5):**
   - A USB webcam (A5b) needs no ribbon; plug it into a USB port
   - Lift the connector latch
   - Insert ribbon (blue side facing USB ports on Pi 5)
   - Press latch down firmly

3. **Insert the microSD card** (A4; we'll flash it in software setup)

### Step 2: Plan Cable Routing

```
┌─────────────────────────────────────────┐
│                Mirror                    │
├─────────────────────────────────────────┤
│                                         │
│              Monitor                    │
│                                         │
├──────┬──────────────────────┬───────────┤
│      │                      │           │
│ [Pi] │    [Cable space]     │ [Power    │
│      │                      │  Strip]   │
│  ↑   │                      │    ↑      │
│  │   │                      │    │      │
│  └───┼──── HDMI ────────────┼────┘      │
│      │                      │           │
│  Camera ribbon    Power cables          │
│  (to front)       (all to strip)        │
└─────────────────────────────────────────┘
```

### Step 3: Mount Components

1. **Mount the Pi (A1):**
   - Use Dual Lock strips (C2), standoffs (A8) or a 3D-printed mount
   - Position near monitor's HDMI input
   - Ensure camera ribbon can reach front

2. **Mount the power strip (C4):**
   - Use Dual Lock strips (C2) or screws
   - Position where all power cables can reach

3. **Route the camera:**
   - Camera should face out through a small hole or slot
   - Position at top center of mirror (eye level when standing)
   - Can be hidden behind the frame edge

   **Camera hole options:**
   - Drill a small hole in frame top (camera peeks through)
   - Mount camera behind mirror (less ideal - may affect recognition)
   - Use a pinhole camera mount

### Step 4: Connect Everything

1. **HDMI:** Pi → Monitor (micro-HDMI cable, A7)
2. **Power:**
   - Monitor → Power strip
   - Pi PSU (A2) → Power strip
3. **Camera:** Already connected to Pi
4. **Power strip:** → Wall outlet

### Step 5: Test Before Closing

1. Power on the monitor
2. Power on the Pi
3. Verify:
   - Display shows boot screen
   - Camera LED lights up briefly
   - No loose connections

---

## Software Setup

These steps are for a DIY build. A Hardware Kit or Complete Kit card is already set up: insert it,
power on, and follow the SkyGlass phone app (the mirror opens the `SkyGlass-Setup` WiFi network).
How kit cards are made: [KIT_CARDS.md](KIT_CARDS.md).

### Step 1: Flash Raspberry Pi OS

1. **Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)**

2. **Flash the SD card:**
   - Choose: Raspberry Pi OS (64-bit)
   - Select your SD card
   - Click the gear icon for settings:
     - Set hostname: `skyglass`
     - Enable SSH
     - Set username/password
     - Configure WiFi
   - Click Write

3. **Boot the Pi:**
   - Insert SD card
   - Connect power
   - Wait 2-3 minutes for first boot

### Step 2: Initial Pi Configuration

SSH into your Pi (use the username you set in Raspberry Pi Imager) or connect keyboard/mouse:

```bash
ssh <your-user>@skyglass.local
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
```

Check that the camera is detected (Raspberry Pi OS finds ribbon cameras
automatically; a USB webcam needs nothing):

```bash
rpicam-hello --list-cameras   # Pi camera, e.g. "imx708" for Camera Module 3
```

### Step 3: Install SkyGlass Software

Clone and run the setup script:

```bash
# Clone the repository
git clone https://github.com/clioh/skyglass.git ~/SkyGlass
cd ~/SkyGlass

# Run the Pi setup script
./scripts/setup-pi.sh
```

This will install (natively; there is no Docker image):

- Node.js 24
- Python 3 venv with face_recognition and OpenCV
- PM2, running `skyglass-backend` (port 3001, also serves the display UI),
  `skyglass-detector` and `skyglass-admin` (port 5000) from `config/pm2.config.cjs`
- The `skyglass-boot`, `skyglass-provision` (WiFi hotspot, run with
  NetworkManager) and `skyglass-watchdog` systemd units. A Pi that is already
  on WiFi (set in Raspberry Pi Imager above) keeps that network and never
  starts the hotspot
- Chromium in kiosk mode and mDNS (`skyglass.local`)

### Step 4: Configure Your Mirror

Setup happens in the SkyGlass phone app (there is no browser setup wizard).
Open the app, connect to the mirror and follow the steps: WiFi (via the
`SkyGlass-Setup` hotspot if the mirror is not on your network yet), license,
location, home airport, and face registration.

Other settings (display, `presence:` detection tuning) live in
`~/SkyGlass/config/config.yaml`, which `setup-pi.sh` creates from
`config/default.yaml`:

```bash
nano ~/SkyGlass/config/config.yaml
```

### Step 5: Start the Services

```bash
cd ~/SkyGlass
npm run start   # Starts all services via PM2
npm run logs    # View logs
```

### Step 6: Register Your Face

Open the SkyGlass app on your phone, connect to the mirror, and follow the
face registration step (or Settings > Add New Face later). The mirror shows
the camera view while it captures. Each person who should wake the mirror
registers separately; the detector picks up new registrations without a
restart.

### Step 7: Enable Auto-Start on Boot

The setup script already configured this, but verify:

```bash
pm2 status
pm2 save
```

### Step 8: Configure Kiosk Mode

The setup script switched the desktop to labwc with automatic login and wrote
`~/.config/labwc/autostart`, which runs only `scripts/kiosk.sh`: Chromium full
screen on `http://localhost:3001` (the backend serves the built display UI),
restarted if it exits. No panel or screen blanker runs behind the mirror. To get
the normal desktop back for maintenance, delete that autostart file and reboot.

Test it:

```bash
sudo reboot
```

---

## Mounting on Wall

### Option 1: French Cleat (Recommended, F1 or F1b)

Most secure for heavy mirrors:

1. Cut a 1x4 board at 45° angle
2. Mount one half to wall (studs!)
3. Mount other half to back of frame
4. Hang frame on cleat

```
Wall:          Frame:
    /│             │\
   / │             │ \
  /  │             │  \
 ────┘             └────
```

### Option 2: Z-Bar Hangers (F1c)

Available at hardware stores. Good for medium-weight frames.

### Option 3: Picture Wire

Only for lighter builds (<15 lbs).

---

## Troubleshooting

### Display Issues

| Problem                       | Solution                                   |
| ----------------------------- | ------------------------------------------ |
| No display output             | Check HDMI connection, try different cable |
| Display too dim behind mirror | Increase monitor brightness to 100%        |
| Text hard to read             | Adjust font sizes in frontend settings     |
| Screen flickering             | Check power supply, try different outlet   |

### Camera Issues

| Problem              | Solution                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Camera not detected  | Check ribbon cable orientation and that you used the Pi 5 (22-pin) cable; `rpicam-hello --list-cameras` should list it            |
| Face not recognized  | Register the face again from the phone app, in front of the mirror and in its usual lighting                                      |
| Slow recognition     | Set `detection_method: opencv` in the `presence:` block of config.yaml (wakes for any face)                                       |
| Camera preview black | `pm2 logs skyglass-detector` shows which camera opened; see "Camera not working on Raspberry Pi" in `packages/presence/README.md` |

### Presence Detection Issues

| Problem               | Solution                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mirror won't turn on  | Check a face is registered, then `pm2 logs skyglass-detector` (see `packages/presence/README.md`)                                                                                                                                                           |
| Mirror won't turn off | Lower `presence.timeout` (detector) or `display.presence_timeout` in config.yaml. `pm2 logs skyglass-backend` shows `Display control: ...` at startup: a TV uses HDMI-CEC, a monitor has its HDMI output switched off and must be set to sleep on no signal |
| Detects other people  | Lower `presence.tolerance` in config.yaml (e.g. 0.5)                                                                                                                                                                                                        |
| Too sensitive         | Increase `presence.min_detection_frames` in config.yaml                                                                                                                                                                                                     |

### Network Issues

| Problem                         | Solution                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Phone app can't find the mirror | Check the Pi's IP with `hostname -I` and open `http://<ip>:3001`                                                 |
| Mirror moved to a new network   | Reboot it: after 90 s without its saved network it opens `SkyGlass-Setup` again; pick the new network in the app |
| Aviation data not loading       | Check internet, verify API endpoints                                                                             |
| WebSocket disconnecting         | Check for network stability                                                                                      |

### Heat Issues

| Problem         | Solution                                |
| --------------- | --------------------------------------- |
| Pi throttling   | Add ventilation holes to frame          |
| Monitor too hot | Add small USB fan                       |
| System unstable | Check CPU temp: `vcgencmd measure_temp` |

---

## Maintenance

### Regular Tasks

- **Weekly:** Check for software updates (`npm run update`)
- **Monthly:** Clean mirror surface, check cable connections
- **Yearly:** Re-apply thermal paste if temps are high

### Updating Software

Install updates from the display UI (_Download_, then _Install Now_) or from a shell:

```bash
cd ~/SkyGlass
npm run update                 # check and prompt
./scripts/update.sh --check    # check only
./scripts/update.sh --apply    # install without prompting
```

Updates come from GitHub release tarballs; `config/config.yaml`, `data/` and
registered faces are kept. Details in the README's _Updating_ section and
[`docs/UPDATES.md`](UPDATES.md).

---

## Resources

- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [Two Way Mirrors - Smart Mirror Guide](https://www.twowaymirrors.com/smart-mirror-guide/)
- [/r/MagicMirror Subreddit](https://www.reddit.com/r/MagicMirror/) (general smart mirror builds)
- [Pi Camera Troubleshooting](https://www.raspberrypi.com/documentation/computers/camera_software.html)

---

_Happy building! If you have questions, open an issue on GitHub._
