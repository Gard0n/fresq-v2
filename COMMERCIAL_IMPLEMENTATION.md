# FRESQ V2 - Implémentation Commerciale ✅

## 📋 Vue d'Ensemble

Implémentation complète du système commercial pour FRESQ V2, incluant :
- ✅ Système de paliers (tiers)
- ✅ Gestion des tickets (ventes)
- ✅ Système de loterie/gains
- ✅ Programme de parrainage
- ✅ Dashboard admin enrichi

**Mode actuel:** Test/Manuel (sans intégration de paiement)

---

## 🗂️ Architecture

### Services Backend (`server/services/`)

#### 1. **tierService.js** - Gestion des Paliers
```javascript
- getCurrentTier(client)          // Palier actuel basé sur tickets vendus
- checkTierUpgrade(client, tier)  // Vérifier si upgrade nécessaire
- upgradeTier(client, newTier)    // Effectuer l'upgrade
- expandGrid(client, old, new)    // Agrandir la grille (cases anciennes centrées)
- getTierProgress(client)         // Progression vers palier suivant
- getAllTiers(client)             // Liste de tous les paliers
```

**Logique d'expansion:**
- Anciennes cases restent au centre
- Nouvelles cases ajoutées autour
- Dimensions grille mises à jour automatiquement
- WebSocket broadcast du changement de palier

#### 2. **ticketService.js** - Gestion des Tickets
```javascript
- createTicket(client, params)           // Créer un nouveau ticket
- confirmTicketPayment(client, orderId)  // Confirmer paiement + générer code
- getTicketByOrderId(client, orderId)    // Détails d'un ticket
- getUserTickets(client, email)          // Tickets d'un utilisateur
- cancelTicket(client, orderId)          // Annuler/rembourser
- getTicketStats(client)                 // Statistiques globales
- bulkCreateTickets(client, tickets)     // Création en masse (test)
```

**Workflow:**
1. Admin crée ticket manuellement → status: `pending`
2. Admin confirme paiement → status: `paid`, code généré
3. Vérification auto de tier upgrade
4. WebSocket broadcast si tier change

#### 3. **lotteryService.js** - Loterie & Gains
```javascript
- createPrizeDraw(client, params)    // Créer un tirage
- drawPrize(client, prizeId)         // Tirer au sort (ORDER BY RANDOM())
- getPrizeById(client, prizeId)      // Détails d'un gain
- getTierPrizes(client, tierId)      // Gains d'un palier
- getPendingPrizes(client)           // Gains en attente de tirage
- markPrizeAsClaimed(client, id)     // Marquer comme réclamé
- markPrizeAsPaid(client, id)        // Marquer comme payé
- getUserPrizes(client, email)       // Gains d'un utilisateur
- autoDrawPendingPrizes(client)      // Auto-tirage (si draw_date passée)
```

**Statuts des gains:**
- `pending` → En attente de tirage
- `drawn` → Tiré au sort, gagnant désigné
- `claimed` → Gagnant a réclamé son gain
- `paid` → Gain payé au gagnant

#### 4. **referralService.js** - Parrainage
```javascript
- createReferral(client, userId, email)      // Créer un parrainage
- completeReferral(client, referredEmail)    // Compléter (1er achat parrainé)
- getReferralsByUser(client, userId)         // Parrainages d'un user
- checkReferralEligibility(client, email)    // Vérifier éligibilité
- getTopReferrers(client, limit)             // Leaderboard parrains
- getAllReferrals(client, page, limit)       // Admin: tous les parrainages
```

**Workflow:**
1. User A parraine User B (par email)
2. User B fait son premier achat → parrainage complété
3. Code gratuit généré automatiquement pour User A
4. Status: `pending` → `completed` → `claimed`

---

## 🔌 API Routes

### Public - Tiers
```
GET  /api/tiers              # Liste de tous les paliers
GET  /api/tier/current       # Palier actuel
GET  /api/tier/progress      # Progression vers prochain palier
```

