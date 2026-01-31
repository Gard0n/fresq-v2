-- FRESQ V2 - Migration Commercial
-- Execute this in your Supabase SQL Editor

-- ===== TIERS (PALIERS) =====
CREATE TABLE IF NOT EXISTS tiers (
  id SERIAL PRIMARY KEY,
  tier_number INT NOT NULL UNIQUE,     -- 0, 1, 2, ..., 9
  min_tickets INT NOT NULL,            -- Ex: 20,000
  max_tickets INT NOT NULL,            -- Ex: 80,000
  grid_width INT NOT NULL,             -- Ex: 200
  grid_height INT NOT NULL,            -- Ex: 200
  total_cells INT NOT NULL,            -- grid_width * grid_height
  prize_amount DECIMAL NOT NULL,       -- Gain de ce palier
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insérer les paliers initiaux (basés sur le tableau fourni)
INSERT INTO tiers (tier_number, min_tickets, max_tickets, grid_width, grid_height, total_cells, prize_amount) VALUES
(0, 0, 20000, 200, 200, 40000, 10000),
(1, 20000, 40000, 283, 283, 80089, 10000),
(2, 40000, 80000, 400, 400, 160000, 20000),
(3, 80000, 100000, 447, 447, 199809, 40000),
(4, 100000, 200000, 632, 632, 399424, 50000),
(5, 200000, 300000, 775, 775, 600625, 100000),
(6, 300000, 400000, 894, 894, 799236, 150000),
(7, 400000, 600000, 1095, 1095, 1199025, 200000),
(8, 600000, 800000, 1265, 1265, 1600225, 300000),
(9, 800000, 1000000, 1414, 1414, 1999396, 400000)
ON CONFLICT (tier_number) DO NOTHING;

-- ===== TICKETS (ACHATS) =====
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR UNIQUE NOT NULL,    -- ID unique de commande
  payment_provider VARCHAR,             -- 'manual', 'stripe', 'paypal', etc.
  payment_session_id VARCHAR,           -- ID session paiement (Stripe checkout, etc.)
  email VARCHAR NOT NULL,               -- Email acheteur
  user_id INT REFERENCES users(id),     -- Optionnel si user créé
  code_id INT REFERENCES codes(id),     -- Code généré pour ce ticket
  amount DECIMAL NOT NULL,              -- Montant payé (2.00€)
  status VARCHAR DEFAULT 'pending',     -- 'pending', 'paid', 'refunded', 'cancelled'
  tier_id INT REFERENCES tiers(id),     -- Palier au moment de l'achat
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  refunded_at TIMESTAMP
);

-- ===== PRIZES (GAINS) =====
CREATE TABLE IF NOT EXISTS prizes (
  id SERIAL PRIMARY KEY,
  tier_id INT REFERENCES tiers(id),     -- Palier associé
  name VARCHAR NOT NULL,                -- "Gain Principal Palier 3"
  amount DECIMAL NOT NULL,              -- Montant du gain
  prize_type VARCHAR DEFAULT 'main',    -- 'main', 'secondary', 'daily', etc.
  draw_date TIMESTAMP,                  -- Date du tirage
  winner_ticket_id INT REFERENCES tickets(id), -- Ticket gagnant
  status VARCHAR DEFAULT 'pending',     -- 'pending', 'drawn', 'claimed', 'paid'
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== REFERRALS (PARRAINAGE) =====
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_user_id INT REFERENCES users(id),   -- Celui qui parraine
  referred_email VARCHAR NOT NULL,              -- Email parrainé
  referred_user_id INT REFERENCES users(id),    -- User créé (optionnel)
  free_ticket_code_id INT REFERENCES codes(id), -- Code gratuit généré
  status VARCHAR DEFAULT 'pending',     -- 'pending', 'completed', 'claimed'
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(email);
CREATE INDEX IF NOT EXISTS idx_tickets_tier_id ON tickets(tier_id);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_prizes_tier_id ON prizes(tier_id);
CREATE INDEX IF NOT EXISTS idx_prizes_status ON prizes(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_email ON referrals(referred_email);

-- Indexes existants à ajouter (PERFORMANCE!)
CREATE INDEX IF NOT EXISTS idx_codes_code ON codes(code);
CREATE INDEX IF NOT EXISTS idx_codes_cell ON codes(cell_x, cell_y);
CREATE INDEX IF NOT EXISTS idx_codes_user_id ON codes(user_id);
CREATE INDEX IF NOT EXISTS idx_codes_updated_at ON codes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_banned ON users(is_banned);

-- Verification
SELECT 'Migration commercial completed successfully!' as status;
