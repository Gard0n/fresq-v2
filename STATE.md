# FRESQ V2 - État Actuel du Projet ✅

**Dernière mise à jour:** 2026-01-31
**Version:** V2.0 Commercial Ready

---

## 📋 Vue d'Ensemble

FRESQ V2 est une fresque collaborative en temps réel avec système de loterie commercial intégré.

### Fonctionnalités Principales
- ✅ Grille collaborative 200×200 (40,000 cases) - évolutive jusqu'à 1414×1414 (2M cases)
- ✅ Système de codes uniques (1 code = 1 case)
- ✅ Synchronisation temps réel (WebSocket)
- ✅ Système de paliers (10 tiers) avec expansion automatique
- ✅ Gestion des tickets/ventes (mode test/manuel)
- ✅ Loterie avec tirages au sort
- ✅ Programme de parrainage
- ✅ Dashboard admin complet

---

## 🏗️ Architecture

### Backend (Node.js + Express)
```
server/
├── index.js                 # API routes & WebSocket
├── db.js                    # PostgreSQL connection pool
├── utils.js                 # Code generation & normalization
└── services/
    ├── tierService.js       # Gestion paliers & expansion grille
    ├── ticketService.js     # Gestion tickets/ventes
    ├── lotteryService.js    # Tirages au sort & gains
    └── referralService.js   # Système de parrainage
```

### Frontend (Vanilla JS + HTML5 Canvas)
```
public/
├── index.html               # Page principale fresque + widget loterie
├── admin.html              # Dashboard admin (4 onglets)
├── app.js                  # Canvas, zoom, paint, WebSocket
└── admin.js                # Interface admin
```

### Base de Données (PostgreSQL via Supabase)
```sql
Tables principales:
- users              # Utilisateurs (email)
- codes              # Codes uniques (cell_x, cell_y, color, user_id)
- config             # Configuration grille (grid_width, grid_height, palette)
- tiers              # Paliers (dimensions, seuils, prix)
- tickets            # Ventes (order_id, status, amount, tier_id, code_id)
- prizes             # Gains/loterie (tier_id, winner_ticket_id, status, amount)
- referrals          # Parrainages (referrer_user_id, referred_email, status)
```

---

## ✅ Fonctionnalités Implémentées

### 🎨 Fresque Collaborative
- Login par email (sans password)
- Claim de codes (format ABC-12345)
- Sélection position sur grille
- Peinture (10 couleurs configurables)
- Zoom & Pan (molette + drag)
- Minimap de navigation
- Loupe magnifier
- Thème dark/light

### 💰 Système Commercial (Test Mode)
- **10 paliers progressifs** (Tier 0→9)
  - Palier 0: 200×200 (40k cases) → gain 10,000€
  - Palier 9: 1414×1414 (2M cases) → gain 400,000€
- **Tickets/Ventes** (manuel pour test)
  - Création ticket → status: pending
  - Confirmation paiement → génération code automatique
  - Système de remboursement (bloqué si case peinte/sélectionnée)
- **Expansion automatique**
  - Quand seuil tickets atteint → upgrade tier
  - Anciennes cases restent centrées
  - Nouvelles cases ajoutées autour
  - Broadcast WebSocket automatique
- **Loterie équitable**
  - 1 ticket = 1 chance (SQL ORDER BY RANDOM())
  - Workflow: pending → drawn → claimed → paid
  - Plusieurs types: principal, secondaire, quotidien
- **Parrainage**
  - User A parraine User B par email
  - Premier achat de B → code gratuit pour A
  - Tracking complet (pending → completed → claimed)

### 🖥️ Dashboard Admin
**4 Onglets:**

1. **Gestion** (existant)
   - Stats en temps réel
   - Gestion codes/users
   - Nettoyage cases

2. **Commercial** (nouveau)
   - Stats: palier actuel, tickets vendus, revenus
   - Progression vers prochain palier
   - Création/confirmation tickets
   - Tableau tickets récents avec actions

3. **Loterie** (nouveau)
   - Stats gains (pending/drawn/claimed/paid)
   - Création tirages
   - Liste gains à tirer
   - Tirage au sort manuel
   - Gestion statuts (réclamé/payé)

4. **Parrainages** (nouveau)
   - Stats globales (actifs/réussis)
   - Top parrains (leaderboard)
   - Tableau complet parrainages

### 🎰 Widget Loterie (Public)
- Affichage compact une ligne
- Infos temps réel:
  - Palier actuel
  - Tickets vendus/total + progression %
  - Gain principal
  - Nombre total de cases
- Mise à jour auto via WebSocket

---

## 🔌 API Routes

### Public
```
GET  /api/config                    # Config grille
GET  /api/grid/state                # État complet grille
GET  /api/cell/:x/:y                # Détails cellule
GET  /api/tiers                     # Liste paliers
GET  /api/tier/current              # Palier actuel
GET  /api/tier/progress             # Progression
POST /api/user/login                # Login email
POST /api/user/claim-code           # Claim code
POST /api/cell/claim                # Claim position
POST /api/cell/paint                # Peindre case
POST /api/ticket/create             # Créer ticket (test)
```

