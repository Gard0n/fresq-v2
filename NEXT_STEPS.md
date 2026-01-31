# FRESQ V2 - Prochaines Étapes d'Implémentation

## ✅ Décisions Validées

### Système Commercial
- ✅ **Packs de tickets**: Oui (plus de tickets = prix dégressif)
- ✅ **Loterie**: 1 ticket = 1 chance (favorise gros acheteurs)
- ✅ **Cases**: Réclamées gardées même après tier upgrade
- ✅ **Tier upgrade**: Automatique dès seuil tickets
- ✅ **Tirage**: Fin du dernier palier OU deadline temporelle
- ✅ **Remboursement**: Bloqué si case peinte ou sélectionnée

---

## 🚧 À Implémenter

### 1️⃣ **Système de Packs** (PRIORITÉ HAUTE)

#### Tables à modifier
```sql
-- Ajouter colonne quantity aux tickets
ALTER TABLE tickets ADD COLUMN quantity INT DEFAULT 1;
```

#### Service à créer: `packService.js`
```javascript
export const PACKS = {
  solo: { tickets: 1, price: 2.00, discount: 0, label: "Solo" },
  mini: { tickets: 5, price: 9.00, discount: 10, label: "Mini Pack" },
  medium: { tickets: 10, price: 16.00, discount: 20, label: "Pack Medium" },
  mega: { tickets: 50, price: 70.00, discount: 30, label: "Mega Pack" },
  ultra: { tickets: 100, price: 120.00, discount: 40, label: "Ultra Pack" }
};

export async function createPackPurchase(client, { email, packType }) {
  const pack = PACKS[packType];
  if (!pack) throw new Error('Invalid pack type');

  // 1. Créer 1 ticket avec quantity
  const ticket = await ticketService.createTicket(client, {
    email,
    amount: pack.price,
    quantity: pack.tickets
  });

  return ticket;
}

export async function confirmPackPurchase(client, orderId) {
  // 1. Get ticket
  const ticket = await ticketService.getTicketByOrderId(client, orderId);

  // 2. Générer N codes (quantity)
  const codes = [];
  for (let i = 0; i < ticket.quantity; i++) {
    const code = generateCode();
    const codeResult = await client.query(
      'INSERT INTO codes (code, user_id) VALUES ($1, $2) RETURNING id',
      [code, ticket.user_id]
    );
    codes.push({ id: codeResult.rows[0].id, code });
  }

  // 3. Update ticket
  await client.query(
    'UPDATE tickets SET status = $1, paid_at = NOW() WHERE order_id = $2',
    ['paid', orderId]
  );

  // 4. Check tier upgrade (basé sur quantity)
  const tierUpgrade = await tierService.checkTierUpgrade(client, currentTier);

  return { ticket, codes, tierUpgrade };
}
```

#### Routes API à ajouter
```javascript
// GET /api/packs - Liste des packs disponibles
app.get('/api/packs', (req, res) => {
  res.json({ ok: true, packs: packService.PACKS });
});

// POST /api/pack/purchase - Acheter un pack
app.post('/api/pack/purchase', async (req, res) => {
  const { email, packType } = req.body;
  const ticket = await packService.createPackPurchase(client, { email, packType });
  res.json({ ok: true, ticket });
});

// POST /api/admin/pack/:orderId/confirm - Confirmer pack
app.post('/api/admin/pack/:orderId/confirm', requireAdmin, async (req, res) => {
  const result = await packService.confirmPackPurchase(client, orderId);
  res.json({ ok: true, ...result });
});
```

#### Admin Dashboard
```html
<!-- Nouveau dans onglet Commercial -->
<div class="section">
  <h2>📦 Packs Disponibles</h2>
  <div id="packs-list"></div>
</div>
```

---

### 2️⃣ **Système de Deadline (Limite Temporelle)** (PRIORITÉ HAUTE)

