# FRESQ V2 - Guide de Déploiement

## 📋 Prérequis

- Serveur Linux (Ubuntu 22.04 recommandé)
- Node.js 18+ installé
- PostgreSQL (via Supabase)
- Nom de domaine pointant vers le serveur
- Accès SSH au serveur

---

## 🚀 Étapes de Déploiement

### 1. Préparer le serveur

```bash
# Connexion SSH
ssh user@your-server.com

# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer Node.js 18+ (si pas déjà fait)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Installer PM2 (gestionnaire de processus)
sudo npm install -g pm2

# Installer Nginx (reverse proxy)
sudo apt install -y nginx

# Installer Certbot (SSL gratuit)
sudo apt install -y certbot python3-certbot-nginx
```

### 2. Cloner/Uploader le projet

**Option A: Git (recommandé)**
```bash
cd /var/www
sudo git clone https://github.com/votre-repo/fresq-v2.git
cd fresq-v2/server
sudo npm install
```

**Option B: SCP (upload manuel)**
```bash
# Sur ton Mac
cd /Users/grdn/Desktop/Perso/Perso/Code
scp -r FRESQ-V2 user@your-server.com:/var/www/fresq-v2
```

### 3. Configuration environnement

```bash
cd /var/www/fresq-v2/server

# Créer le fichier .env
sudo nano .env
```

Contenu du `.env`:
```env
DATABASE_URL=postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres
DATABASE_SSL=true
PORT=3000
NODE_ENV=production
```

**IMPORTANT**: Change `NODE_ENV=production` pour:
- ✅ Activer l'authentification admin
- ✅ Activer le cache
- ✅ Désactiver les logs de debug

### 4. Lancer avec PM2

```bash
cd /var/www/fresq-v2/server

# Lancer l'application
pm2 start index.js --name fresq-v2

# Configurer PM2 pour démarrage auto
pm2 startup
pm2 save

# Vérifier le statut
pm2 status
pm2 logs fresq-v2
```

### 5. Configurer Nginx (reverse proxy)

```bash
sudo nano /etc/nginx/sites-available/fresq-v2
```

Contenu:
```nginx
server {
    listen 80;
    server_name votre-domaine.com www.votre-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Activer le site:
```bash
sudo ln -s /etc/nginx/sites-available/fresq-v2 /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Activer HTTPS (SSL)

```bash
sudo certbot --nginx -d votre-domaine.com -d www.votre-domaine.com
```

Certbot va automatiquement:
- ✅ Générer le certificat SSL
- ✅ Configurer Nginx pour HTTPS
- ✅ Rediriger HTTP → HTTPS

### 7. Configuration Firewall

```bash
# UFW (Ubuntu Firewall)
sudo ufw allow 'Nginx Full'
sudo ufw allow ssh
sudo ufw enable
```

---

## 🔒 Sécurité - IMPORTANT

### 1. Créer un admin dans Supabase

```sql
-- Exécute dans Supabase SQL Editor
INSERT INTO admins (email, password_hash)
VALUES (
  'votre-email@example.com',
  '$2b$10$...' -- Utilise bcrypt pour hasher ton mot de passe
);
```

### 2. Retirer le bypass auth dev

**AVANT de déployer**, dans `server/index.js` ligne 581-585:

**SUPPRIMER ces lignes:**
```javascript
// TEMPORARY: Bypass auth in development for GET requests (read-only)
// TODO: Remove this in production!
if (process.env.NODE_ENV === 'development' && req.method === 'GET') {
  req.admin = { id: 0, email: 'dev@test.com' };
  return next();
}
```

### 3. Variables d'environnement sensibles

- ✅ Utilise des mots de passe forts pour Supabase
- ✅ Change le JWT secret si tu l'utilises
- ✅ N'expose JAMAIS le fichier .env

---

## 📊 Monitoring

### Commandes PM2 utiles

```bash
# Voir les logs en temps réel
pm2 logs fresq-v2

# Voir le statut
pm2 status

# Redémarrer l'app
pm2 restart fresq-v2

# Arrêter l'app
pm2 stop fresq-v2

# Voir les métriques
pm2 monit
```

### Logs Nginx

```bash
# Logs d'accès
sudo tail -f /var/log/nginx/access.log

# Logs d'erreur
sudo tail -f /var/log/nginx/error.log
```

---

## 🔄 Mise à jour du code

```bash
# Pull les dernières modifications
cd /var/www/fresq-v2
sudo git pull

# Installer nouvelles dépendances si besoin
cd server
sudo npm install

# Redémarrer l'application
pm2 restart fresq-v2
```

---

## ⚡ Optimisations Production

### 1. Cache statique Nginx

Ajoute dans le bloc `server` de Nginx:

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 2. Compression Gzip

```nginx
gzip on;
gzip_vary on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
```

### 3. Limites de connexion

```nginx
# Protection contre les attaques DDoS
limit_req_zone $binary_remote_addr zone=limitbyaddr:10m rate=10r/s;
limit_req zone=limitbyaddr burst=20;
```

---

## 🧪 Tests Post-Déploiement

1. ✅ Interface principale accessible: `https://votre-domaine.com`
2. ✅ Admin accessible: `https://votre-domaine.com/admin.html`
3. ✅ WebSockets fonctionnent (peinture en temps réel)
4. ✅ HTTPS actif et certificat valide
5. ✅ Authentification admin fonctionne
6. ✅ API packs accessible
7. ✅ Base de données connectée

---

## 🆘 Dépannage

### L'app ne démarre pas
```bash
pm2 logs fresq-v2 --err
```

### Erreur de connexion DB
- Vérifier DATABASE_URL dans .env
- Vérifier que l'IP du serveur est autorisée dans Supabase

### 502 Bad Gateway
```bash
# Vérifier que PM2 tourne
pm2 status

# Vérifier les logs Nginx
sudo tail -f /var/log/nginx/error.log
```

---

## 📝 Checklist de Déploiement

- [ ] Serveur préparé (Node.js, PM2, Nginx)
- [ ] Code uploadé/cloné
- [ ] .env configuré avec DATABASE_URL production
- [ ] NODE_ENV=production dans .env
- [ ] Bypass auth dev SUPPRIMÉ dans index.js
- [ ] Admin créé dans Supabase
- [ ] PM2 lancé et configuré pour auto-start
- [ ] Nginx configuré et rechargé
- [ ] SSL/HTTPS activé avec Certbot
- [ ] Firewall configuré
- [ ] Tests post-déploiement réussis
- [ ] Cache buster incrémenté (v=4 pour première prod)

---

## 🎯 Après le déploiement

1. **Backup automatique Supabase**
   - Configure les backups dans Supabase Dashboard

2. **Monitoring**
   - Configure des alertes PM2
   - Surveille les logs régulièrement

3. **Mises à jour**
   - Met à jour Node.js et dépendances régulièrement
   - Renouvellement SSL automatique (Certbot le fait)

4. **Performance**
   - Surveille PM2 monit pour l'usage mémoire/CPU
   - Ajuste les ressources si nécessaire
