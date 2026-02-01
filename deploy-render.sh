#!/bin/bash

echo "🚀 FRESQ V2 - Préparation déploiement Render"
echo "============================================="
echo ""

# 1. Vérifier Git
if [ ! -d ".git" ]; then
    echo "📦 Initialisation Git..."
    git init
    git add .
    git commit -m "FRESQ V2 - Initial commit for Render deployment"
else
    echo "✅ Git déjà initialisé"
fi

# 2. Vérifier bypass auth supprimé
if grep -q "Bypass auth in development" server/index.js; then
    echo "❌ ERREUR: Bypass auth dev toujours présent!"
    echo "   Le bypass a été supprimé. Commit les changements."
else
    echo "✅ Bypass auth dev supprimé (sécurité OK)"
fi

# 3. Vérifier NODE_ENV
if grep -q "NODE_ENV.*production" server/.env 2>/dev/null; then
    echo "⚠️  ATTENTION: NODE_ENV=production dans .env local"
    echo "   Pense à le configurer dans Render Environment Variables"
fi

echo ""
echo "📋 Checklist Render:"
echo "===================="
echo ""
echo "1. [ ] Créer un repo GitHub"
echo "2. [ ] Push le code:"
echo "       git remote add origin https://github.com/TON-USERNAME/fresq-v2.git"
echo "       git push -u origin main"
echo ""
echo "3. [ ] Sur Render (dashboard.render.com):"
echo "       - New + → Web Service"
echo "       - Connecter ton repo GitHub"
echo ""
echo "4. [ ] Configuration Render:"
echo "       Build Command: cd server && npm install"
echo "       Start Command: cd server && node index.js"
echo ""
echo "5. [ ] Variables d'environnement (Environment):"
echo "       NODE_ENV=production"
echo "       PORT=3000"
echo "       DATABASE_URL=postgresql://postgres:PASSWORD@db.fgzbljzvrbfcyoicvsuu.supabase.co:5432/postgres"
echo "       DATABASE_SSL=true"
echo ""
echo "6. [ ] Créer un admin dans Supabase:"
echo "       Exécute le SQL dans Supabase SQL Editor"
echo ""
echo "📖 Guide complet: DEPLOIEMENT_RENDER.md"
echo ""
