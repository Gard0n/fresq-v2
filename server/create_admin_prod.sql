-- FRESQ V2 - Créer un admin pour PRODUCTION
-- ⚠️ IMPORTANT: Change le mot de passe !

-- 1. Créer les tables si elles n'existent pas
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INT REFERENCES admins(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Créer l'admin principal
-- ⚠️ CHANGE l'email et génère un nouveau hash bcrypt !
--
-- Pour générer un hash bcrypt:
-- 1. Va sur https://bcrypt-generator.com/
-- 2. Entre ton mot de passe
-- 3. Rounds: 10
-- 4. Copie le hash généré ci-dessous

INSERT INTO admins (email, password_hash)
VALUES (
  'mathieu.jardin.pro@gmail.com',  -- ⚠️ CHANGE CECI
  '$2a$15$KMxYfxRkxNSu3Y23WbS2tO2shiiTcGuMgjU94cKeXKQQuudFbCoRa'  -- ⚠️ CHANGE CECI (hash de "admin123")
)
ON CONFLICT (email) DO NOTHING;

-- 3. Vérifier
SELECT id, email, created_at FROM admins;

-- 4. Tester le hash (optionnel)
-- Pour tester que ton hash fonctionne, utilise bcrypt.compare() côté serveur
