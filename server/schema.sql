-- FRESQ V2 - Database Schema
-- Execute this in your Supabase SQL Editor

-- ===== CONFIG TABLE =====
CREATE TABLE IF NOT EXISTS config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  grid_w INTEGER NOT NULL DEFAULT 200,
  grid_h INTEGER NOT NULL DEFAULT 200,
  state_version INTEGER NOT NULL DEFAULT 1,
  palette TEXT[] NOT NULL DEFAULT ARRAY[
    '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#ff00ff', '#00ffff',
    '#ff8800', '#8800ff', '#00ff88',
    '#ffffff'
  ],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_config CHECK (id = TRUE)
);

-- Insert default config
INSERT INTO config (id, grid_w, grid_h, palette)
VALUES (TRUE, 200, 200, ARRAY[
  '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff',
  '#ff8800', '#8800ff', '#00ff88',
  '#ffffff'
])
ON CONFLICT (id) DO NOTHING;

-- ===== CODES TABLE =====
CREATE TABLE IF NOT EXISTS codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  cell_x INTEGER,
  cell_y INTEGER,
  color INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_cell UNIQUE (cell_x, cell_y)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_codes_code ON codes(code);
CREATE INDEX IF NOT EXISTS idx_codes_cell ON codes(cell_x, cell_y);

-- ===== ADMINS TABLE =====
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== ADMIN SESSIONS TABLE =====
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Clean up expired sessions periodically
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM admin_sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ===== USEFUL QUERIES =====

-- View current grid state
-- SELECT cell_x AS x, cell_y AS y, color FROM codes WHERE cell_x IS NOT NULL;

-- Count statistics
-- SELECT
--   COUNT(*) as total_codes,
--   COUNT(cell_x) as assigned_codes,
--   COUNT(DISTINCT color) as colors_used
-- FROM codes;

-- Find empty codes
-- SELECT code FROM codes WHERE cell_x IS NULL;
