# FRESQ V2 - Checklist de Tests Complets

## 🎯 Objectif
Valider l'intégralité du système commercial avant d'ajouter packs et deadlines.

**URL Admin:** https://fresq-v2.onrender.com/admin.html

---

## ✅ Pré-requis

- [ ] Migration SQL exécutée dans Supabase
- [ ] Code pushé et déployé sur Render
- [ ] Admin dashboard accessible
- [ ] 3 nouveaux onglets visibles (💰 Commercial, 🎰 Loterie, 🤝 Parrainages)

---

## 📊 SECTION 1: Tiers (Paliers)

### Test 1.1: Vérifier Paliers en DB
```bash
# Dans Supabase SQL Editor
SELECT tier_number, min_tickets, max_tickets, grid_width, grid_height, prize_amount
FROM tiers
ORDER BY tier_number;
```

**Résultat attendu:**
```
tier_number | min_tickets | max_tickets | grid_width | grid_height | prize_amount
------------|-------------|-------------|------------|-------------|-------------
0           | 0           | 20000       | 200        | 200         | 10000
1           | 20000       | 40000       | 283        | 283         | 10000
...
9           | 800000      | 1000000     | 1414       | 1414        | 400000
```
- [ ] ✅ 10 paliers créés
- [ ] ✅ Données correctes

### Test 1.2: API Publiques Tiers
```bash
# Tous les paliers
curl https://fresq-v2.onrender.com/api/tiers

# Palier actuel
curl https://fresq-v2.onrender.com/api/tier/current

# Progression
curl https://fresq-v2.onrender.com/api/tier/progress
```

**Résultat attendu:**
- [ ] ✅ `/api/tiers` retourne 10 paliers
- [ ] ✅ `/api/tier/current` retourne Palier 0
- [ ] ✅ `/api/tier/progress` retourne `{ ticketsSold: 0, progress: 0, ... }`

### Test 1.3: Admin Dashboard - Stats Palier
**Action:** Onglet 💰 Commercial

**Vérifier:**
- [ ] ✅ Palier Actuel: **Palier 0**
- [ ] ✅ Dimensions: **200×200**
- [ ] ✅ Tickets Vendus: **0**
- [ ] ✅ Progression: **0%**
- [ ] ✅ Prochain palier: **Palier 1 (20000 tickets)**

---

## 🎫 SECTION 2: Tickets (Achats)

### Test 2.1: Créer Ticket Pending
**Action:** Admin Dashboard → 💰 Commercial

1. Email: `test1@example.com`
2. Montant: `2.00`
3. Cliquer **"➕ Créer Ticket"**

**Vérifier:**
- [ ] ✅ Message de succès
- [ ] ✅ Order ID affiché (ex: `ORDER-1738350000-ABC123`)
- [ ] ✅ Ticket apparaît dans tableau avec status **pending**

**Vérifier en DB:**
```sql
SELECT order_id, email, amount, status, tier_id, code_id
FROM tickets
WHERE order_id = 'ORDER-XXX';
```

- [ ] ✅ status = `'pending'`
- [ ] ✅ tier_id = `1` (Palier 0)
- [ ] ✅ code_id = `NULL` (code pas encore généré)
- [ ] ✅ amount = `2.00`

### Test 2.2: Confirmer Paiement → Génération Code
**Action:** Cliquer **"✓ Confirmer"** sur le ticket

**Vérifier:**
- [ ] ✅ Popup: "Ticket confirmé! Code généré: ABC-12345"
- [ ] ✅ Ticket status → **paid**
- [ ] ✅ Code affiché dans tableau

**Vérifier en DB:**
```sql
SELECT t.order_id, t.status, t.code_id, c.code, c.user_id
FROM tickets t
JOIN codes c ON t.code_id = c.id
WHERE t.order_id = 'ORDER-XXX';
```

- [ ] ✅ ticket.status = `'paid'`
- [ ] ✅ ticket.code_id = `<ID du code>`
- [ ] ✅ code généré (format `ABC-12345`)
- [ ] ✅ code.user_id = user_id du ticket

### Test 2.3: Créer Plusieurs Tickets
**Action:** Créer 5 tickets pour différents emails

```
test2@example.com - 2.00€
test3@example.com - 2.00€
test4@example.com - 2.00€
test5@example.com - 2.00€
test6@example.com - 2.00€
```

**Confirmer tous les tickets**

**Vérifier:**
- [ ] ✅ 5 codes générés (différents)
- [ ] ✅ Stats mises à jour: **Tickets Vendus: 6** (1 + 5)
- [ ] ✅ Progression: **0.03%** (6/20000)

### Test 2.4: Tenter Double Confirmation
**Action:** Cliquer "✓ Confirmer" sur un ticket déjà paid

