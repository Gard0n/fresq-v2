# FRESQ V2 - Plan d'Implémentation Commercial

## 📋 Décisions Validées

### Système de Packs
- ✅ Prix **fixes** (pas de réduction)
- ✅ Tickets **bonus offerts** en plus
- ✅ Admin peut **modifier** les packs

### Deadline
- ✅ **Globale**: 6 mois pour toute la campagne
- ✅ **Pas par palier**: deadline unique
- ✅ Paliers basés uniquement sur nombre de tickets vendus

### Tarification Packs
```
1 ticket   : 2€    → 1 ticket   (0 bonus)
5 tickets  : 10€   → 6 tickets   (1 bonus)
10 tickets : 20€   → 12 tickets  (2 bonus)
50 tickets : 100€  → 55 tickets  (5 bonus)
100 tickets: 200€  → 110 tickets (10 bonus)
```

### Paiement
- ✅ Préparer pour **Stripe** (intégration ultérieure)
- ✅ Mode manuel/test pour l'instant

---

## 🚀 PHASE 1: Système de Packs (2-3h)

### 1.1 Base de Données

#### Modifier Table `tickets`
```sql
-- Ajouter colonnes pour packs
ALTER TABLE tickets ADD COLUMN quantity INT DEFAULT 1;
ALTER TABLE tickets ADD COLUMN bonus_tickets INT DEFAULT 0;
ALTER TABLE tickets ADD COLUMN pack_type VARCHAR; -- 'solo', 'mini', 'medium', 'mega', 'ultra'
```

#### Créer Table `pack_configs` (Admin peut modifier)
```sql
CREATE TABLE pack_configs (
  id SERIAL PRIMARY KEY,
  pack_type VARCHAR UNIQUE NOT NULL,     -- 'solo', 'mini', 'medium', 'mega', 'ultra'
  display_name VARCHAR NOT NULL,          -- "Pack Solo", "Pack Mini", etc.
  base_quantity INT NOT NULL,             -- Nombre de tickets payés
  bonus_quantity INT DEFAULT 0,           -- Tickets bonus offerts
  total_quantity INT NOT NULL,            -- base + bonus
  price DECIMAL NOT NULL,                 -- Prix en euros
  is_active BOOLEAN DEFAULT TRUE,
  display_order INT DEFAULT 0,            -- Ordre d'affichage
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insérer packs initiaux
INSERT INTO pack_configs (pack_type, display_name, base_quantity, bonus_quantity, total_quantity, price, display_order) VALUES
('solo', 'Pack Solo', 1, 0, 1, 2.00, 1),
('mini', 'Pack Mini', 5, 1, 6, 8.00, 2),
('medium', 'Pack Medium', 10, 2, 12, 16.00, 3),
('mega', 'Pack Mega', 50, 5, 55, 90.00, 4),
('ultra', 'Pack Ultra', 100, 10, 110, 180.00, 5)
ON CONFLICT (pack_type) DO NOTHING;
```

---

### 1.2 Service Backend: `packService.js`

**Créer:** `server/services/packService.js`