### Public - Tickets
```
POST /api/ticket/create      # Créer ticket (manuel, pour test)
GET  /api/ticket/:orderId    # Détails d'un ticket
GET  /api/user/tickets?email # Tickets d'un utilisateur
```

### Admin - Tickets
```
POST /api/admin/ticket/:orderId/confirm  # Confirmer paiement
POST /api/admin/ticket/:orderId/cancel   # Annuler/rembourser
GET  /api/admin/tickets                  # Liste + stats
POST /api/admin/tickets/bulk             # Création en masse
```

### Admin - Loterie
```
POST /api/admin/prize/create            # Créer un gain
POST /api/admin/prize/:id/draw          # Tirer au sort
POST /api/admin/prize/:id/claim         # Marquer réclamé
POST /api/admin/prize/:id/pay           # Marquer payé
GET  /api/admin/prize/:id               # Détails
GET  /api/admin/prizes                  # Tous les gains
GET  /api/admin/prizes/pending          # Gains en attente
```

### Public/Admin - Parrainages
```
POST /api/referral/create               # Créer parrainage
GET  /api/referral/check?email          # Vérifier éligibilité
GET  /api/user/:userId/referrals        # Parrainages d'un user
GET  /api/admin/referrals               # Admin: tous + stats
```

---

## 🖥️ Admin Dashboard

### Nouveaux Onglets

#### 💰 Commercial
- **Stats en temps réel:**
  - Palier actuel + dimensions grille
  - Tickets vendus / en attente
  - Revenus totaux
  - Progression vers prochain palier
- **Créer un ticket:**
  - Email client
  - Montant (défaut: 2.00€)
  - Bouton "Créer Ticket"
- **Tableau tickets récents:**
  - Order ID, email, montant, status
  - Actions: Confirmer / Annuler

#### 🎰 Loterie
- **Stats gains:**
  - En attente, tirés, réclamés, payés
  - Total distribué
- **Créer un tirage:**
  - Sélection palier
  - Nom du gain (optionnel)
  - Montant (défaut: montant du palier)
  - Type: Principal / Secondaire / Quotidien
- **Gains à tirer:**
  - Liste des gains pending
  - Bouton "Tirer au sort" pour chaque
- **Tous les gains:**
  - Tableau complet avec statuts
  - Actions: Tirer / Marquer réclamé / Marquer payé

#### 🤝 Parrainages
- **Stats:**
  - Actifs / Réussis / Total
  - Nombre de parrains actifs
- **Top Parrains:**
  - Leaderboard des meilleurs parrains
  - Parrainages réussis / Total
- **Tous les parrainages:**
  - Tableau avec statuts
  - Email parrain / parrainé
  - Code gratuit généré
  - Dates

---

## 📊 Base de Données

### Nouvelles Tables

#### `tiers` - Paliers
```sql
- id, tier_number (0-9)
- min_tickets, max_tickets      # Seuils
- grid_width, grid_height        # Dimensions
- total_cells                    # Calculé
- prize_amount                   # Gain principal
- is_active, created_at
```

**Données initiales:** 10 paliers (0→9)
- Palier 0: 200×200 (40k cells) → 10,000€
- Palier 9: 1414×1414 (2M cells) → 400,000€

#### `tickets` - Achats
```sql
- id, order_id (unique)
- payment_provider, payment_session_id
- email, user_id
- code_id (FK codes)           # Code généré
- amount, status                # 2.00€, pending/paid/refunded
- tier_id (FK tiers)            # Palier au moment d'achat
- created_at, paid_at, refunded_at
```

#### `prizes` - Gains
```sql
- id, tier_id (FK tiers)
- name, amount, prize_type      # Principal/Secondaire/Quotidien
- draw_date                      # Date du tirage
- winner_ticket_id (FK tickets)  # Ticket gagnant
- status                         # pending/drawn/claimed/paid
- created_at
```

