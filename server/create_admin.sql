-- FRESQ V2 - Créer un compte admin de test
-- Exécute ce SQL dans Supabase pour créer un admin

-- 1. Créer la table admins si elle n'existe pas
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Créer la table admin_sessions si elle n'existe pas
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INT REFERENCES admins(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Insérer un admin de test
-- Password: admin123 (hash bcrypt)
-- IMPORTANT: Change ce password en production !
INSERT INTO admins (email, password_hash)
VALUES ('admin@fresq.com', '$2b$10$XOPbrlUPQdthB9K7R5Kl6.L3rNHhCXULDYU1J9.YLe3P9KY9cWqmS')
ON CONFLICT (email) DO NOTHING;

-- 4. Vérification
SELECT id, email, created_at FROM admins;
