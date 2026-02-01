-- FRESQ V2 - Nettoyer les données de test
-- ⚠️ À exécuter UNIQUEMENT en production pour supprimer les données de développement

-- 1. Voir tous les utilisateurs de test
SELECT id, email, created_at
FROM users
WHERE email LIKE '%test%'
   OR email LIKE '%fresq.com%'
ORDER BY created_at DESC;

-- 2. Supprimer les utilisateurs de test (et leurs codes/tickets associés)
-- ⚠️ ORDRE IMPORTANT : prizes → tickets → referrals → codes → users

-- Étape 1 : Supprimer les prizes gagnés par les utilisateurs de test (contrainte FK)
DELETE FROM prizes
WHERE winner_ticket_id IN (
  SELECT id FROM tickets
  WHERE user_id IN (
    SELECT id FROM users
    WHERE email LIKE '%test%'
       OR email LIKE '%fresq.com%'
  )
);

-- Étape 2 : Supprimer les tickets AVANT les codes (contrainte FK)
DELETE FROM tickets
WHERE user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%test%'
     OR email LIKE '%fresq.com%'
);

-- Étape 3 : Supprimer les referrals
DELETE FROM referrals
WHERE referrer_user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%test%'
     OR email LIKE '%fresq.com%'
)
OR referred_user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%test%'
     OR email LIKE '%fresq.com%'
);

-- Étape 4 : Supprimer les codes
DELETE FROM codes
WHERE user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%test%'
     OR email LIKE '%fresq.com%'
);

-- Étape 5 : Supprimer les utilisateurs
DELETE FROM users
WHERE email LIKE '%test%'
   OR email LIKE '%fresq.com%';

-- 3. Vérifier que c'est bien supprimé
SELECT COUNT(*) as "Utilisateurs restants" FROM users;
SELECT COUNT(*) as "Codes restants" FROM codes;
SELECT COUNT(*) as "Tickets restants" FROM tickets;