```javascript
// FRESQ V2 - Pack Service
// Gestion des packs de tickets avec bonus

/**
 * Get all active pack configurations
 * @param {object} client - PostgreSQL client
 * @returns {Promise<Array>} List of active packs
 */
export async function getAvailablePacks(client) {
  try {
    const result = await client.query(`
      SELECT * FROM pack_configs
      WHERE is_active = TRUE
      ORDER BY display_order ASC
    `);
    return result.rows;
  } catch (error) {
    console.error('[PackService] Error getting packs:', error);
    throw error;
  }
}

/**
 * Get pack configuration by type
 * @param {object} client - PostgreSQL client
 * @param {string} packType - Pack type (solo, mini, medium, mega, ultra)
 * @returns {Promise<object|null>} Pack config or null
 */
export async function getPackByType(client, packType) {
  try {
    const result = await client.query(
      'SELECT * FROM pack_configs WHERE pack_type = $1 AND is_active = TRUE',
      [packType]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('[PackService] Error getting pack:', error);
    throw error;
  }
}

/**
 * Create pack purchase (generates ticket with quantity)
 * @param {object} client - PostgreSQL client
 * @param {object} params - Purchase parameters
 * @param {string} params.email - Buyer email
 * @param {string} params.packType - Pack type
 * @returns {Promise<object>} Created ticket
 */
export async function createPackPurchase(client, { email, packType }) {
  try {
    // Get pack config
    const pack = await getPackByType(client, packType);
    if (!pack) {
      throw new Error('Pack not found or inactive');
    }

    // Get or create user
    const normalizedEmail = email.trim().toLowerCase();
    let userId = null;

    const userResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      const newUserResult = await client.query(
        'INSERT INTO users (email) VALUES ($1) RETURNING id',
        [normalizedEmail]
      );
      userId = newUserResult.rows[0].id;
    }

    // Get current tier
    const { getCurrentTier } = await import('./tierService.js');
    const currentTier = await getCurrentTier(client);

    // Generate order ID
    const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();

    // Create ticket with pack info
    const ticketResult = await client.query(`
      INSERT INTO tickets (
        order_id,
        email,
        user_id,
        amount,
        quantity,
        bonus_tickets,
        pack_type,
        status,
        tier_id,
        payment_provider,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, 'manual', NOW())
      RETURNING *
    `, [
      orderId,
      normalizedEmail,
      userId,
      pack.price,
      pack.total_quantity,  // Total = base + bonus
      pack.bonus_quantity,
      pack.pack_type,
      currentTier.id
    ]);

    return {
      ticket: ticketResult.rows[0],
      pack: pack
    };
  } catch (error) {
    console.error('[PackService] Error creating pack purchase:', error);
    throw error;
  }
}

/**
 * Confirm pack purchase and generate codes
 * @param {object} client - PostgreSQL client
 * @param {string} orderId - Order ID
 * @returns {Promise<object>} Confirmed ticket with codes
 */
export async function confirmPackPurchase(client, orderId) {
  try {
    // Get ticket
    const ticketResult = await client.query(
      'SELECT * FROM tickets WHERE order_id = $1',
      [orderId]
    );

    if (ticketResult.rows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status === 'paid') {
      throw new Error('Pack already confirmed');
    }

    // Generate N codes (quantity)
    const { generateCode } = await import('../utils.js');
    const codes = [];

    for (let i = 0; i < ticket.quantity; i++) {
      const code = generateCode();
      const codeResult = await client.query(
        'INSERT INTO codes (code, user_id) VALUES ($1, $2) RETURNING id',
        [code, ticket.user_id]
      );
      codes.push({
        id: codeResult.rows[0].id,
        code: code
      });
    }

    // Update ticket to paid
    await client.query(
      'UPDATE tickets SET status = $1, paid_at = NOW() WHERE order_id = $2',
      ['paid', orderId]
    );

    // Check tier upgrade (based on total quantity)
    const { getCurrentTier, checkTierUpgrade, upgradeTier } = await import('./tierService.js');
    const tierBeforePayment = await getCurrentTier(client);

    // Pass additional tickets count for tier upgrade check
    const newTier = await checkTierUpgrade(client, tierBeforePayment.tier_number, ticket.quantity);

    let tierUpgradeResult = null;
    if (newTier) {
      tierUpgradeResult = await upgradeTier(client, newTier);
    }

    // Complete referral if exists
    const { completeReferral } = await import('./referralService.js');
    await completeReferral(client, ticket.email);

    return {
      ticket: {
        ...ticket,
        status: 'paid'
      },
      codes: codes,
      tierUpgrade: tierUpgradeResult
    };
  } catch (error) {
    console.error('[PackService] Error confirming pack:', error);
    throw error;
  }
}

/**
 * Update pack configuration (Admin only)
 * @param {object} client - PostgreSQL client
 * @param {number} packId - Pack ID
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated pack
 */
export async function updatePackConfig(client, packId, updates) {
  try {
    const allowedFields = ['display_name', 'base_quantity', 'bonus_quantity', 'price', 'is_active', 'display_order'];
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      throw new Error('No valid fields to update');
    }

    // Recalculate total_quantity if base or bonus changed
    if (updates.base_quantity !== undefined || updates.bonus_quantity !== undefined) {
      const packResult = await client.query('SELECT * FROM pack_configs WHERE id = $1', [packId]);
      const pack = packResult.rows[0];

      const newBase = updates.base_quantity !== undefined ? updates.base_quantity : pack.base_quantity;
      const newBonus = updates.bonus_quantity !== undefined ? updates.bonus_quantity : pack.bonus_quantity;

      updateFields.push(`total_quantity = $${paramIndex}`);
      values.push(newBase + newBonus);
      paramIndex++;
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(packId);

    const query = `
      UPDATE pack_configs
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await client.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('[PackService] Error updating pack:', error);
    throw error;
  }
}