**Résultat attendu:**
- [ ] ✅ Erreur: "Ticket already paid"
- [ ] ✅ Aucun nouveau code généré

### Test 2.5: API Get User Tickets
```bash
curl "https://fresq-v2.onrender.com/api/user/tickets?email=test1@example.com"
```

**Résultat attendu:**
- [ ] ✅ Retourne 1 ticket
- [ ] ✅ Avec code associé

---

## 🚫 SECTION 3: Remboursements (Nouvelles Règles)

### Test 3.1: Remboursement Code Non Utilisé ✅
**Setup:**
1. Créer ticket: `refund1@example.com`
2. Confirmer → Code généré
3. **NE PAS** sélectionner de case (code.cell_x/y = NULL)

**Action:** Cliquer **"✗ Annuler"**

**Résultat attendu:**
- [ ] ✅ Remboursement réussi
- [ ] ✅ Ticket status → `'refunded'`
- [ ] ✅ Code supprimé de la table `codes`

**Vérifier en DB:**
```sql
SELECT * FROM codes WHERE code = 'ABC-XXXXX';
-- Devrait retourner 0 rows
```

### Test 3.2: Remboursement Code Sélectionné 🚫
**Setup:**
1. Créer ticket: `refund2@example.com`
2. Confirmer → Code généré (ex: `ABC-99999`)
3. **Aller sur la fresque** et sélectionner une case (cell_x=50, cell_y=50)
4. **NE PAS** peindre (color = NULL)

**Action:** Retour admin → Cliquer **"✗ Annuler"**

**Résultat attendu:**
- [ ] ✅ Erreur: **"Cannot refund: cell position already claimed. Contact support."**
- [ ] ✅ Ticket reste **paid**
- [ ] ✅ Case reste réservée pour l'user

### Test 3.3: Remboursement Code Peint 🚫
**Setup:**
1. Créer ticket: `refund3@example.com`
2. Confirmer → Code généré
3. Sélectionner case ET **peindre** (color = 3)

**Action:** Admin → Cliquer **"✗ Annuler"**

**Résultat attendu:**
- [ ] ✅ Erreur: **"Cannot refund: cell already painted"**
- [ ] ✅ Ticket reste **paid**
- [ ] ✅ Case reste peinte

---

## 🎰 SECTION 4: Loterie

### Test 4.1: Créer un Gain
**Action:** Onglet 🎰 Loterie

1. Palier: **Palier 0 - 10000€**
2. Nom: (laisser vide)
3. Montant: (laisser vide)
4. Type: **Principal**
5. Cliquer **"➕ Créer Gain"**

**Vérifier:**
- [ ] ✅ Message: "Gain créé avec succès! ID: X"
- [ ] ✅ Gain apparaît dans "Gains à Tirer"
- [ ] ✅ Status: **pending**

**Vérifier en DB:**
```sql
SELECT id, tier_id, name, amount, prize_type, status
FROM prizes
ORDER BY created_at DESC
LIMIT 1;
```

- [ ] ✅ name = `'Gain Principal Palier 0'` (auto-généré)
- [ ] ✅ amount = `10000` (du palier)
- [ ] ✅ prize_type = `'main'`
- [ ] ✅ status = `'pending'`

### Test 4.2: Tirer un Gain (Pas Assez de Tickets)
**Setup:** 0 ticket vendu

**Action:** Cliquer **"🎲 Tirer au sort"**

**Résultat attendu:**
- [ ] ✅ Erreur: "No eligible tickets for this tier"

### Test 4.3: Tirer un Gain (Avec Tickets)
**Setup:**
1. Créer et confirmer 10 tickets (différents emails)
2. Créer gain pour Palier 0

**Action:** Cliquer **"🎲 Tirer au sort"**

**Vérifier:**
- [ ] ✅ Popup: "Gain tiré au sort! Gagnant: test@example.com, Code: ABC-XXXXX"
- [ ] ✅ Gain status → **drawn**
- [ ] ✅ Gagnant affiché dans tableau

**Vérifier en DB:**
```sql
SELECT p.id, p.status, p.winner_ticket_id, t.email, t.order_id
FROM prizes p
JOIN tickets t ON p.winner_ticket_id = t.id
WHERE p.id = <PRIZE_ID>;
```

- [ ] ✅ status = `'drawn'`
- [ ] ✅ winner_ticket_id référence un ticket du palier 0
- [ ] ✅ Email du gagnant affiché

### Test 4.4: Probabilité Loterie (1 ticket = 1 chance)
**Setup:**
1. User A: 1 ticket
2. User B: 9 tickets
3. Total: 10 tickets

**Effectuer 10 tirages** (créer 10 gains, tirer chacun)

