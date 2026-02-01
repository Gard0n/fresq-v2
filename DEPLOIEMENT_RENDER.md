# FRESQ V2 - Déploiement sur Render

## 🚀 Étapes de Déploiement

### 1. Préparer le code pour Render

**Créer `render.yaml` à la racine du projet:**

```yaml
services:
  - type: web
    name: fresq-v2
    env: node
    region: frankfurt  # ou oregon
    plan: free  # ou starter/standard
    buildCommand: cd server && npm install
    startCommand: cd server && node index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3000
      - key: DATABASE_URL
        sync: false  # À configurer manuellement
      - key: DATABASE_SSL
        value: true
```

**OU configuration manuelle (plus simple pour commencer):**

### 2. Push le code sur GitHub

```bash
cd /Users/grdn/Desktop/Perso/Perso/Code/FRESQ-V2

# Initialiser git si pas déjà fait
git init
git add .
git commit -m "FRESQ V2 - Ready for deployment"

# Créer un repo sur GitHub et push
git remote add origin https://github.com/ton-username/fresq-v2.git
git branch -M main
git push -u origin main
```

### 3. Créer le Web Service sur Render

1. Va sur **https://dashboard.render.com**
2. Clique sur **"New +"** → **"Web Service"**
3. Connecte ton repo GitHub `fresq-v2`
4. Configure:

**Settings:**
- **Name:** `fresq-v2`
- **Region:** Frankfurt (Europe) ou Oregon (USA)
- **Branch:** `main`
- **Root Directory:** (laisse vide)
- **Environment:** `Node`
- **Build Command:**
  ```bash
  cd server && npm install
  ```
- **Start Command:**
  ```bash
  cd server && node index.js
  ```
- **Plan:** Free (ou Starter si tu veux plus de ressources)

### 4. Configurer les Variables d'Environnement

Dans Render Dashboard → ton service → **Environment**:

Ajoute ces variables:

```
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:TON_PASSWORD@db.fgzbljzvrbfcyoicvsuu.supabase.co:5432/postgres
DATABASE_SSL=true
```

**IMPORTANT:** Utilise ta vraie DATABASE_URL Supabase !

### 5. Déployer

Clique sur **"Create Web Service"** ou **"Manual Deploy"**

Render va:
1. ✅ Cloner ton repo
2. ✅ Installer les dépendances
3. ✅ Lancer l'application
4. ✅ Te donner une URL: `https://fresq-v2.onrender.com`

### 6. Configuration Supabase (IMPORTANT)

Dans **Supabase Dashboard** → Settings → Database:

**Ajouter l'IP de Render aux connexions autorisées:**
- Render utilise des IPs dynamiques, donc:
- Va dans **Settings** → **Network** → Désactive **"SSL Mode"** si problème
- OU ajoute `0.0.0.0/0` (tous les IPs) temporairement pour tester

**Meilleure solution:**
- Utilise la Connection Pooler de Supabase (port 6543 au lieu de 5432)
```
DATABASE_URL=postgresql://postgres.fgzbljzvrbfcyoicvsuu:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

---

## 🔒 Sécurité AVANT déploiement

### 1. Supprimer le bypass auth dev

**Dans `server/index.js` lignes 581-585, SUPPRIMER:**

```javascript
// TEMPORARY: Bypass auth in development for GET requests
if (process.env.NODE_ENV === 'development' && req.method === 'GET') {
  req.admin = { id: 0, email: 'dev@test.com' };
  return next();
}
```

### 2. Créer un admin dans Supabase

```sql
-- Dans Supabase SQL Editor
INSERT INTO admins (email, password_hash)
VALUES (
  'ton-email@example.com',
  -- Génère un hash bcrypt de ton mot de passe
  '$2b$10$XOPbrlUPQdthB9K7R5Kl6.L3rNHhCXULDYU1J9.YLe3P9KY9cWqmS'
);

