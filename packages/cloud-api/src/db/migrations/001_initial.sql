-- Migration: 001_initial
-- Description: Initial schema for cloud API

-- Users come from Clerk, store additional data here
CREATE TABLE IF NOT EXISTS user_profiles (
    clerk_id VARCHAR(255) PRIMARY KEY,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registered mirrors
CREATE TABLE IF NOT EXISTS mirrors (
    id UUID PRIMARY KEY,
    owner_clerk_id VARCHAR(255) NOT NULL REFERENCES user_profiles(clerk_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    relay_token VARCHAR(64) UNIQUE,
    online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Synced layouts
CREATE TABLE IF NOT EXISTS user_layouts (
    id UUID PRIMARY KEY,
    clerk_id VARCHAR(255) NOT NULL REFERENCES user_profiles(clerk_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    modules JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT FALSE,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_mirrors_owner ON mirrors(owner_clerk_id);
CREATE INDEX IF NOT EXISTS idx_layouts_user ON user_layouts(clerk_id);
CREATE INDEX IF NOT EXISTS idx_layouts_updated ON user_layouts(updated_at);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