/**
 * Get pack statistics
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Pack stats
 */
export async function getPackStats(client) {
  try {
    const result = await client.query(`
      SELECT
        pack_type,
        COUNT(*) as total_sold,
        SUM(quantity) as total_tickets,
        SUM(bonus_tickets) as total_bonus,
        SUM(amount) as total_revenue
      FROM tickets
      WHERE status = 'paid' AND pack_type IS NOT NULL
      GROUP BY pack_type
      ORDER BY total_sold DESC
    `);

    return result.rows;
  } catch (error) {
    console.error('[PackService] Error getting pack stats:', error);
    throw error;
  }
}
```

---

### 1.3 Modifier `tierService.js`

**Mettre à jour `checkTierUpgrade` pour gérer quantity:**

```javascript
// Dans tierService.js

/**
 * Get total paid tickets (including pack quantities)
 */
async function getTotalPaidTickets(client) {
  const result = await client.query(`
    SELECT COALESCE(SUM(quantity), 0) as total
    FROM tickets
    WHERE status = 'paid'
  `);
  return parseInt(result.rows[0].total) || 0;
}

export async function checkTierUpgrade(client, currentTierNumber, additionalTickets = 0) {
  const totalTickets = await getTotalPaidTickets(client) + additionalTickets;

  const currentTier = await client.query(
    'SELECT * FROM tiers WHERE tier_number = $1',
    [currentTierNumber]
  );

  if (currentTier.rows.length === 0) return null;

  // Si on dépasse max_tickets du tier actuel
  if (totalTickets >= currentTier.rows[0].max_tickets) {
    return await getNextTier(client, currentTierNumber);
  }

  return null;
}
```

---

### 1.4 API Routes

**Ajouter dans `server/index.js`:**

```javascript
import * as packService from './services/packService.js';

// ===== PUBLIC: PACKS =====

// Get available packs
app.get('/api/packs', async (req, res) => {
  const client = await pool.connect();
  try {
    const packs = await packService.getAvailablePacks(client);
    res.json({ ok: true, packs });
  } catch (err) {
    log('error', 'Get packs error', { error: err.message });
    res.status(500).json({ error: 'get_packs_error' });
  } finally {
    client.release();
  }
});

// ===== ADMIN: PACK MANAGEMENT =====

