#!/bin/bash
#
# SkyGlass Mac Development Setup
#
# This script sets up a Mac for SkyGlass development.
# It installs dependencies and configures the environment.
#
# Usage: ./scripts/setup-mac.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running on Mac
if [[ "$(uname)" != "Darwin" ]]; then
    error "This script is for macOS only. Use setup-pi.sh for Linux/Raspberry Pi."
fi

echo ""
echo "=============================================="
echo "  SkyGlass Development Setup for macOS"
echo "=============================================="
echo ""

# ============================================================
# Step 1: Check Homebrew
# ============================================================
info "Checking for Homebrew..."

if ! command -v brew &> /dev/null; then
    warn "Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    success "Homebrew is installed"
fi

# ============================================================
# Step 2: Install Node.js
# ============================================================
info "Checking Node.js..."

if ! command -v node &> /dev/null; then
    warn "Node.js not found. Installing via Homebrew..."
    brew install node@20
    echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        warn "Node.js version is below 20. Upgrading..."
        brew upgrade node || brew install node@20
    else
        success "Node.js $(node -v) is installed"
    fi
fi

# ============================================================
# Step 3: Install Python
# ============================================================
info "Checking Python..."

if ! command -v python3 &> /dev/null; then
    warn "Python 3 not found. Installing..."
    brew install python@3.11
else
    PYTHON_VERSION=$(python3 -c 'import sys; print(sys.version_info.minor)')
    if [ "$PYTHON_VERSION" -lt 11 ]; then
        warn "Python version is below 3.11. Consider upgrading."
    fi
    success "Python $(python3 --version) is installed"
fi

# ============================================================
# Step 4: Install OpenCV dependencies
# ============================================================
info "Installing OpenCV dependencies..."

brew list cmake &>/dev/null || brew install cmake
success "CMake installed"

# ============================================================
# Step 5: Navigate to project directory
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

info "Working in: $PROJECT_DIR"

# ============================================================
# Step 6: Install Node.js dependencies
# ============================================================
info "Installing Node.js dependencies..."

npm install
success "Node.js dependencies installed"

# ============================================================
# Step 7: Set up Python virtual environment
# ============================================================
info "Setting up Python virtual environment..."

cd packages/presence

if [ ! -d "venv" ]; then
    python3 -m venv venv
    success "Created virtual environment"
fi

source venv/bin/activate

info "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Try to install optional dependencies
info "Installing optional Python packages..."
pip install mediapipe 2>/dev/null || warn "MediaPipe not installed (optional)"
pip install face_recognition 2>/dev/null || warn "face_recognition not installed (optional, needs dlib)"
pip install qrcode[pil] 2>/dev/null || warn "qrcode not installed (optional)"

deactivate
cd "$PROJECT_DIR"

success "Python environment ready"

# ============================================================
# Step 8: Create default config
# ============================================================
info "Setting up configuration..."

if [ ! -f "config/config.yaml" ]; then
    cp config/default.yaml config/config.yaml
    success "Created config/config.yaml from default"
    warn "Edit config/config.yaml to set your airport and preferences"
else
    success "config/config.yaml already exists"
fi

# ============================================================
# Step 9: Build the project
# ============================================================
info "Building the project..."

npm run build
success "Build complete"

# ============================================================
# Step 10: Test camera access
# ============================================================
info "Testing camera access..."

cd packages/presence
source venv/bin/activate

python3 -c "
import cv2
cap = cv2.VideoCapture(0)
if cap.isOpened():
    print('Camera access: OK')
    cap.release()
else:
    print('Camera access: FAILED')
    print('Grant camera permission: System Settings > Privacy & Security > Camera > Terminal')
" || warn "Camera test failed. Grant permission in System Settings."

deactivate
cd "$PROJECT_DIR"

# ============================================================
# Done!
# ============================================================
echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit your config:"
echo "     nano config/config.yaml"
echo ""
echo "  2. Start development servers:"
echo "     npm run dev"
echo ""
echo "  3. Open in browser:"
echo "     Frontend: http://localhost:5173"
echo "     Backend:  http://localhost:3001"
echo "     Admin:    http://localhost:5000/admin"
echo ""
echo "  4. (Optional) Enroll your face:"
echo "     npm run enroll:web"
echo ""
echo "  If camera doesn't work, grant permission:"
echo "  System Settings > Privacy & Security > Camera > Terminal"
echo ""
success "Happy coding!"