### Admin (Authentication Required)
```
POST /api/admin/code/generate       # Générer codes
POST /api/admin/code/bulk           # Générer en masse
GET  /api/admin/stats               # Statistiques admin
POST /api/admin/cells/clear         # Nettoyer cases
POST /api/admin/config/palette      # MAJ palette

POST /api/admin/ticket/:id/confirm  # Confirmer paiement
POST /api/admin/ticket/:id/cancel   # Annuler/rembourser
POST /api/admin/tickets/bulk        # Création en masse

POST /api/admin/prize/create        # Créer gain
POST /api/admin/prize/:id/draw      # Tirer au sort
POST /api/admin/prize/:id/claim     # Marquer réclamé
POST /api/admin/prize/:id/pay       # Marquer payé
GET  /api/admin/prizes              # Tous les gains

GET  /api/admin/referrals           # Tous les parrainages
```

---

## 🔧 Configuration & Déploiement

### Variables d'Environnement (.env)
```bash
PORT=3001
ADMIN_PASSWORD=your_admin_password_here

# Supabase PostgreSQL
DB_HOST=aws-0-eu-central-1.pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres.xxxxx
DB_PASSWORD=your_supabase_password
```

### Déploiement (Render.com)
- **Service:** Web Service
- **Build:** `npm install`
- **Start:** `npm start`
- **Auto-deploy:** Activé sur push `main` branch
- **URL:** https://fresq-v2.onrender.com

### Base de Données (Supabase)
- **Migration commerciale:** `server/migration_commercial.sql` (✅ exécuté)
- **Indexes:** Optimisés pour performances
- **Connection pooling:** pg-pool configuré

---

## 🐛 Bugs Corrigés Récemment

### ✅ Colonne `claimed_at` inexistante
**Fichiers:** `ticketService.js`, `referralService.js`
**Problème:** INSERT INTO codes avec colonne claimed_at qui n'existe pas dans le schéma
**Fix:** Suppression de claimed_at des INSERT statements
**Impact:** Confirmation tickets et complétion parrainages fonctionnels

### ✅ Refund blocking rules
**Fichier:** `ticketService.js:250-259`
**Règles implémentées:**
- Blocage si case peinte (color !== null)
- Blocage si case sélectionnée (cell_x/y !== null)
- Autorisation si code non utilisé

---

## 📊 Métriques & Performance

### Caching
- Config: 60s TTL (invalidé sur MAJ palette/tier)
- Grid state: 30s TTL (invalidé sur paint)
- Cleanup auto toutes les minutes

### Rate Limiting
- Login: 10 req/min
- Claim code: 20 req/min
- Paint: 30 req/min
- Ticket creation: 5 req/min

### Logging & Analytics
- Événements trackés en mémoire (1000 derniers)
- Logs colorés par niveau (error, warn, info, debug)
- Tracking commercial (tickets, prizes, referrals)

---

## 🎯 Prochaines Étapes

**Voir:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

### Haute Priorité
1. **Système de Packs** (bonus tickets)
   - Pack Solo: 2€ → 1 ticket
   - Pack Mini: 10€ → 6 tickets (1 bonus)
   - Pack Medium: 20€ → 12 tickets (2 bonus)
   - Pack Mega: 100€ → 55 tickets (5 bonus)
   - Pack Ultra: 200€ → 110 tickets (10 bonus)

2. **Deadline Globale** (6 mois)
   - Table campaign
   - Cron job auto-tirage à deadline
   - Affichage temps restant

3. **Auto-complétion Parrainages**
   - Trigger automatique au 1er achat parrainé

### Moyenne Priorité
- Page publique d'achat
- Intégration Stripe
- Emails de confirmation
- Notifications push

---

## 📖 Documentation

- [COMMERCIAL_IMPLEMENTATION.md](COMMERCIAL_IMPLEMENTATION.md) - Documentation complète système commercial
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) - Plan implémentation packs & deadline
- [NEXT_STEPS.md](NEXT_STEPS.md) - Roadmap détaillée
- [TESTS_CHECKLIST.md](TESTS_CHECKLIST.md) - 64 tests à effectuer
- [DEPLOY.md](DEPLOY.md) - Guide déploiement
- [MIGRATION_INSTRUCTIONS.md](MIGRATION_INSTRUCTIONS.md) - Instructions migration DB

---

## 🛠️ Scripts NPM

```bash
npm start          # Production (node server/index.js)
npm run dev        # Développement (nodemon)
npm test           # Tests (à implémenter)
```

---

## 🔐 Sécurité

### Validations
- ✅ Email RFC 5322 compliant
- ✅ Coordinates bounds checking
- ✅ Color index validation (0-9)
- ✅ Montant > 0
- ✅ Tier/Prize existence checks
- ✅ Double-confirm prevention
- ✅ Self-referral prevention

### Transactions PostgreSQL
Toutes les opérations critiques utilisent BEGIN/COMMIT/ROLLBACK

### CORS
- Production: `https://fresq-v2.onrender.com`
- Dev: `http://localhost:3001`

---

## 📦 Dépendances Principales

```json
{
  "express": "^4.21.2",
  "socket.io": "^4.8.1",
  "pg": "^8.13.1",
  "pg-pool": "^3.7.0",
  "bcryptjs": "^2.4.3",
  "dotenv": "^16.4.7"
}
```

---

## ✅ État du Code

### Services Backend
- ✅ Bien structurés avec JSDoc
- ✅ Gestion d'erreurs cohérente
- ✅ Logging uniforme
- ✅ Pas de code dupliqué
- ✅ Transactions PostgreSQL

### Routes API
- ✅ Organisation claire par sections
- ✅ Rate limiting approprié
- ✅ Validation inputs
- ✅ Error handling

### Frontend
- ✅ Canvas optimisé
- ✅ WebSocket stable
- ✅ Responsive design
- ✅ UX/UI soignée

---

**🎉 Projet prêt pour tests et ajout des fonctionnalités packs + deadline!**
