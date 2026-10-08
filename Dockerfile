# Multi-stage Dockerfile for SkyGlass
# Supports both development and production builds

# ============================================================
# Stage 1: Base Node.js image
# ============================================================
FROM node:20-bookworm-slim AS base

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    libopencv-dev \
    python3-opencv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ============================================================
# Stage 2: Install dependencies
# ============================================================
FROM base AS deps

COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/
COPY packages/frontend/package*.json ./packages/frontend/

RUN npm ci

# ============================================================
# Stage 3: Build the application
# ============================================================
FROM deps AS builder

COPY . .

# Build backend and frontend
RUN npm run build

# ============================================================
# Stage 4: Production image
# ============================================================
FROM base AS production

ENV NODE_ENV=production
ENV PORT=3001
# The backend serves packages/frontend/dist (SPA) on $PORT alongside /api and /ws
ENV SKYGLASS_SERVE_FRONTEND=1

WORKDIR /app

# Copy built assets
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/package*.json ./packages/backend/
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --from=builder /app/packages/frontend/package*.json ./packages/frontend/
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/config ./config

# Install production dependencies only
RUN npm ci --omit=dev --workspace=packages/backend

# Copy presence detection (Python)
COPY packages/presence ./packages/presence

# Set up Python virtual environment
RUN python3 -m venv /app/packages/presence/venv && \
    /app/packages/presence/venv/bin/pip install --no-cache-dir \
    flask \
    opencv-python-headless \
    numpy \
    requests \
    pyyaml

# Expose ports: 3001 = UI + API + WebSocket, 5000 = presence/admin
EXPOSE 3001 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# Start script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start"]
