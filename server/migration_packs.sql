-- FRESQ V2 - Pack System Migration
-- Date: 2026-01-31
-- Description: Ajoute le système de packs de tickets avec bonus

-- ===== 1. Modifier la table tickets pour tracking payés vs bonus =====

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS base_quantity INT DEFAULT 1,
ADD COLUMN IF NOT EXISTS bonus_quantity INT DEFAULT 0;

COMMENT ON COLUMN tickets.quantity IS 'Nombre TOTAL de tickets (base + bonus)';
COMMENT ON COLUMN tickets.base_quantity IS 'Nombre de tickets PAYÉS (comptent pour revenus et tier upgrade)';
COMMENT ON COLUMN tickets.bonus_quantity IS 'Nombre de tickets BONUS gratuits (ne comptent pas pour revenus)';

-- ===== 2. Modifier la table codes pour tracer la source =====

ALTER TABLE codes
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'purchased';

COMMENT ON COLUMN codes.source IS 'Origine du code: purchased, pack_bonus, referral, admin_gift';

CREATE INDEX IF NOT EXISTS idx_codes_source ON codes(source);

-- ===== 3. Créer la table pack_configs =====

CREATE TABLE IF NOT EXISTS pack_configs (
  id SERIAL PRIMARY KEY,
  pack_key VARCHAR(50) UNIQUE NOT NULL,     -- 'solo', 'mini', 'medium', 'mega', 'ultra'
  label VARCHAR(100) NOT NULL,               -- 'Pack Solo', 'Pack Mini', etc.
  base_tickets INT NOT NULL,                 -- Tickets payés (1, 5, 10, 50, 100)
  bonus_tickets INT DEFAULT 0,               -- Tickets bonus (0, 1, 2, 5, 10)
  total_tickets INT NOT NULL,                -- Total = base + bonus
  price DECIMAL(10,2) NOT NULL,              -- Prix en euros
  discount_percent INT DEFAULT 0,            -- % de réduction affiché (calculé)
  is_active BOOLEAN DEFAULT TRUE,            -- Pack disponible à l'achat
  display_order INT DEFAULT 0,               -- Ordre d'affichage
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE pack_configs IS 'Configuration des packs de tickets disponibles à l''achat';

-- ===== 4. Initialiser les tickets existants =====

-- Pour les tickets existants, quantity = base_quantity (tout est payé, pas de bonus)
UPDATE tickets
SET
  base_quantity = COALESCE(quantity, 1),
  bonus_quantity = 0
WHERE base_quantity IS NULL;

-- Pour les codes existants, source = 'purchased'
UPDATE codes
SET source = 'purchased'
WHERE source IS NULL;

-- ===== 5. Insérer les packs par défaut =====

INSERT INTO pack_configs (pack_key, label, base_tickets, bonus_tickets, total_tickets, price, discount_percent, display_order)
VALUES
  ('solo',   'Pack Solo',   1,   0,  1,   2.00,   0,  1),
  ('mini',   'Pack Mini',   5,   1,  6,   10.00,  0,  2),
  ('medium', 'Pack Medium', 10,  2,  12,  20.00,  0,  3),
  ('mega',   'Pack Mega',   50,  5,  55,  100.00, 0,  4),
  ('ultra',  'Pack Ultra',  100, 10, 110, 200.00, 0,  5)
ON CONFLICT (pack_key) DO UPDATE SET
  label = EXCLUDED.label,
  base_tickets = EXCLUDED.base_tickets,
  bonus_tickets = EXCLUDED.bonus_tickets,
  total_tickets = EXCLUDED.total_tickets,
  price = EXCLUDED.price,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

-- ===== 6. Créer index pour performance =====

CREATE INDEX IF NOT EXISTS idx_pack_configs_active ON pack_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_pack_configs_order ON pack_configs(display_order);
CREATE INDEX IF NOT EXISTS idx_tickets_quantity ON tickets(quantity);
CREATE INDEX IF NOT EXISTS idx_tickets_base_quantity ON tickets(base_quantity);

-- ===== 7. Fonction helper pour calculer le discount_percent =====

-- Note: Le discount est calculé comme suit:
-- Prix unitaire solo: 2.00€
-- Prix avec pack: price / total_tickets
-- Discount: (1 - (price/total) / 2.00) * 100

UPDATE pack_configs SET discount_percent = (
  CASE
    WHEN total_tickets = 1 THEN 0
    ELSE ROUND((1 - (price / total_tickets) / 2.00) * 100)
  END
);

-- ===== 8. Vérification =====

DO $$
BEGIN
  RAISE NOTICE 'Migration packs completed successfully!';
  RAISE NOTICE 'Packs configured: %', (SELECT COUNT(*) FROM pack_configs WHERE is_active = TRUE);
END $$;
