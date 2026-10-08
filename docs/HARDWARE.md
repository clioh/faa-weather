# SkyGlass Hardware Guide

Complete guide to building a smart mirror for pilots, including parts list, assembly instructions, and setup.

## Table of Contents

1. [Budget Overview](#budget-overview)
2. [Parts List](#parts-list)
3. [Tools Needed](#tools-needed)
4. [Frame Assembly](#frame-assembly)
5. [Electronics Installation](#electronics-installation)
6. [Software Setup](#software-setup)
7. [Troubleshooting](#troubleshooting)

---

## Budget Overview

| Category | Budget Option | Recommended | Premium |
|----------|---------------|-------------|---------|
| Computer | $100 | $110 | $155 |
| Display | $80 | $120 | $180 |
| Mirror | $40 | $60 | $120 |
| Frame | $30 | $30 | $100 |
| Misc/Cables | $20 | $39 | $40 |
| **Total** | **~$270** | **~$359** | **~$595** |

Computer costs are the sums of the option tables below (Pi 4, Pi 5, Mini PC + webcam). The Recommended column matches the [Sample Shopping Cart](#sample-shopping-cart-recommended-build).

---

## Parts List

### Core Computing (Choose One)

#### Recommended: Raspberry Pi 5 (4GB) - ~$110 total

| Item | Price | Notes |
|------|-------|-------|
| [Raspberry Pi 5 4GB](https://www.raspberrypi.com/products/raspberry-pi-5/) | $60 | 4GB is sufficient; 8GB unnecessary |
| [Raspberry Pi Camera Module 3](https://www.raspberrypi.com/products/camera-module-3/) | $25 | Wide-angle version also works |
| [27W USB-C Power Supply](https://www.raspberrypi.com/products/27w-power-supply/) | $12 | Must be 27W for Pi 5 |
| [32GB microSD Card](https://www.amazon.com/dp/B07G3H5RBT) | $8 | Samsung EVO or SanDisk recommended |
| [Pi 5 Active Cooler](https://www.raspberrypi.com/products/active-cooler/) | $5 | Recommended for enclosed space |

**Why Pi 5 over alternatives:**
- Native CSI camera port = lower latency face detection
- Hardware video decode for smooth UI
- GPIO for future sensors (ambient light, temperature)
- Excellent Linux support and community
- Low power (~5W idle)

#### Budget Alternative: Raspberry Pi 4 (4GB) - ~$100 total

| Item | Price | Notes |
|------|-------|-------|
| [Raspberry Pi 4 4GB](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/) | $55 | Still very capable |
| [Pi Camera Module 2](https://www.raspberrypi.com/products/camera-module-v2/) | $25 | Or use Module 3 |
| [15W USB-C Power Supply](https://www.raspberrypi.com/products/type-c-power-supply/) | $8 | Official PSU recommended |
| [32GB microSD Card](https://www.amazon.com/dp/B07G3H5RBT) | $8 | |
| Heatsink Kit | $5 | Passive cooling usually sufficient |

#### Alternative: Mini PC - ~$155 total

| Item | Price | Notes |
|------|-------|-------|
| [Beelink S12 Pro (N100)](https://www.amazon.com/dp/B0BVLS8ZHP) | $130 | Intel N100, 8GB RAM, 256GB SSD |
| [USB Webcam](https://www.amazon.com/dp/B09DPL5YYX) | $25 | 1080p with good low-light |

**Mini PC pros:** More power, runs standard Ubuntu/Debian
**Mini PC cons:** No CEC display control, needs USB webcam, higher power draw

---

### Display

The display is hidden behind the two-way mirror. Key requirements:
- Thin bezels (more visible area)
- IPS panel (better viewing angles)
- HDMI input
- VESA mount holes (for mounting)

#### Recommended: 24" 1080p IPS Monitor

| Option | Price | Notes |
|--------|-------|-------|
| [Dell SE2422H 24"](https://www.amazon.com/dp/B08FRXG5K5) | $120 | Thin bezels, VESA mount |
| [ASUS VA24DQ 24"](https://www.amazon.com/dp/B08C2GQJVD) | $130 | IPS, built-in speakers |
| [LG 24ML44B 24"](https://www.amazon.com/dp/B08FXSPRB1) | $100 | Budget friendly |

#### Budget: 22" Monitor

| Option | Price | Notes |
|--------|-------|-------|
| [Acer SB220Q 21.5"](https://www.amazon.com/dp/B07CVL2D2S) | $80 | Ultra-thin, IPS |
| [HP M22f 22"](https://www.amazon.com/dp/B08V87FFLQ) | $90 | Good for smaller builds |

#### Premium: 27" or Larger

| Option | Price | Notes |
|--------|-------|-------|
| [LG 27MR400 27"](https://www.amazon.com/dp/B0CHWMYVQH) | $150 | Great for larger frames |
| [Samsung M5 32"](https://www.amazon.com/dp/B08WJGZ4Z4) | $200 | Smart TV features built-in |

**Important:** Measure your monitor's visible display area (not including bezel) before ordering mirror glass.

---

### Two-Way Mirror

The magic! This is what makes text visible while still reflecting like a mirror.

#### Option 1: Two-Way Mirror Acrylic (Recommended)

| Source | Size | Price | Notes |
|--------|------|-------|-------|
| [TAP Plastics](https://www.tapplastics.com/product/plastics/cut_to_size_background/two_way_mirror/558) | Custom | $40-80 | Custom cut to size |
| [Amazon - 12x24"](https://www.amazon.com/dp/B01G4MQ3WQ) | 12"x24" | $35 | May need multiple |
| [Two Way Mirrors](https://www.twowaymirrors.com/acrylic-mirror/) | Custom | $50-100 | High quality |

**Acrylic pros:** Lightweight, won't shatter, easy to cut
**Acrylic cons:** Can scratch, slight flexibility

#### Option 2: Two-Way Mirror Glass

| Source | Size | Price | Notes |
|--------|------|-------|-------|
| [Two Way Mirrors](https://www.twowaymirrors.com/smart-mirror/) | Custom | $80-150 | Professional quality |
| Local glass shop | Custom | $60-100 | Call for quotes |

**Glass pros:** More reflective, scratch resistant, rigid
**Glass cons:** Heavy, can break, harder to work with

#### DIY Option: Mirror Film on Glass

| Item | Price | Notes |
|------|-------|-------|
| [Gila Mirror Window Film](https://www.amazon.com/dp/B000HZWFN6) | $25 | Apply to regular glass |
| Picture frame glass | $20-40 | From craft store |

**Film pros:** Cheapest option
**Film cons:** Bubbles, less reflective, application is tricky

---

### Frame

You have several options for the frame:

#### Option 1: Buy a Picture Frame (Easiest)

| Source | Size | Price | Notes |
|--------|------|-------|-------|
| [IKEA RIBBA](https://www.ikea.com/us/en/p/ribba-frame-black-40378401/) | Various | $15-40 | Simple, clean look |
| [Michael's Shadow Box](https://www.michaels.com/product/studio-decor-shadow-box-10476887) | Various | $30-60 | Deep enough for electronics |
| Amazon shadow box | Various | $25-50 | Search "deep shadow box" |

**Key measurement:** Frame depth must be at least 2" (50mm) to fit monitor + Pi.

#### Option 2: Build a Custom Frame

Materials from Home Depot/Lowe's:

| Item | Price | Notes |
|------|-------|-------|
| 1x4 Pine boards | $15 | For frame sides |
| 1x2 Pine boards | $10 | For mounting ledge |
| Wood glue + screws | $10 | |
| Wood stain/paint | $10 | Matte black recommended |

#### Option 3: 3D Print (If You Have Access)

STL files available for various monitor sizes:
- [Thingiverse MagicMirror frames](https://www.thingiverse.com/search?q=magic+mirror+frame)
- Print in sections and assemble

---

### Cables & Accessories

| Item | Price | Notes |
|------|-------|-------|
| [HDMI Cable (thin/flat)](https://www.amazon.com/dp/B07JGZ9SWL) | $8 | Flat cables easier to route |
| [Pi Camera Ribbon Cable (longer)](https://www.amazon.com/dp/B085RW9K13) | $8 | 30-50cm recommended |
| [USB-C Extension](https://www.amazon.com/dp/B081QFXJ2D) | $10 | For power routing |
| [Velcro Strips](https://www.amazon.com/dp/B00006IC2T) | $8 | Mounting Pi and cables |
| [Cable Ties](https://www.amazon.com/dp/B0002GX1XA) | $5 | Cable management |
| [Power Strip (slim)](https://www.amazon.com/dp/B07PJNHGBY) | $15 | Mount inside frame |

#### Optional Accessories

| Item | Price | Notes |
|------|-------|-------|
| [HDMI CEC Adapter](https://www.amazon.com/dp/B07KSYS25P) | $15 | If monitor lacks CEC |
| [USB Sound Card](https://www.amazon.com/dp/B00IRVQ0F8) | $10 | If you want audio alerts |
| [Ambient Light Sensor](https://www.amazon.com/dp/B07Q2R5S9J) | $8 | Auto-brightness (future) |
| [PIR Motion Sensor](https://www.amazon.com/dp/B07KBWVJMP) | $8 | Backup presence detection |

---

## Tools Needed

### Required

- [ ] Screwdriver set (Phillips + flathead)
- [ ] Measuring tape
- [ ] Pencil for marking
- [ ] Level (or phone app)

### For Custom Frame

- [ ] Saw (hand saw or miter saw)
- [ ] Drill with bits
- [ ] Sandpaper (120, 220 grit)
- [ ] Clamps
- [ ] Safety glasses

### Helpful

- [ ] Hot glue gun
- [ ] Wire strippers
- [ ] Multimeter (for debugging)
- [ ] Headlamp/flashlight

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

1. **Clean the mirror** with glass cleaner
2. **Place mirror** reflective side facing OUT (front)
3. **Secure with clips** or silicone adhesive
4. **Test visibility:** Turn on monitor behind it - you should see text clearly

### Step 4: Mount the Monitor

1. **Position monitor** face-down against the mirror
2. **Center it** within the visible area
3. **Secure with:**
   - Velcro strips (removable)
   - L-brackets screwed to frame
   - Or foam padding pressed against backing

4. **Route cables** to one side/corner

---

## Electronics Installation

### Step 1: Prepare the Raspberry Pi

1. **Install heatsinks/cooler:**
   - Clean CPU surface
   - Apply thermal pad or paste
   - Attach active cooler (Pi 5) or heatsinks (Pi 4)

2. **Connect camera ribbon cable:**
   - Lift the connector latch
   - Insert ribbon (blue side facing USB ports on Pi 5)
   - Press latch down firmly

3. **Insert microSD card** (we'll flash it in software setup)

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

1. **Mount the Pi:**
   - Use velcro strips or 3D-printed mount
   - Position near monitor's HDMI input
   - Ensure camera ribbon can reach front

2. **Mount power strip:**
   - Use velcro or screws
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

1. **HDMI:** Pi → Monitor
2. **Power:**
   - Monitor → Power strip
   - Pi PSU → Power strip
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

SSH into your Pi or connect keyboard/mouse:

```bash
ssh pi@skyglass.local
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
```

Enable the camera:

```bash
sudo raspi-config
# Navigate to: Interface Options → Camera → Enable
# Reboot when prompted
```

### Step 3: Install SkyGlass Software

Clone and run the setup script:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/SkyGlass.git ~/SkyGlass
cd ~/SkyGlass

# Run the Pi setup script
./scripts/setup-pi.sh
```

This will install:
- Node.js 20
- Python 3 with face_recognition
- OpenCV
- PM2
- All dependencies

### Step 4: Configure Your Mirror

1. **Run the setup wizard:**
   - Open `http://skyglass.local:3001/setup` in a browser
   - Enter your home airport (ICAO code)
   - Set your location
   - Enroll your face

2. **Or edit config manually:**
   ```bash
   nano ~/SkyGlass/config/config.yaml
   ```

### Step 5: Enroll Your Face

Option A - Web UI (recommended):
```bash
cd ~/SkyGlass
npm run enroll:web
# Open http://skyglass.local:5050 in browser
```

Option B - Command line:
```bash
npm run enroll
# Follow the prompts, press SPACE to capture
```

### Step 6: Start the Services

```bash
cd ~/SkyGlass
npm run start   # Starts all services via PM2
npm run logs    # View logs
```

### Step 7: Enable Auto-Start on Boot

The setup script already configured this, but verify:

```bash
pm2 status
pm2 save
```

### Step 8: Configure Kiosk Mode

The setup script created autostart files. On next reboot, Chromium will launch automatically in kiosk mode pointing to `http://localhost:3001` (the backend serves the built display UI).

Test it:
```bash
sudo reboot
```

---

## Mounting on Wall

### Option 1: French Cleat (Recommended)

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

### Option 2: Z-Bar Hangers

Available at hardware stores. Good for medium-weight frames.

### Option 3: Picture Wire

Only for lighter builds (<15 lbs).

---

## Troubleshooting

### Display Issues

| Problem | Solution |
|---------|----------|
| No display output | Check HDMI connection, try different cable |
| Display too dim behind mirror | Increase monitor brightness to 100% |
| Text hard to read | Adjust font sizes in frontend settings |
| Screen flickering | Check power supply, try different outlet |

### Camera Issues

| Problem | Solution |
|---------|----------|
| Camera not detected | Check ribbon cable orientation |
| Face not recognized | Re-enroll with better lighting |
| Slow recognition | Reduce resolution in detector.py |
| Camera preview black | Enable camera in raspi-config |

### Presence Detection Issues

| Problem | Solution |
|---------|----------|
| Mirror won't turn on | Check face enrollment, run with --preview |
| Mirror won't turn off | Adjust timeout in config.yaml |
| Detects other people | Re-enroll with lower tolerance (0.5) |
| Too sensitive | Increase min_frames in config |

### Network Issues

| Problem | Solution |
|---------|----------|
| Can't access setup wizard | Check Pi IP with `hostname -I` |
| Aviation data not loading | Check internet, verify API endpoints |
| WebSocket disconnecting | Check for network stability |

### Heat Issues

| Problem | Solution |
|---------|----------|
| Pi throttling | Add ventilation holes to frame |
| Monitor too hot | Add small USB fan |
| System unstable | Check CPU temp: `vcgencmd measure_temp` |

---

## Maintenance

### Regular Tasks

- **Weekly:** Check for software updates (`npm run update`)
- **Monthly:** Clean mirror surface, check cable connections
- **Yearly:** Re-apply thermal paste if temps are high

### Updating Software

```bash
cd ~/SkyGlass
git pull
npm install
npm run build
pm2 restart all
```

---

## Sample Shopping Cart (Recommended Build)

For a 24" mirror build:

| Item | Source | Price |
|------|--------|-------|
| Raspberry Pi 5 4GB | RPi Foundation | $60 |
| Pi Camera Module 3 | RPi Foundation | $25 |
| 27W Power Supply | RPi Foundation | $12 |
| Active Cooler | RPi Foundation | $5 |
| 32GB microSD | Amazon | $8 |
| Dell SE2422H 24" Monitor | Amazon | $120 |
| Two-Way Acrylic 24x18" | TAP Plastics | $60 |
| IKEA RIBBA Frame 24x18 | IKEA | $30 |
| Flat HDMI Cable 6ft | Amazon | $8 |
| Camera Ribbon 50cm | Amazon | $8 |
| Velcro Strips | Amazon | $8 |
| Slim Power Strip | Amazon | $15 |
| **Total** | | **~$359** |

---

## Resources

- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)
- [Two Way Mirrors - Smart Mirror Guide](https://www.twowaymirrors.com/smart-mirror-guide/)
- [/r/SkyGlass Subreddit](https://www.reddit.com/r/SkyGlass/)
- [Pi Camera Troubleshooting](https://www.raspberrypi.com/documentation/computers/camera_software.html)

---

*Happy building! If you have questions, open an issue on GitHub.*
