#!/bin/bash
#
# Generate self-signed SSL certificates for SkyGlass
# These certificates enable HTTPS for local network security
#
# Usage: ./scripts/generate-certs.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CERT_DIR="$PROJECT_DIR/config/certs"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Create certificate directory
mkdir -p "$CERT_DIR"

# Get hostname and IP for certificate
HOSTNAME=$(hostname)
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

log_info "Generating SSL certificates for SkyGlass..."
log_info "Hostname: $HOSTNAME"
log_info "IP Address: $IP_ADDR"

# Check if certificates already exist
if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
    log_warn "Certificates already exist at $CERT_DIR"
    read -p "Regenerate certificates? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Keeping existing certificates"
        exit 0
    fi
fi

# Create OpenSSL config for SAN (Subject Alternative Names)
cat > "$CERT_DIR/openssl.cnf" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = US
ST = Local
L = Local
O = SkyGlass
OU = Home
CN = $HOSTNAME

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = $HOSTNAME
DNS.2 = $HOSTNAME.local
DNS.3 = localhost
DNS.4 = skyglass.local
IP.1 = $IP_ADDR
IP.2 = 127.0.0.1
EOF

# Generate private key
log_info "Generating private key..."
openssl genrsa -out "$CERT_DIR/server.key" 2048

# Generate self-signed certificate (valid for 10 years)
log_info "Generating self-signed certificate..."
openssl req -new -x509 \
    -key "$CERT_DIR/server.key" \
    -out "$CERT_DIR/server.crt" \
    -days 3650 \
    -config "$CERT_DIR/openssl.cnf"

# Set permissions
chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

# Generate combined PEM file for some servers
cat "$CERT_DIR/server.crt" "$CERT_DIR/server.key" > "$CERT_DIR/server.pem"
chmod 600 "$CERT_DIR/server.pem"

# Clean up config
rm "$CERT_DIR/openssl.cnf"

log_info "Certificates generated successfully!"
echo ""
echo "Files created:"
echo "  $CERT_DIR/server.crt  (Certificate)"
echo "  $CERT_DIR/server.key  (Private Key)"
echo "  $CERT_DIR/server.pem  (Combined)"
echo ""
echo "Certificate details:"
openssl x509 -in "$CERT_DIR/server.crt" -noout -subject -dates
echo ""
echo "Subject Alternative Names:"
openssl x509 -in "$CERT_DIR/server.crt" -noout -ext subjectAltName 2>/dev/null || \
    openssl x509 -in "$CERT_DIR/server.crt" -noout -text | grep -A1 "Subject Alternative Name"
echo ""
log_warn "Note: Browsers will show a security warning for self-signed certificates."
log_warn "This is normal for local network use. Click 'Advanced' -> 'Proceed' to continue."