-- Pour générer un hash bcrypt en Node.js:
-- const bcrypt = require('bcryptjs');
-- const hash = bcrypt.hashSync('ton-mot-de-passe', 10);
-- console.log(hash);
```

---

## 🎯 Après le déploiement

### Tester l'application

**URL Render:** `https://fresq-v2.onrender.com` (ou ton nom)

1. ✅ Interface principale
2. ✅ Admin: `https://fresq-v2.onrender.com/admin.html`
3. ✅ Login admin avec ton compte créé
4. ✅ WebSockets fonctionnent (peinture temps réel)

### Domaine personnalisé (optionnel)

Dans Render Dashboard → Settings → **Custom Domain**:
- Ajoute ton domaine (ex: `fresq.ton-site.com`)
- Configure le CNAME chez ton registrar
- Render génère automatiquement le SSL

---

## 🔄 Mises à jour

**Déploiement automatique (recommandé):**
1. Push sur GitHub
2. Render redéploie automatiquement
```bash
git add .
git commit -m "Update"
git push
```

**Déploiement manuel:**
Render Dashboard → ton service → **Manual Deploy**

---

## 📊 Monitoring Render

- **Logs:** Dashboard → Logs (temps réel)
- **Metrics:** CPU, Mémoire, Requêtes
- **Alertes:** Configure des notifications

---

## ⚡ Optimisations

### 1. Plan Starter (recommandé pour production)

**Free plan limites:**
- ❌ Se met en veille après 15min d'inactivité
- ❌ 750h/mois max
- ✅ 512MB RAM

**Starter plan ($7/mois):**
- ✅ Toujours actif
- ✅ 512MB RAM
- ✅ Meilleure performance

### 2. Cache statique

Render sert automatiquement les fichiers statiques avec cache.

### 3. Variables d'environnement par branche

Render Dashboard → Environment:
- Différentes configs pour `main` (prod) et `dev`

---

## 🐛 Dépannage

### L'app crash au démarrage

**Logs Render:**
```bash
# Vérifier les logs pour voir l'erreur
Dashboard → Logs
```

**Erreur DATABASE_URL:**
- Vérifier que DATABASE_URL est bien configurée
- Utiliser le Connection Pooler (port 6543)

### WebSockets ne fonctionnent pas

Render supporte WebSocket automatiquement, mais:
- Vérifier que Socket.IO est bien installé
- Logs: chercher "WebSocket server ready"

### 502 Bad Gateway

- L'app a probablement crash
- Vérifier les logs
- Vérifier que le port est bien configuré (`PORT=3000`)

---

## 📋 Checklist Déploiement Render

- [ ] Code poussé sur GitHub
- [ ] Web Service créé sur Render
- [ ] Variables d'environnement configurées
- [ ] DATABASE_URL Supabase configurée (avec pooler)
- [ ] NODE_ENV=production
- [ ] Bypass auth dev SUPPRIMÉ
- [ ] Admin créé dans Supabase
- [ ] Premier déploiement lancé
- [ ] Application accessible via URL Render
- [ ] Admin login fonctionne
- [ ] WebSockets fonctionnent
- [ ] Tests complets réussis

---

## 🎯 Commandes utiles

### Générer hash bcrypt pour admin

```javascript
// Dans Node.js ou console navigateur
const bcrypt = require('bcryptjs');
const password = 'ton-mot-de-passe-fort';
const hash = bcrypt.hashSync(password, 10);
console.log(hash);
// Copie ce hash dans la requête SQL
```

### Tester la connexion DB

```bash
# Dans Render Shell (Dashboard → Shell)
node -e "
const pg = require('pg');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
pool.query('SELECT NOW()').then(r => console.log(r.rows));
"
```

---

## 🚀 Go Live !

Une fois tout configuré:
1. Déploie sur Render
2. Teste l'application
3. Crée ton premier pack
4. Partage l'URL ! 🎉
