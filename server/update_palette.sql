-- Migration to add 10th color to palette
-- Execute this in Supabase SQL Editor

UPDATE config
SET palette = ARRAY[
  '#ff0000', '#00ff00', '#0000ff',
  '#ffff00', '#ff00ff', '#00ffff',
  '#ff8800', '#8800ff', '#00ff88',
  '#ffffff'
],
updated_at = NOW()
WHERE id = TRUE;
