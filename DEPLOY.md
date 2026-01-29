# 🚀 Guide de Déploiement FRESQ V2

Ce guide explique comment déployer FRESQ V2 sur un serveur en production.

## Option 1 : Déploiement sur Render (Recommandé)

### Étape 1 : Préparer le dépôt Git

```bash
cd /Users/grdn/Desktop/Perso/Perso/Code/FRESQ-V2
git init
git add .
git commit -m "Initial commit - FRESQ V2"
```

### Étape 2 : Pousser sur GitHub

1. Créer un nouveau repo sur GitHub : https://github.com/new
2. Pousser le code :

```bash
git remote add origin https://github.com/TON-USERNAME/fresq-v2.git
git branch -M main
git push -u origin main
```

### Étape 3 : Déployer sur Render

1. Aller sur https://render.com et se connecter avec GitHub
2. Cliquer sur "New +" → "Web Service"
3. Connecter votre repo GitHub `fresq-v2`
4. Render détectera automatiquement le `render.yaml`
5. Ajouter les variables d'environnement :
   - `DATABASE_URL` : Votre URL Supabase (depuis .env)
   - `DATABASE_SSL` : `true`
   - `ADMIN_SEEDS` : (optionnel, copier depuis .env)
6. Cliquer sur "Create Web Service"

✅ Votre app sera accessible sur `https://fresq-v2.onrender.com` (ou nom similaire)

---

## Option 2 : Déploiement sur Railway

### Étape 1 : Installer Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### Étape 2 : Déployer

```bash
cd /Users/grdn/Desktop/Perso/Perso/Code/FRESQ-V2
railway init
railway up
```

### Étape 3 : Configurer les variables d'environnement

```bash
railway variables set DATABASE_URL="postgresql://..."
railway variables set DATABASE_SSL=true
```

✅ Votre app sera accessible sur l'URL fournie par Railway

---

## Option 3 : Déploiement sur Fly.io

### Étape 1 : Installer flyctl

```bash
brew install flyctl  # macOS
flyctl auth login
```

### Étape 2 : Créer l'app

```bash
cd /Users/grdn/Desktop/Perso/Perso/Code/FRESQ-V2
flyctl launch
```

### Étape 3 : Configurer les secrets

```bash
flyctl secrets set DATABASE_URL="postgresql://..."
flyctl secrets set DATABASE_SSL=true
```

### Étape 4 : Déployer

```bash
flyctl deploy
```

---

## Variables d'environnement requises

Assurez-vous de configurer ces variables sur votre plateforme de déploiement :

- `DATABASE_URL` : URL PostgreSQL de Supabase
- `DATABASE_SSL` : `true`
- `PORT` : (automatique sur la plupart des plateformes)
- `ADMIN_SEEDS` : (optionnel) JSON array des admins initiaux

---

## Tester avec plusieurs utilisateurs

Une fois déployé :

1. Ouvrir l'URL de production dans plusieurs navigateurs/appareils
2. Générer des codes via l'admin panel : `https://ton-url.com/admin.html`
3. Distribuer les codes aux utilisateurs
4. Chaque utilisateur peut maintenant peindre sa case
5. Les changements sont synchronisés toutes les 5 secondes

---

## Troubleshooting

### Erreur de connexion à la base de données

Vérifier que :
- `DATABASE_URL` est correctement configuré
- `DATABASE_SSL=true` est défini
- Les tables existent dans Supabase (voir `server/schema.sql`)

### Port déjà utilisé en local

```bash
lsof -ti:3001 | xargs kill -9
```

### Recréer les tables

Exécuter le script SQL depuis Supabase :

```sql
-- Voir server/schema.sql pour le schéma complet
```
