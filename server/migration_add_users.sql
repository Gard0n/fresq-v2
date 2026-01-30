-- Migration: Add user authentication system
-- Execute this in your Supabase SQL Editor

-- ===== USERS TABLE =====
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===== ADD USER_ID TO CODES TABLE =====
ALTER TABLE codes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Index for faster user code lookups
CREATE INDEX IF NOT EXISTS idx_codes_user_id ON codes(user_id);

-- Note: Existing codes will have user_id = NULL
-- They will be assigned to users when claimed with an email