#### `referrals` - Parrainages
```sql
- id
- referrer_user_id (FK users)   # Celui qui parraine
- referred_email                 # Email parrainé
- referred_user_id (FK users)    # User créé
- free_ticket_code_id (FK codes) # Code gratuit
- status                         # pending/completed/claimed
- created_at, completed_at
```

### Indexes Créés
```sql
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_email ON tickets(email);
CREATE INDEX idx_tickets_tier_id ON tickets(tier_id);
CREATE INDEX idx_prizes_tier_id ON prizes(tier_id);
CREATE INDEX idx_prizes_status ON prizes(status);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id);
```

---

## 🚀 Utilisation (Mode Test)

### 1. Exécuter la Migration
```bash
# Dans Supabase SQL Editor
# Copier-coller le contenu de: server/migration_commercial.sql
```

### 2. Créer un Ticket
```bash
# Via Admin Dashboard → Commercial
1. Entrer email: test@example.com
2. Montant: 2.00€
3. Cliquer "Créer Ticket"
4. Noter l'Order ID
```

### 3. Confirmer le Paiement
```bash
# Dans tableau tickets récents
1. Trouver le ticket (status: pending)
2. Cliquer "✓ Confirmer"
3. Code généré automatiquement
4. Vérifier si tier upgrade (WebSocket)
```

### 4. Créer un Gain
```bash
# Via Admin Dashboard → Loterie
1. Sélectionner palier (ex: Palier 0)
2. Nom: "Gain Principal Palier 0" (optionnel)
3. Montant: laissé vide = montant du palier (10,000€)
4. Type: Principal
5. Cliquer "Créer Gain"
```

### 5. Tirer un Gain
```bash
# Dans "Gains à tirer"
1. Trouver le gain (status: pending)
2. Cliquer "🎲 Tirer au sort"
3. Algorithme: SELECT ... ORDER BY RANDOM() LIMIT 1
4. Gagnant affiché avec email + code
5. Status → drawn
```

### 6. Gérer un Parrainage
```bash
# Via API (pour l'instant)
POST /api/referral/create
{
  "userId": 1,
  "referredEmail": "nouveau@example.com"
}

# Quand nouveau@example.com achète son 1er ticket
# → Parrainage auto-complété
# → Code gratuit généré pour userId 1
```

---

## 🎯 Workflows Complets

### Workflow 1: Achat Ticket → Tier Upgrade
```
1. Admin crée ticket (email, 2€)
2. Status: pending, tier_id: palier actuel
3. Admin confirme paiement
   → Ticket: status = paid
   → Code généré et associé
   → checkTierUpgrade()
   → Si seuil atteint:
     - expandGrid() (décale anciennes cases)
     - config.grid_w/h mis à jour
     - WebSocket broadcast 'tier_upgrade'
     - Cache config invalidé
4. Frontend reçoit event → reload grille
```

### Workflow 2: Loterie Complète
```
1. Admin crée gain (tierId=1, 10k€, type=main)
2. Status: pending
3. Admin clique "Tirer"
   → drawPrize()
   → SELECT FROM tickets WHERE tier_id=1 AND status='paid' ORDER BY RANDOM() LIMIT 1
   → winner_ticket_id = résultat
   → Status: drawn
   → WebSocket broadcast 'prize_drawn'
4. Gagnant contacté
5. Admin: "Marquer réclamé" → status: claimed
6. Admin paie le gain → "Marquer payé" → status: paid
```

### Workflow 3: Parrainage
```
1. User A (id=5) parraine User B (email)
   → createReferral(5, "userB@test.com")
   → Status: pending
2. User B s'inscrit et achète 1er ticket
   → Ticket confirmé (paid)
   → completeReferral("userB@test.com")
   → Code gratuit généré pour User A
   → Status: completed
3. User A reçoit notification (à implémenter)
4. User A utilise son code → Status: claimed
```

---