// Create pack purchase (admin creates for testing)
app.post('/api/admin/pack/purchase', requireAdmin, async (req, res) => {
  const { email, packType } = req.body;

  if (!email || !packType) {
    return res.status(400).json({ error: 'email_and_pack_type_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await packService.createPackPurchase(client, { email, packType });

    await client.query('COMMIT');

    trackEvent('pack', 'created', packType);
    log('info', 'Pack purchase created', { orderId: result.ticket.order_id, packType });

    res.json({ ok: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create pack purchase error', { error: err.message });
    res.status(500).json({ error: 'create_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// Confirm pack purchase (generates N codes)
app.post('/api/admin/pack/:orderId/confirm', requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await packService.confirmPackPurchase(client, orderId);

    await client.query('COMMIT');

    trackEvent('pack', 'confirmed', orderId, result.codes.length);
    log('info', 'Pack confirmed', { orderId, codesGenerated: result.codes.length });

    // Broadcast tier upgrade if happened
    if (result.tierUpgrade && result.tierUpgrade.upgraded) {
      io.emit('tier_upgrade', {
        oldTier: result.tierUpgrade.oldTier,
        newTier: result.tierUpgrade.newTier,
        expansion: result.tierUpgrade.expansion
      });
      clearCache('config');
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Confirm pack error', { error: err.message });
    res.status(500).json({ error: 'confirm_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// Update pack configuration
app.put('/api/admin/pack-config/:packId', requireAdmin, async (req, res) => {
  const { packId } = req.params;
  const updates = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pack = await packService.updatePackConfig(client, parseInt(packId), updates);

    await client.query('COMMIT');

    trackEvent('pack', 'config_updated', pack.pack_type);
    log('info', 'Pack config updated', { packId, packType: pack.pack_type });

    res.json({ ok: true, pack });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Update pack config error', { error: err.message });
    res.status(500).json({ error: 'update_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// Get pack stats
app.get('/api/admin/pack-stats', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const stats = await packService.getPackStats(client);
    res.json({ ok: true, stats });
  } catch (err) {
    log('error', 'Get pack stats error', { error: err.message });
    res.status(500).json({ error: 'get_pack_stats_error' });
  } finally {
    client.release();
  }
});
```

---

## 🚀 PHASE 2: Deadline Globale (1-2h)

### 2.1 Base de Données

```sql
-- Table pour la campagne globale
CREATE TABLE campaign (
  id SERIAL PRIMARY KEY,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP,                    -- Calculé: start_date + 6 mois
  deadline TIMESTAMP NOT NULL,           -- start_date + 6 mois
  status VARCHAR DEFAULT 'active',       -- 'active', 'completed', 'cancelled'
  total_tickets_sold INT DEFAULT 0,
  total_revenue DECIMAL DEFAULT 0,
  completion_reason VARCHAR,             -- 'deadline', 'manual', 'sold_out'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insérer campagne initiale (6 mois)
INSERT INTO campaign (start_date, deadline, status)
VALUES (NOW(), NOW() + INTERVAL '6 months', 'active');
```

### 2.2 Service: `campaignService.js`

**Créer:** `server/services/campaignService.js`

```javascript
// FRESQ V2 - Campaign Service
// Gestion deadline globale

export async function getCurrentCampaign(client) {
  const result = await client.query(
    'SELECT * FROM campaign WHERE status = $1 ORDER BY start_date DESC LIMIT 1',
    ['active']
  );
  return result.rows[0] || null;
}

export async function getCampaignTimeLeft(client) {
  const campaign = await getCurrentCampaign(client);
  if (!campaign) return null;

  const now = new Date();
  const deadline = new Date(campaign.deadline);
  const timeLeft = deadline - now;

  return {
    campaign,
    deadline,
    timeLeftMs: timeLeft,
    daysLeft: Math.floor(timeLeft / (1000 * 60 * 60 * 24)),
    hoursLeft: Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    expired: timeLeft <= 0
  };
}

export async function checkCampaignDeadline(client) {
  const timeInfo = await getCampaignTimeLeft(client);

  if (timeInfo && timeInfo.expired) {
    // Deadline atteinte → Compléter campagne
    await completeCampaign(client, 'deadline');
    return { deadlineReached: true };
  }

  return { deadlineReached: false };
}

export async function completeCampaign(client, reason) {
  const campaign = await getCurrentCampaign(client);
  if (!campaign) throw new Error('No active campaign');

  // Update campaign status
  await client.query(`
    UPDATE campaign
    SET status = 'completed', completion_reason = $1, end_date = NOW(), updated_at = NOW()
    WHERE id = $2
  `, [reason, campaign.id]);

  // Trigger final lottery draws for all tiers
  const { createPrizeDraw, drawPrize } = await import('./lotteryService.js');
  const { getAllTiers } = await import('./tierService.js');

  const tiers = await getAllTiers(client);
  const drawnPrizes = [];

  for (const tier of tiers) {
    // Create main prize for this tier
    const prize = await createPrizeDraw(client, {
      tierId: tier.id,
      name: `Gain Final Palier ${tier.tier_number}`,
      amount: tier.prize_amount,
      prizeType: 'main'
    });

    // Draw immediately
    try {
      const drawn = await drawPrize(client, prize.id);
      drawnPrizes.push(drawn);
    } catch (err) {
      console.error(`Failed to draw prize for tier ${tier.tier_number}:`, err);
    }
  }

  return {
    campaign,
    drawnPrizes
  };
}
```

### 2.3 Cron Job

**Installer dépendance:**
```bash
npm install node-cron
```

**Ajouter dans `server/index.js`:**
```javascript
import cron from 'node-cron';
import * as campaignService from './services/campaignService.js';

// Check campaign deadline every hour
cron.schedule('0 * * * *', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await campaignService.checkCampaignDeadline(client);

    if (result.deadlineReached) {
      console.log('🎰 Campaign deadline reached! Drawing all prizes...');
      io.emit('campaign_ended', {
        reason: 'deadline',
        timestamp: new Date()
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Campaign deadline check error:', err);
  } finally {
    client.release();
  }
});
```

### 2.4 API Routes

```javascript
// Get campaign info
app.get('/api/campaign', async (req, res) => {
  const client = await pool.connect();
  try {
    const timeInfo = await campaignService.getCampaignTimeLeft(client);
    res.json({ ok: true, campaign: timeInfo });
  } catch (err) {
    log('error', 'Get campaign error', { error: err.message });
    res.status(500).json({ error: 'get_campaign_error' });
  } finally {
    client.release();
  }
});
```

---

## 🚀 PHASE 3: Parrainages Auto (30min)

### 3.1 Modifier `confirmPackPurchase`

**Déjà ajouté dans packService.js ci-dessus:**
```javascript
// Complete referral if exists
const { completeReferral } = await import('./referralService.js');
await completeReferral(client, ticket.email);
```

### 3.2 Mettre à jour Widget avec Deadline

**Ajouter dans widget HTML:**
```html
<span class="lottery-sep">•</span>
<span class="lottery-info">⏱️ <span id="widget-deadline">-</span></span>
```

**Ajouter dans JavaScript:**
```javascript
async function loadLotteryWidget() {
  // ... existing code

  // Load campaign deadline
  const campaignRes = await fetch('/api/campaign');
  const campaignData = await campaignRes.json();

  if (campaignData.ok && campaignData.campaign) {
    updateDeadlineWidget(campaignData.campaign);
  }
}

function updateDeadlineWidget(timeInfo) {
  const { daysLeft, expired } = timeInfo;

  const deadlineEl = document.getElementById('widget-deadline');
  if (expired) {
    deadlineEl.textContent = 'Campagne terminée';
    deadlineEl.style.color = '#ff6b6b';
  } else {
    deadlineEl.textContent = `${daysLeft}j restants`;
  }
}
```

---

## 🎨 PHASE 4: Admin Dashboard Enrichi

### 4.1 Onglet Commercial - Section Packs

**Ajouter dans `public/admin.html` (onglet Commercial):**

```html
<div class="section">
  <h2>📦 Gestion des Packs</h2>

  <!-- Pack Stats -->
  <div id="pack-stats-grid" class="stats-grid"></div>

  <!-- Create Pack Purchase -->
  <div class="toolbar">
    <select id="pack-type-select">
      <option value="">Sélectionner un pack...</option>
    </select>
    <input type="email" id="pack-email" placeholder="Email client" style="flex: 1;">
    <button id="create-pack-btn" class="primary">➕ Créer Achat Pack</button>
  </div>

  <!-- Pack Config Table -->
  <h3>⚙️ Configuration Packs</h3>
  <div id="pack-config-table"></div>
</div>
```

**JavaScript dans `public/admin.js`:**

```javascript
async function loadPacksSection() {
  // Load available packs
  const packsRes = await apiCall('/api/packs');
  if (packsRes.ok) {
    const select = document.getElementById('pack-type-select');
    select.innerHTML = '<option value="">Sélectionner un pack...</option>' +
      packsRes.packs.map(p => `<option value="${p.pack_type}">${p.display_name} - ${p.price}€ (${p.total_quantity} tickets)</option>`).join('');
  }

  // Load pack stats
  const statsRes = await apiCall('/api/admin/pack-stats');
  if (statsRes.ok) {
    displayPackStats(statsRes.stats);
  }

  // Load pack config table
  loadPackConfigTable();
}

function displayPackStats(stats) {
  const grid = document.getElementById('pack-stats-grid');
  grid.innerHTML = stats.map(s => `
    <div class="stat-card">
      <h3>${s.pack_type}</h3>
      <div class="value">${s.total_sold}</div>
      <div class="sub">${s.total_tickets} tickets (${s.total_bonus} bonus)</div>
      <div class="sub">${parseFloat(s.total_revenue).toFixed(2)}€</div>
    </div>
  `).join('');
}

// Event: Create pack purchase
document.getElementById('create-pack-btn').addEventListener('click', async () => {
  const packType = document.getElementById('pack-type-select').value;
  const email = document.getElementById('pack-email').value.trim();

  if (!packType || !email) {
    alert('Sélectionner un pack et entrer un email');
    return;
  }

  const res = await apiCall('/api/admin/pack/purchase', {
    method: 'POST',
    body: JSON.stringify({ email, packType })
  });

  if (res.ok) {
    alert(`Pack créé! Order ID: ${res.ticket.order_id}\nTickets: ${res.pack.total_quantity} (${res.pack.bonus_quantity} bonus)`);
    loadTicketsTable();
    loadPacksSection();
  }
});
```

---

## 📝 Résumé des Fichiers à Créer/Modifier

### Nouveaux Fichiers
- [ ] `server/services/packService.js`
- [ ] `server/services/campaignService.js`
- [ ] Migration SQL pour packs + campagne

### Fichiers à Modifier
- [ ] `server/migration_commercial.sql` (ajouter ALTER + CREATE)
- [ ] `server/services/tierService.js` (getTotalPaidTickets avec SUM(quantity))
- [ ] `server/index.js` (routes packs, cron job)
- [ ] `public/admin.html` (section packs)
- [ ] `public/admin.js` (fonctions packs)
- [ ] `public/index.html` (widget deadline)
- [ ] `public/app.js` (widget deadline)

---

## 🧪 Tests à Effectuer

### Packs
- [ ] Créer pack solo (1 ticket, 2€)
- [ ] Créer pack mini (6 tickets, 8€)
- [ ] Confirmer pack → vérifier N codes générés
- [ ] Vérifier bonus tickets comptés dans total
- [ ] Modifier config pack via admin
- [ ] Vérifier tier upgrade avec packs

### Deadline
- [ ] Vérifier deadline affichée (6 mois)
- [ ] Simuler deadline passée (changer en DB)
- [ ] Vérifier auto-draw tous les paliers
- [ ] Vérifier widget affiche deadline

### Parrainages
- [ ] Créer parrainage
- [ ] Parrainé achète pack → vérifier auto-complétion
- [ ] Code gratuit généré pour parrain

---

## ⏱️ Estimation Temps

| Phase | Tâche | Temps |
|-------|-------|-------|
| 1 | Système Packs Backend | 2h |
| 2 | Deadline Globale | 1.5h |
| 3 | Parrainages Auto | 0.5h |
| 4 | Admin Dashboard Packs | 1h |
| **TOTAL** | **Implémentation Complète** | **5h** |

---

## 🎯 Ordre d'Implémentation Recommandé

1. **Migration DB** (packs + campaign) - 15min
2. **packService.js** - 1h
3. **Modifier tierService.js** - 15min
4. **API Routes Packs** - 30min
5. **campaignService.js** - 45min
6. **Cron Job** - 15min
7. **Auto-complétion parrainages** - 15min
8. **Admin Dashboard Section Packs** - 1h
9. **Widget Deadline** - 30min
10. **Tests** - 30min

---

**Dernière mise à jour:** 2026-01-31
**Version:** Commercial V2.0 (Packs + Deadline)