**Vérifier:**
- [ ] User B gagne ~9 fois (90%)
- [ ] User A gagne ~1 fois (10%)

> **Note:** Variance normale, User B peut gagner 7-10 fois sur 10

### Test 4.5: Workflow Complet du Gain
**Setup:** 1 gain tiré (status = drawn)

**Action 1:** Cliquer **"✓ Marquer réclamé"**

**Vérifier:**
- [ ] ✅ Status → **claimed**

**Action 2:** Cliquer **"💰 Marquer payé"**

**Vérifier:**
- [ ] ✅ Status → **paid**
- [ ] ✅ Gain apparaît dans stats "Gains payés"

---

## 🤝 SECTION 5: Parrainages

### Test 5.1: Créer Parrainage (API)
```bash
curl -X POST https://fresq-v2.onrender.com/api/referral/create \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "referredEmail": "nouveau@example.com"
  }'
```

**Résultat attendu:**
- [ ] ✅ Parrainage créé
- [ ] ✅ Status: **pending**

**Vérifier en DB:**
```sql
SELECT * FROM referrals WHERE referred_email = 'nouveau@example.com';
```

- [ ] ✅ status = `'pending'`
- [ ] ✅ referrer_user_id = `1`
- [ ] ✅ free_ticket_code_id = `NULL` (pas encore généré)

### Test 5.2: Compléter Parrainage (Premier Achat)
**Action:**
1. Créer ticket pour `nouveau@example.com`
2. Confirmer paiement

**Vérifier automatiquement:**
```sql
SELECT r.*, c.code
FROM referrals r
LEFT JOIN codes c ON r.free_ticket_code_id = c.id
WHERE r.referred_email = 'nouveau@example.com';
```

**Résultat attendu:**
- [ ] ✅ status = `'completed'`
- [ ] ✅ free_ticket_code_id = `<ID code gratuit>`
- [ ] ✅ Code généré pour le parrain (user_id = 1)

> ⚠️ **NOTE:** Actuellement le système NE fait PAS l'auto-complétion lors du premier achat.
> **À implémenter** dans `confirmTicketPayment` avec `completeReferral(email)`.

### Test 5.3: Admin Dashboard Parrainages
**Action:** Onglet 🤝 Parrainages

**Vérifier:**
- [ ] ✅ Stats affichées (pending, completed, total)
- [ ] ✅ Top Parrains (si données)
- [ ] ✅ Tableau de tous les parrainages

---

## 🔄 SECTION 6: Tier Upgrade (Expansion Grille)

### Test 6.1: Setup - Peindre Cases Palier 0
**Action:**
1. Créer 5 tickets
2. Confirmer tous
3. **Aller sur la fresque** avec chaque code
4. Sélectionner cases aux 4 coins + centre:
   - Code 1: (0, 0) - Rouge
   - Code 2: (199, 199) - Bleu
   - Code 3: (0, 199) - Vert
   - Code 4: (199, 0) - Jaune
   - Code 5: (100, 100) - Violet

**Vérifier en DB:**
```sql
SELECT code, cell_x, cell_y, color
FROM codes
WHERE cell_x IS NOT NULL;
```

- [ ] ✅ 5 cases sélectionnées et peintes

### Test 6.2: Simuler Tier Upgrade
**Option A: Manuelle (via SQL)**
```sql
-- Créer 20,000 tickets fictifs directement en DB
DO $$
BEGIN
  FOR i IN 1..20000 LOOP
    INSERT INTO tickets (order_id, email, user_id, amount, status, tier_id, paid_at)
    VALUES (
      'ORDER-BULK-' || i,
      'bulk' || i || '@test.com',
      1,
      2.00,
      'paid',
      1,
      NOW()
    );
  END LOOP;
END $$;
```

**Vérifier progression:**
```bash
curl https://fresq-v2.onrender.com/api/tier/progress
```

- [ ] ✅ ticketsSold = 20,005 (ou plus)
- [ ] ✅ currentTier devrait être Palier 1 (si upgrade automatique)

**Option B: Via Bulk API (à implémenter plus tard)**

### Test 6.3: Vérifier Décalage Cases
**Après upgrade Palier 0 → 1 (200×200 → 283×283)**

**Offset calculé:**
```
offsetX = (283 - 200) / 2 = 41.5 = 41
offsetY = 41
```

**Vérifier en DB:**
```sql
SELECT code, cell_x, cell_y, color
FROM codes
WHERE color IS NOT NULL
ORDER BY cell_x, cell_y;
```

**Résultat attendu:**
- [ ] ✅ Ancienne (0, 0) → Nouvelle (41, 41)
- [ ] ✅ Ancienne (199, 199) → Nouvelle (240, 240)
- [ ] ✅ Ancienne (100, 100) → Nouvelle (141, 141)
- [ ] ✅ Couleurs préservées