## 🔐 Sécurité & Validation

### Validations Implémentées
- ✅ Email validation (RFC 5322)
- ✅ Montant > 0
- ✅ Tier existence check
- ✅ Ticket status checks (prevent double-confirm)
- ✅ Prize status progression (pending→drawn→claimed→paid)
- ✅ Referral eligibility (no self-referral, already customer check)
- ✅ Rate limiting sur routes publiques
- ✅ Admin authentication required

### Transactions
Toutes les opérations critiques utilisent des transactions PostgreSQL:
```javascript
await client.query('BEGIN');
try {
  // Operations...
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
}
```

---

## 📈 Prochaines Étapes

### Phase 2: Intégration Paiement (Optionnel)
- [ ] Intégrer Stripe / PayPal / Alternative
- [ ] Webhook handlers pour confirmations auto
- [ ] Page d'achat publique
- [ ] Emails de confirmation

### Phase 3: Améliorations
- [ ] Notifications (email, push)
- [ ] Page publique de tracking de palier
- [ ] Historique des tirages
- [ ] Exports comptables (CSV)
- [ ] Statistiques avancées (revenus par période, etc.)
- [ ] Auto-tirage scheduler (cron pour draw_date)

### Phase 4: Frontend Public
- [ ] Page d'achat `/buy.html`
- [ ] Page de tracking tier `/progress.html`
- [ ] Interface parrainage utilisateur
- [ ] Historique personnel (mes tickets, mes gains)

---

## 🧪 Tests Recommandés

### Tests Manuels à Effectuer
1. **Tickets:**
   - [ ] Créer ticket → vérifier pending
   - [ ] Confirmer ticket → vérifier code généré
   - [ ] Annuler ticket paid → vérifier code supprimé si non utilisé
   - [ ] Créer 20,000 tickets → vérifier tier upgrade (0→1)

2. **Loterie:**
   - [ ] Créer gain pour palier sans tickets → vérifier erreur au tirage
   - [ ] Créer gain avec tickets → tirer → vérifier winner
   - [ ] Vérifier statuts progression (drawn→claimed→paid)

3. **Parrainages:**
   - [ ] Créer parrainage → vérifier pending
   - [ ] Parrainé achète → vérifier completed + code gratuit
   - [ ] Tenter auto-parrainage → vérifier erreur
   - [ ] Tenter double-parrainage → vérifier erreur

4. **Tier Expansion:**
   - [ ] Peindre cases en 200×200
   - [ ] Upgrade tier 0→1 (283×283)
   - [ ] Vérifier anciennes cases centrées
   - [ ] Vérifier nouvelles cases disponibles autour

---

## 📝 Notes Techniques

### Cache Invalidation
- Config cache invalidé lors de tier upgrade
- Permet refresh auto des dimensions grille

### WebSocket Events
```javascript
// Tier upgrade
io.emit('tier_upgrade', {
  oldTier, newTier, expansion
});

// Prize drawn
io.emit('prize_drawn', {
  prizeId, prizeName, tierNumber
});
```

### Logging
Tous les événements importants sont trackés:
```javascript
trackEvent('ticket', 'confirmed', orderId);
trackEvent('prize', 'drawn', prizeName, amount);
trackEvent('referral', 'created', email);
```

---

## 🎉 Résumé

**Implémentation complète du système commercial en mode test/manuel.**

✅ **4 services backend** (600+ lignes)
✅ **25+ API routes** fonctionnelles
✅ **3 nouveaux onglets admin** avec interfaces complètes
✅ **4 nouvelles tables** + indexes
✅ **WebSocket events** pour mises à jour temps réel
✅ **Système de paliers dynamique** avec expansion de grille
✅ **Loterie équitable** (random SQL)
✅ **Programme de parrainage** automatisé

**Prêt pour tests et démonstration!**

---

**Dernière mise à jour:** 2026-01-31
**Version:** Commercial V1.0 (Test Mode)