#### Table à créer
```sql
CREATE TABLE tier_periods (
  id SERIAL PRIMARY KEY,
  tier_number INT NOT NULL UNIQUE,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP,
  deadline TIMESTAMP,              -- Calculé: start_date + max_duration
  max_duration_days INT NOT NULL,  -- Ex: 30 jours
  tickets_sold INT DEFAULT 0,
  status VARCHAR DEFAULT 'active', -- 'active', 'completed'
  completion_reason VARCHAR,       -- 'sold_out', 'deadline', 'manual'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insérer période initiale (Tier 0)
INSERT INTO tier_periods (tier_number, start_date, deadline, max_duration_days)
VALUES (0, NOW(), NOW() + INTERVAL '30 days', 30);
```

#### Service à créer: `deadlineService.js`
```javascript
// Configuration des deadlines par tier
export const TIER_DEADLINES = {
  0: { maxDays: 30 },
  1: { maxDays: 60 },
  2: { maxDays: 90 },
  3: { maxDays: 90 },
  4: { maxDays: 120 },
  5: { maxDays: 120 },
  6: { maxDays: 150 },
  7: { maxDays: 150 },
  8: { maxDays: 180 },
  9: { maxDays: 365 } // 1 an pour le dernier
};

export async function checkDeadlines(client) {
  // Récupérer période active
  const periodResult = await client.query(
    'SELECT * FROM tier_periods WHERE status = $1',
    ['active']
  );

  if (periodResult.rows.length === 0) return null;

  const period = periodResult.rows[0];
  const now = new Date();

  // Vérifier si deadline dépassée
  if (now >= new Date(period.deadline)) {
    // FORCE TIER COMPLETE
    await completeTierPeriod(client, period, 'deadline');
    return { tierCompleted: true, reason: 'deadline' };
  }

  return null;
}

export async function completeTierPeriod(client, period, reason) {
  // 1. Marquer période comme completed
  await client.query(
    'UPDATE tier_periods SET status = $1, completion_reason = $2, end_date = NOW() WHERE id = $3',
    ['completed', reason, period.id]
  );

  // 2. Créer tirage automatique
  const prize = await lotteryService.createPrizeDraw(client, {
    tierId: period.tier_number + 1, // FK vers tiers table
    name: `Gain Principal Palier ${period.tier_number}`,
    amount: getTierPrizeAmount(period.tier_number),
    prizeType: 'main'
  });

  // 3. Tirer immédiatement
  const drawn = await lotteryService.drawPrize(client, prize.id);

  // 4. Upgrade tier si pas dernier
  if (period.tier_number < 9) {
    const nextTier = await tierService.getNextTier(client, period.tier_number);
    await tierService.upgradeTier(client, nextTier);

    // Créer nouvelle période
    await client.query(`
      INSERT INTO tier_periods (tier_number, start_date, deadline, max_duration_days)
      VALUES ($1, NOW(), NOW() + INTERVAL '${TIER_DEADLINES[period.tier_number + 1].maxDays} days', $2)
    `, [period.tier_number + 1, TIER_DEADLINES[period.tier_number + 1].maxDays]);
  }

  return { prize, drawn };
}
```

#### Cron Job (Node-Cron)
```javascript
// Dans server/index.js
import cron from 'node-cron';
import * as deadlineService from './services/deadlineService.js';

// Vérifier deadlines toutes les heures
cron.schedule('0 * * * *', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await deadlineService.checkDeadlines(client);

    if (result?.tierCompleted) {
      console.log(`🎰 Tier completed by deadline! Prize drawn.`);
      io.emit('tier_deadline_reached', result);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Deadline check error:', err);
  } finally {
    client.release();
  }
});
```

---

### 3️⃣ **Améliorer Tier Upgrade** (PRIORITÉ MOYENNE)