**Vérifier config:**
```sql
SELECT grid_width, grid_height FROM config;
```

- [ ] ✅ grid_width = 283
- [ ] ✅ grid_height = 283

### Test 6.4: Vérifier Anciennes Cases dans Nouvelle Grille
**Action:** Aller sur https://fresq-v2.onrender.com

**Vérifier:**
- [ ] ✅ Grille affiche 283×283
- [ ] ✅ Anciennes cases visibles au centre
- [ ] ✅ Espace vide autour (nouvelles cases disponibles)
- [ ] ✅ Couleurs correctes

---

## 📊 SECTION 7: Stats & Performance

### Test 7.1: Stats Admin Dashboard
**Action:** Onglet 📊 Dashboard

**Vérifier:**
- [ ] ✅ Utilisateurs: nombre correct
- [ ] ✅ Codes: nombre correct
- [ ] ✅ Cases peintes: nombre correct
- [ ] ✅ Pourcentage grille: calculé correctement

### Test 7.2: Stats Commercial
**Action:** Onglet 💰 Commercial

**Vérifier:**
- [ ] ✅ Palier actuel: correct
- [ ] ✅ Tickets vendus: correct
- [ ] ✅ Revenus: somme correcte (nb_tickets × 2€)
- [ ] ✅ Progression: calcul correct

### Test 7.3: Performance Recherche
```sql
-- Vérifier que les indexes existent
SELECT indexname, tablename
FROM pg_indexes
WHERE tablename IN ('tickets', 'prizes', 'referrals', 'codes')
ORDER BY tablename, indexname;
```

**Résultat attendu:**
- [ ] ✅ idx_tickets_status
- [ ] ✅ idx_tickets_email
- [ ] ✅ idx_prizes_status
- [ ] ✅ idx_codes_code
- [ ] ✅ idx_codes_cell
- [ ] ✅ etc.

---

## 🔐 SECTION 8: Sécurité & Validation

### Test 8.1: Rate Limiting
**Action:** Créer 20 tickets en moins de 1 minute

**Résultat attendu:**
- [ ] ✅ Après 5 requêtes: erreur 429 "too_many_requests"

### Test 8.2: Admin Auth
**Action:**
1. Déconnexion admin
2. Tenter accès direct: `https://fresq-v2.onrender.com/api/admin/tickets`

**Résultat attendu:**
- [ ] ✅ Erreur 401 Unauthorized

### Test 8.3: Validation Email
**Action:** Créer ticket avec email invalide

```
email: "invalid-email"
```

**Résultat attendu:**
- [ ] ✅ Erreur: "Invalid email"

---

## 🐛 SECTION 9: Edge Cases

### Test 9.1: Ticket avec Montant 0
```bash
curl -X POST https://fresq-v2.onrender.com/api/ticket/create \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "amount": 0}'
```

**Résultat attendu:**
- [ ] ✅ Ticket créé (pas de validation min amount pour l'instant)
- [ ] ⚠️ **À implémenter:** Validation amount >= 0.01

### Test 9.2: Créer Gain pour Tier Inexistant
**Action:** Admin → Loterie

```
tierId: 999 (n'existe pas)
```

**Résultat attendu:**
- [ ] ✅ Erreur: "Tier not found"

### Test 9.3: Tirer Gain Déjà Tiré
**Setup:** Gain avec status = 'drawn'

**Action:** Re-cliquer "🎲 Tirer"

**Résultat attendu:**
- [ ] ✅ Erreur: "Prize already drawn"

---

## 📝 Résumé des Tests

### Tests Critiques (Bloquants)
- [ ] ✅ Création ticket
- [ ] ✅ Confirmation paiement + génération code
- [ ] ✅ Blocage remboursement si peinte/sélectionnée
- [ ] ✅ Tirage loterie avec probabilité correcte
- [ ] ✅ Tier upgrade + décalage cases

### Tests Importants (Haute Priorité)
- [ ] ✅ Stats mises à jour correctement
- [ ] ✅ Admin auth fonctionne
- [ ] ✅ Rate limiting actif
- [ ] ✅ Indexes DB présents

### Tests Optionnels (Basse Priorité)
- [ ] Parrainages (auto-complétion à implémenter)
- [ ] Edge cases validation
- [ ] Performance sous charge

---

## ✅ Validation Finale

**Avant de passer aux packs et deadlines:**

- [ ] ✅ Tous les tests critiques passent
- [ ] ✅ Aucune erreur dans logs Render
- [ ] ✅ Admin dashboard responsive
- [ ] ✅ Aucune régression sur fonctionnalités existantes (fresque)

**Si tout OK → Implémenter Packs + Deadlines 🚀**

---

**Dernière mise à jour:** 2026-01-31
