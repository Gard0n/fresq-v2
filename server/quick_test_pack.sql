-- FRESQ V2 - Créer un pack de test rapidement
-- Exécute ce SQL dans Supabase pour créer un utilisateur avec un Pack Mini

-- 1. Créer l'utilisateur test
INSERT INTO users (email)
VALUES ('pack-test@fresq.com')
ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
RETURNING id;

-- 2. Créer le ticket Pack Mini (6 codes: 5 payés + 1 bonus)
INSERT INTO tickets (
  order_id,
  payment_provider,
  email,
  user_id,
  amount,
  quantity,
  base_quantity,
  bonus_quantity,
  status,
  tier_id,
  paid_at
)
VALUES (
  'TEST-MINI-' || FLOOR(RANDOM() * 100000)::TEXT,
  'manual',
  'pack-test@fresq.com',
  (SELECT id FROM users WHERE email = 'pack-test@fresq.com'),
  10.00,
  6,
  5,
  1,
  'paid',
  1,
  NOW()
)
RETURNING id, order_id;

-- 3. Générer 5 codes PURCHASED (payés)
INSERT INTO codes (code, user_id, source)
SELECT
  'TEST-P' || LPAD(generate_series::TEXT, 3, '0'),
  (SELECT id FROM users WHERE email = 'pack-test@fresq.com'),
  'purchased'
FROM generate_series(1, 5);

-- 4. Générer 1 code BONUS
INSERT INTO codes (code, user_id, source)
VALUES (
  'TEST-BONUS',
  (SELECT id FROM users WHERE email = 'pack-test@fresq.com'),
  'pack_bonus'
);

-- 5. Vérification : Afficher tous les codes créés
SELECT
  c.code,
  c.source,
  CASE
    WHEN c.cell_x IS NULL THEN 'Non assigné'
    ELSE 'Peint (' || c.cell_x || ', ' || c.cell_y || ')'
  END as statut
FROM codes c
JOIN users u ON u.id = c.user_id
WHERE u.email = 'pack-test@fresq.com'
ORDER BY c.source, c.code;

-- 6. Vérification : Afficher le ticket créé
SELECT
  order_id as "Commande",
  quantity as "Total",
  base_quantity as "Payés",
  bonus_quantity as "Bonus",
  amount as "Prix",
  status as "Statut"
FROM tickets
WHERE email = 'pack-test@fresq.com'
ORDER BY created_at DESC
LIMIT 1;
