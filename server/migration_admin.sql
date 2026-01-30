-- Migration: Add admin features
-- Execute this in your Supabase SQL Editor

-- ===== ADD IS_BANNED TO USERS TABLE =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;

-- Index for faster banned users lookups
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- Note: Admin authentication uses the existing 'admins' and 'admin_sessions' tables