#### Modifier `confirmTicketPayment` pour gérer quantity
```javascript
// Dans ticketService.js
export async function confirmTicketPayment(client, orderId) {
  // ... (code existant)

  // NOUVEAU: Gérer quantity pour packs
  const ticketsSoldIncrease = ticket.quantity || 1;

  // Check tier upgrade en tenant compte de quantity
  const newTier = await checkTierUpgrade(client, tierBeforePayment.tier_number, ticketsSoldIncrease);

  if (newTier) {
    await upgradeTier(client, newTier);

    // Marquer période comme completed (sold_out)
    await deadlineService.completeTierPeriod(client, currentPeriod, 'sold_out');
  }

  // ...
}
```

#### Modifier `checkTierUpgrade`
```javascript
// Dans tierService.js
export async function checkTierUpgrade(client, currentTierNumber, additionalTickets = 0) {
  const totalTickets = await getTotalPaidTickets(client) + additionalTickets;

  const currentTier = await client.query(
    'SELECT * FROM tiers WHERE tier_number = $1',
    [currentTierNumber]
  );

  // Si on dépasse max_tickets du tier actuel
  if (totalTickets >= currentTier.rows[0].max_tickets) {
    return await getNextTier(client, currentTierNumber);
  }

  return null;
}

async function getTotalPaidTickets(client) {
  const result = await client.query(`
    SELECT SUM(quantity) as total
    FROM tickets
    WHERE status = 'paid'
  `);
  return parseInt(result.rows[0].total) || 0;
}
```

---

### 4️⃣ **Dashboard Amélioré** (PRIORITÉ BASSE)

#### Afficher Deadline dans Commercial Tab
```javascript
// Dans loadCommercialStats()
const periodRes = await apiCall('/api/tier/period');
const period = periodRes.period;

const deadline = new Date(period.deadline);
const timeLeft = deadline - Date.now();
const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));

document.getElementById('stat-deadline').textContent =
  `${daysLeft} jours restants (${deadline.toLocaleDateString()})`;
```

---

## 📊 Récapitulatif des Modifications

### Fichiers à Créer
- [ ] `server/services/packService.js`
- [ ] `server/services/deadlineService.js`

### Fichiers à Modifier
- [ ] `server/migration_commercial.sql` (ajouter tier_periods, ALTER tickets)
- [ ] `server/services/ticketService.js` (gérer quantity)
- [ ] `server/services/tierService.js` (getTotalPaidTickets avec SUM(quantity))
- [ ] `server/index.js` (routes packs, cron job)
- [ ] `public/admin.html` (afficher packs, deadline)
- [ ] `public/admin.js` (loadPacksInfo, displayDeadline)

### Dépendances à Ajouter
```bash
npm install node-cron
```

---

## 🎯 Ordre d'Implémentation Recommandé

1. **✅ FAIT**: Système de base (tiers, tickets, lottery, referrals)
2. **✅ FAIT**: Bloquer remboursement si case peinte/sélectionnée
3. **🔄 EN COURS**: Tester système actuel
4. **SUIVANT**: Système de Packs (haute priorité)
5. **ENSUITE**: Système de Deadline (haute priorité)
6. **APRÈS**: Cron job auto-draw
7. **FINAL**: Page publique d'achat (frontend)

---

## 🧪 Tests à Effectuer (Ordre)

### Phase 1: Test Système Actuel
- [ ] Créer ticket solo → Confirmer → Vérifier code généré
- [ ] Tenter remboursement avec case non sélectionnée → OK
- [ ] Tenter remboursement avec case sélectionnée → BLOCKED ✅
- [ ] Créer 100 tickets → Confirmer tous → Vérifier stats
- [ ] Créer gain → Tirer → Vérifier gagnant

### Phase 2: Test Packs (après implémentation)
- [ ] Acheter pack medium (10 tickets) → Vérifier 10 codes générés
- [ ] Confirmer pack → Vérifier quantity dans DB
- [ ] Acheter pack ultra (100 tickets) → Vérifier tier upgrade

### Phase 3: Test Deadline (après implémentation)
- [ ] Créer période avec deadline 1 jour
- [ ] Attendre deadline → Vérifier auto-tirage
- [ ] Vérifier tier upgrade auto

---

**Prochaine action:** Tester le système actuel avant d'ajouter packs et deadline.
