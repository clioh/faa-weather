#!/bin/bash
#
# SkyGlass Release Builder
#
# Creates a production-ready release bundle that can be:
# 1. Uploaded to GitHub Releases
# 2. Downloaded during SD card flashing
# 3. Installed without internet on the Pi
#
# The release includes:
# - Pre-built frontend (compiled React)
# - Pre-built backend (compiled TypeScript)
# - All configuration files
# - Setup scripts
# - Python presence detector
#
# Usage:
#   ./scripts/build-release.sh [version]
#
# Examples:
#   ./scripts/build-release.sh           # Uses version from package.json
#   ./scripts/build-release.sh 1.0.0     # Specific version
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.build"
RELEASE_DIR="$BUILD_DIR/release"

# Get version
VERSION="${1:-$(node -p "require('./package.json').version" 2>/dev/null || echo "0.1.0")}"
RELEASE_NAME="skyglass-v${VERSION}"
RELEASE_FILE="$BUILD_DIR/${RELEASE_NAME}.tar.gz"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           SkyGlass Release Builder                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "Version: $VERSION"
echo ""

cd "$PROJECT_DIR"

# Clean previous build
log_step "Cleaning previous build..."
rm -rf "$BUILD_DIR"
mkdir -p "$RELEASE_DIR"

# Install dependencies
log_step "Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || npm install

# Build frontend
log_step "Building frontend..."
cd packages/frontend
pnpm build 2>/dev/null || npm run build
cd "$PROJECT_DIR"

# Build backend
log_step "Building backend..."
cd packages/backend
pnpm build 2>/dev/null || npm run build
cd "$PROJECT_DIR"

# Create release structure
log_step "Creating release structure..."

# Copy built files
mkdir -p "$RELEASE_DIR/packages/frontend/dist"
mkdir -p "$RELEASE_DIR/packages/backend/dist"
mkdir -p "$RELEASE_DIR/packages/presence"
mkdir -p "$RELEASE_DIR/config"
mkdir -p "$RELEASE_DIR/scripts"

# Frontend - copy dist
cp -r packages/frontend/dist/* "$RELEASE_DIR/packages/frontend/dist/"
cp packages/frontend/package.json "$RELEASE_DIR/packages/frontend/"

# Backend - copy dist and package.json
cp -r packages/backend/dist/* "$RELEASE_DIR/packages/backend/dist/"
cp packages/backend/package.json "$RELEASE_DIR/packages/backend/"

# Presence detector (Python - no build needed)
cp -r packages/presence/*.py "$RELEASE_DIR/packages/presence/" 2>/dev/null || true
cp packages/presence/requirements.txt "$RELEASE_DIR/packages/presence/"
mkdir -p "$RELEASE_DIR/packages/presence/face_data"

# Config files
cp -r config/* "$RELEASE_DIR/config/"

# Scripts
cp -r scripts/*.sh "$RELEASE_DIR/scripts/"
cp -r scripts/firstboot "$RELEASE_DIR/scripts/" 2>/dev/null || true
chmod +x "$RELEASE_DIR/scripts/"*.sh

# Root files
cp package.json "$RELEASE_DIR/"
cp pnpm-workspace.yaml "$RELEASE_DIR/" 2>/dev/null || true
cp turbo.json "$RELEASE_DIR/" 2>/dev/null || true

# Create version file
echo "$VERSION" > "$RELEASE_DIR/VERSION"

# Create install script for the Pi
cat > "$RELEASE_DIR/install.sh" << 'INSTALL_EOF'
#!/bin/bash
#
# SkyGlass Quick Installer
# Run this after extracting the release
#

set -e

echo "=== SkyGlass Installer ==="
echo "Version: $(cat VERSION 2>/dev/null || echo 'unknown')"
echo ""

# Check if running as pi user
if [ "$USER" = "root" ]; then
    echo "Please run as 'pi' user, not root"
    echo "Usage: sudo -u pi ./install.sh"
    exit 1
fi

# Install Node.js if needed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install pnpm
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    sudo npm install -g pnpm
fi

# Install dependencies (production only)
echo "Installing Node.js dependencies..."
pnpm install --prod --frozen-lockfile 2>/dev/null || npm install --production

# Set up Python environment
echo "Setting up Python environment..."
cd packages/presence
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
cd ../..

# Create logs directory
mkdir -p logs

# Set up PM2
echo "Setting up PM2..."
sudo npm install -g pm2
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# Start services
echo "Starting services..."
pm2 start config/pm2.config.cjs
pm2 save

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Your SkyGlass is starting!"
echo "Access it at: http://$(hostname).local"
echo ""
INSTALL_EOF

chmod +x "$RELEASE_DIR/install.sh"

# Create the tarball
log_step "Creating release archive..."
cd "$BUILD_DIR"
tar -czf "$RELEASE_FILE" -C release .

# Calculate checksum
CHECKSUM=$(shasum -a 256 "$RELEASE_FILE" | cut -d' ' -f1)
echo "$CHECKSUM  ${RELEASE_NAME}.tar.gz" > "${RELEASE_FILE}.sha256"

# Get file size
SIZE=$(du -h "$RELEASE_FILE" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                   BUILD COMPLETE                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "Release: $RELEASE_FILE"
echo "Size:    $SIZE"
echo "SHA256:  $CHECKSUM"
echo ""
echo "To upload to GitHub:"
echo "  gh release create v${VERSION} $RELEASE_FILE --title 'v${VERSION}'"
echo ""
echo "The flash script will download from:"
echo "  https://github.com/YOUR_USER/SkyGlass/releases/download/v${VERSION}/${RELEASE_NAME}.tar.gz"
echo ""
