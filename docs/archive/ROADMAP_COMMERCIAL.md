# FRESQ V2 - Roadmap Commercial 🎯

## 🎨 Concept Final Validé

**Produit:** Fresque collaborative avec loterie et paliers évolutifs

### Business Model
- **Prix ticket**: 2€
- **1 ticket** = 1 code = 1 case à colorier
- **Grille évolutive**: Grandit par paliers (20k tickets = Palier 1, etc.)
- **Gain final**: Augmente par palier (10k€ → 500k€)
- **Tirage au sort**: Quand tous tickets vendus OU après X temps

### Spécificités
- Anciennes cases **restent**, nouvelles ajoutées autour
- Packs multi-tickets (à définir)
- **Parrainage** = tickets gratuits
- **Campagne unique** pour v1

---

## 📋 RÉCAPITULATIF GLOBAL - Ce Qu'il Faut Faire

### 🔴 **PHASE 1: FONDATIONS** (2-3 semaines)

#### A. Base de Données - Système de Paliers ✅ PRIORITÉ 1

**Nouvelles Tables:**

```sql
-- ===== TIERS (PALIERS) =====
CREATE TABLE tiers (
  id SERIAL PRIMARY KEY,
  tier_number INT NOT NULL,           -- 0, 1, 2, ..., 9
  min_tickets INT NOT NULL,           -- Ex: 20,000
  max_tickets INT NOT NULL,           -- Ex: 80,000
  grid_width INT NOT NULL,            -- Ex: 200
  grid_height INT NOT NULL,           -- Ex: 200
  total_cells INT NOT NULL,           -- grid_width * grid_height
  prize_amount DECIMAL NOT NULL,      -- Gain de ce palier
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insérer les paliers initiaux
INSERT INTO tiers (tier_number, min_tickets, max_tickets, grid_width, grid_height, total_cells, prize_amount) VALUES
(0, 0, 20000, 200, 200, 40000, 10000),
(1, 20000, 40000, 283, 283, 80089, 10000),
(2, 40000, 80000, 400, 400, 160000, 20000),
(3, 80000, 100000, 447, 447, 199809, 40000),
(4, 100000, 200000, 632, 632, 399424, 50000),
(5, 200000, 300000, 775, 775, 600625, 100000),
(6, 300000, 400000, 894, 894, 799236, 150000),
(7, 400000, 600000, 1095, 1095, 1199025, 200000),
(8, 600000, 800000, 1265, 1265, 1600225, 300000),
(9, 800000, 1000000, 1414, 1414, 1999396, 400000);

-- ===== TICKETS (ACHATS) =====
CREATE TABLE tickets (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR UNIQUE NOT NULL,   -- ID unique de commande
  payment_provider VARCHAR,            -- 'stripe', 'paypal', 'manual', etc.
  payment_session_id VARCHAR,          -- ID session paiement (Stripe checkout, etc.)
  email VARCHAR NOT NULL,              -- Email acheteur
  user_id INT REFERENCES users(id),    -- Optionnel si user créé
  code_id INT REFERENCES codes(id),    -- Code généré pour ce ticket
  amount DECIMAL NOT NULL,             -- Montant payé (2.00€)
  status VARCHAR DEFAULT 'pending',    -- 'pending', 'paid', 'refunded', 'cancelled'
  tier_id INT REFERENCES tiers(id),    -- Palier au moment de l'achat
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  refunded_at TIMESTAMP
);

-- ===== PRIZES (GAINS) =====
CREATE TABLE prizes (
  id SERIAL PRIMARY KEY,
  tier_id INT REFERENCES tiers(id),    -- Palier associé
  name VARCHAR NOT NULL,               -- "Gain Principal Palier 3"
  amount DECIMAL NOT NULL,             -- Montant du gain
  prize_type VARCHAR,                  -- 'main', 'secondary', 'daily', etc.
  draw_date TIMESTAMP,                 -- Date du tirage
  winner_ticket_id INT REFERENCES tickets(id), -- Ticket gagnant
  status VARCHAR DEFAULT 'pending',    -- 'pending', 'drawn', 'claimed', 'paid'
  created_at TIMESTAMP DEFAULT NOW()
);

-- ===== REFERRALS (PARRAINAGE) =====
CREATE TABLE referrals (
  id SERIAL PRIMARY KEY,
  referrer_user_id INT REFERENCES users(id),  -- Celui qui parraine
  referred_email VARCHAR NOT NULL,             -- Email parrainé
  referred_user_id INT REFERENCES users(id),   -- User créé (optionnel)
  free_ticket_code_id INT REFERENCES codes(id), -- Code gratuit généré
  status VARCHAR DEFAULT 'pending',    -- 'pending', 'completed', 'claimed'
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ===== INDEXES =====
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_email ON tickets(email);
CREATE INDEX idx_tickets_tier_id ON tickets(tier_id);
CREATE INDEX idx_prizes_tier_id ON prizes(tier_id);
CREATE INDEX idx_prizes_status ON prizes(status);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX idx_referrals_email ON referrals(referred_email);

-- Indexes existants à ajouter (PERFORMANCE!)
CREATE INDEX IF NOT EXISTS idx_codes_code ON codes(code);
CREATE INDEX IF NOT EXISTS idx_codes_cell ON codes(cell_x, cell_y);
CREATE INDEX IF NOT EXISTS idx_codes_user_id ON codes(user_id);
CREATE INDEX IF NOT EXISTS idx_codes_updated_at ON codes(updated_at DESC);
```

**Fichier à créer:** `server/migration_commercial.sql`

---

#### B. Backend - Logique Métier ✅ PRIORITÉ 2

**1. Service Paliers** (`server/services/tierService.js`)

```javascript
// Calculer le palier actuel basé sur tickets vendus
export async function getCurrentTier(client) {
  // Compter tickets payés
  const result = await client.query(
    "SELECT COUNT(*)::int as count FROM tickets WHERE status = 'paid'"
  );
  const ticketCount = result.rows[0].count;

  // Trouver le bon palier
  const tierResult = await client.query(
    `SELECT * FROM tiers
     WHERE $1 >= min_tickets AND $1 < max_tickets
     AND is_active = TRUE
     ORDER BY tier_number ASC
     LIMIT 1`,
    [ticketCount]
  );

  return tierResult.rows[0] || null;
}

// Calculer si on doit changer de palier
export async function checkTierUpgrade(client) {
  const currentTier = await getCurrentTier(client);
  const configTier = await getConfigTier(client);

  if (!currentTier || !configTier) return false;

  // Palier supérieur atteint?
  if (currentTier.tier_number > configTier.tier_number) {
    return {
      shouldUpgrade: true,
      newTier: currentTier,
      oldTier: configTier
    };
  }

  return { shouldUpgrade: false };
}

// Appliquer le nouveau palier (resize grille)
export async function upgradeTier(client, newTier) {
  await client.query("BEGIN");
  try {
    // Update config avec nouvelles dimensions
    await client.query(
      `UPDATE config
       SET grid_w = $1, grid_h = $2, state_version = state_version + 1
       WHERE id = TRUE`,
      [newTier.grid_width, newTier.grid_height]
    );

    // Note: Les anciennes cases (cell_x, cell_y) restent valides
    // Les nouvelles cases seront dans les zones ajoutées autour

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function getConfigTier(client) {
  const result = await client.query(
    "SELECT grid_w, grid_h FROM config WHERE id = TRUE"
  );
  const config = result.rows[0];

  const tierResult = await client.query(
    "SELECT * FROM tiers WHERE grid_width = $1 AND grid_height = $2 LIMIT 1",
    [config.grid_w, config.grid_h]
  );

  return tierResult.rows[0];
}
```

**2. Service Tickets** (`server/services/ticketService.js`)

```javascript
export async function createTicket(client, data) {
  const { email, amount, paymentProvider, tier } = data;

  // Générer order_id unique
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Insérer ticket
  const result = await client.query(
    `INSERT INTO tickets (order_id, email, amount, payment_provider, tier_id, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [orderId, email, amount, paymentProvider, tier.id]
  );

  return result.rows[0];
}

export async function confirmTicketPayment(client, ticketId) {
  await client.query("BEGIN");
  try {
    // Marquer ticket comme payé
    await client.query(
      `UPDATE tickets
       SET status = 'paid', paid_at = NOW()
       WHERE id = $1`,
      [ticketId]
    );

    // Générer code pour ce ticket
    const code = generateCode();
    const codeResult = await client.query(
      `INSERT INTO codes (code, created_at)
       VALUES ($1, NOW())
       RETURNING id`,
      [code]
    );

    // Lier code au ticket
    await client.query(
      `UPDATE tickets SET code_id = $1 WHERE id = $2`,
      [codeResult.rows[0].id, ticketId]
    );

    // Vérifier si changement de palier
    const tierCheck = await checkTierUpgrade(client);
    if (tierCheck.shouldUpgrade) {
      await upgradeTier(client, tierCheck.newTier);
      // Broadcast nouveau palier
      io.emit('tier_upgraded', {
        newTier: tierCheck.newTier,
        oldTier: tierCheck.oldTier
      });
    }

    await client.query("COMMIT");
    return { code, ticket: ticketId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
```

**3. API Routes** (`server/routes/payment.js`)

```javascript
// ===== PAYMENT ROUTES =====

// Créer une session de paiement (TO DO: Intégrer Stripe/PayPal)
app.post("/api/payment/create-checkout", rateLimit(10, 60000), async (req, res) => {
  const { email, quantity = 1 } = req.body;

  const emailValidation = validateEmail(email);
  if (!emailValidation.valid) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const client = await pool.connect();
  try {
    const tier = await getCurrentTier(client);
    if (!tier) {
      return res.status(400).json({ error: 'no_tier_available' });
    }

    const amount = 2.00 * quantity; // 2€ par ticket

    // Créer ticket(s)
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = await createTicket(client, {
        email: emailValidation.email,
        amount: 2.00,
        paymentProvider: 'manual', // TO DO: 'stripe' quand intégré
        tier
      });
      tickets.push(ticket);
    }

    // TO DO: Créer session Stripe Checkout
    // const session = await stripe.checkout.sessions.create({...});

    res.json({
      ok: true,
      tickets: tickets.map(t => t.order_id),
      // checkout_url: session.url // TO DO
    });
  } catch (err) {
    log('error', 'Create checkout error', { error: err.message });
    res.status(500).json({ error: 'checkout_error' });
  } finally {
    client.release();
  }
});

// Webhook paiement confirmé (TO DO: Stripe webhook)
app.post("/api/payment/webhook", async (req, res) => {
  // TO DO: Vérifier signature Stripe
  // const sig = req.headers['stripe-signature'];

  const { order_id, status } = req.body;

  if (status !== 'paid') {
    return res.json({ ok: true });
  }

  const client = await pool.connect();
  try {
    const ticketResult = await client.query(
      "SELECT id, email FROM tickets WHERE order_id = $1",
      [order_id]
    );

    if (ticketResult.rowCount === 0) {
      return res.status(404).json({ error: 'ticket_not_found' });
    }

    const ticket = ticketResult.rows[0];
    const { code } = await confirmTicketPayment(client, ticket.id);

    // Envoyer email avec code
    // await sendTicketEmail(ticket.email, code); // TO DO

    log('info', 'Ticket payment confirmed', { order_id, email: ticket.email });

    res.json({ ok: true });
  } catch (err) {
    log('error', 'Webhook error', { error: err.message });
    res.status(500).json({ error: 'webhook_error' });
  } finally {
    client.release();
  }
});

// Récupérer infos ticket
app.get("/api/ticket/:orderId", async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT t.*, c.code
       FROM tickets t
       LEFT JOIN codes c ON t.code_id = c.id
       WHERE t.order_id = $1`,
      [orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ticket_not_found' });
    }

    const ticket = result.rows[0];
    res.json({
      ok: true,
      ticket: {
        order_id: ticket.order_id,
        status: ticket.status,
        amount: ticket.amount,
        code: ticket.status === 'paid' ? ticket.code : null,
        created_at: ticket.created_at,
        paid_at: ticket.paid_at
      }
    });
  } catch (err) {
    log('error', 'Get ticket error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});
```

---

#### C. Système de Tirage au Sort ✅ PRIORITÉ 3

**Service Lottery** (`server/services/lotteryService.js`)

```javascript
// Créer un tirage pour un palier
export async function createPrizeDraw(client, tierId, prizeAmount, prizeType = 'main') {
  const result = await client.query(
    `INSERT INTO prizes (tier_id, name, amount, prize_type, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [tierId, `Gain ${prizeType} - Palier ${tierId}`, prizeAmount, prizeType]
  );

  return result.rows[0];
}

// Effectuer le tirage au sort
export async function drawPrize(client, prizeId) {
  await client.query("BEGIN");
  try {
    // Récupérer le prize
    const prizeResult = await client.query(
      "SELECT * FROM prizes WHERE id = $1 AND status = 'pending'",
      [prizeId]
    );

    if (prizeResult.rowCount === 0) {
      throw new Error('Prize not found or already drawn');
    }

    const prize = prizeResult.rows[0];

    // Récupérer tous les tickets éligibles (payés)
    const ticketsResult = await client.query(
      `SELECT id FROM tickets
       WHERE tier_id = $1 AND status = 'paid'
       ORDER BY RANDOM()
       LIMIT 1`,
      [prize.tier_id]
    );

    if (ticketsResult.rowCount === 0) {
      throw new Error('No eligible tickets');
    }

    const winnerTicket = ticketsResult.rows[0];

    // Marquer le prize comme tiré
    await client.query(
      `UPDATE prizes
       SET winner_ticket_id = $1, status = 'drawn', draw_date = NOW()
       WHERE id = $2`,
      [winnerTicket.id, prizeId]
    );

    await client.query("COMMIT");

    // Récupérer infos du gagnant
    const winnerInfo = await client.query(
      `SELECT t.email, t.order_id, c.code
       FROM tickets t
       LEFT JOIN codes c ON t.code_id = c.id
       WHERE t.id = $1`,
      [winnerTicket.id]
    );

    return {
      prize,
      winner: winnerInfo.rows[0]
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
```

**Admin API** (ajout dans `server/index.js`)

```javascript
// Admin: Créer un tirage
app.post("/api/admin/prizes/create", requireAdmin, async (req, res) => {
  const { tier_id, amount, prize_type } = req.body;

  const client = await pool.connect();
  try {
    const prize = await createPrizeDraw(client, tier_id, amount, prize_type);
    log('info', 'Prize created', { prize_id: prize.id, tier_id, amount });
    res.json({ ok: true, prize });
  } catch (err) {
    log('error', 'Create prize error', { error: err.message });
    res.status(500).json({ error: 'create_prize_error' });
  } finally {
    client.release();
  }
});

// Admin: Effectuer un tirage
app.post("/api/admin/prizes/:prizeId/draw", requireAdmin, async (req, res) => {
  const { prizeId } = req.params;

  const client = await pool.connect();
  try {
    const result = await drawPrize(client, prizeId);

    // Broadcast le résultat
    io.emit('prize_drawn', {
      prize_id: prizeId,
      winner_email: result.winner.email
    });

    // TO DO: Envoyer email au gagnant

    log('info', 'Prize drawn', { prize_id: prizeId, winner: result.winner.email });
    res.json({ ok: true, result });
  } catch (err) {
    log('error', 'Draw prize error', { error: err.message });
    res.status(500).json({ error: 'draw_error' });
  } finally {
    client.release();
  }
});

// Liste des prizes
app.get("/api/admin/prizes", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT
        p.*,
        t.tier_number,
        tk.email as winner_email,
        tk.order_id as winner_order_id
      FROM prizes p
      LEFT JOIN tiers t ON p.tier_id = t.id
      LEFT JOIN tickets tk ON p.winner_ticket_id = tk.id
      ORDER BY p.created_at DESC
    `);

    res.json({ ok: true, prizes: result.rows });
  } catch (err) {
    log('error', 'Get prizes error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  } finally {
    client.release();
  }
});
```

---

#### D. Système de Parrainage ✅ PRIORITÉ 4

**Service Referral** (`server/services/referralService.js`)

```javascript
export async function createReferral(client, referrerUserId, referredEmail) {
  const result = await client.query(
    `INSERT INTO referrals (referrer_user_id, referred_email, status)
     VALUES ($1, $2, 'pending')
     RETURNING *`,
    [referrerUserId, referredEmail]
  );

  return result.rows[0];
}

export async function completeReferral(client, referralId, referredUserId) {
  await client.query("BEGIN");
  try {
    // Générer code gratuit
    const code = generateCode();
    const codeResult = await client.query(
      `INSERT INTO codes (code, created_at)
       VALUES ($1, NOW())
       RETURNING id`,
      [code]
    );

    // Marquer referral comme complété
    await client.query(
      `UPDATE referrals
       SET referred_user_id = $1, free_ticket_code_id = $2, status = 'completed', completed_at = NOW()
       WHERE id = $3`,
      [referredUserId, codeResult.rows[0].id, referralId]
    );

    await client.query("COMMIT");
    return code;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
```

---

### 🟡 **PHASE 2: FRONTEND COMMERCIAL** (1-2 semaines)

#### E. Landing Page Commerciale

**Pages à créer:**

1. **`/landing.html`** - Page d'accueil commerciale
   ```html
   Sections:
   - Hero: "Participe à la Plus Grande Fresque Collaborative"
   - Comment ça marche (3 étapes)
   - Paliers et Gains (tableau)
   - CTA: "Acheter un Ticket - 2€"
   - FAQ
   - Footer (légal, contact)
   ```

2. **`/buy.html`** - Page d'achat de tickets
   ```html
   - Sélection quantité (1, 5, 10 tickets)
   - Affichage palier actuel
   - Prix total
   - Email
   - CTA: "Payer" (redirect Stripe)
   ```

3. **`/winners.html`** - Page gagnants
   ```html
   - Liste des tirages effectués
   - Gagnants (email partiel pour confidentialité)
   - Montants gagnés
   - Transparence
   ```

4. **`/my-tickets.html`** - Page mes tickets
   ```html
   - Liste tickets achetés (via email)
   - Statut (pending, paid)
   - Codes reçus
   - Référence commande
   ```

5. **`/legal/*`** - Pages légales
   ```html
   - /legal/terms - CGV
   - /legal/privacy - Confidentialité
   - /legal/rules - Règlement du jeu
   ```

---

#### F. Email System (TO DO)

**Service:** SendGrid, Mailgun, ou Resend

**Templates:**
1. Email confirmation achat
2. Email code reçu
3. Email nouveau palier atteint
4. Email gagnant du tirage
5. Email parrainage (code gratuit)

---

#### G. Admin Dashboard Enrichi

**Nouvelles sections dans `/admin.html`:**

1. **Gestion Paliers**
   - Palier actuel
   - Progression (tickets vendus / objectif)
   - Historique changements palier

2. **Gestion Tickets**
   - Liste achats
   - Filtres (paid, pending, refunded)
   - Search par email/order_id
   - Export CSV

3. **Gestion Tirages**
   - Créer nouveau tirage
   - Effectuer tirage au sort
   - Liste gagnants
   - Statut (pending, drawn, paid)

4. **Analytics Business**
   - CA total
   - Tickets vendus
   - Taux de conversion
   - Revenus par palier

---

### 🟢 **PHASE 3: PRODUCTION & LAUNCH** (1 semaine)

#### H. Pré-Launch Checklist

```
Infrastructure:
- [ ] Hébergement production (Render, Railway, Vercel)
- [ ] Database backup automatique
- [ ] CDN (Cloudflare)
- [ ] Monitoring (Sentry)
- [ ] Redis pour cache distribué

Paiement:
- [ ] Compte Stripe/PayPal configuré
- [ ] Test mode → Live mode
- [ ] Webhooks configurés
- [ ] TVA configurée

Emails:
- [ ] Service email (SendGrid)
- [ ] Templates testés
- [ ] DKIM/SPF configurés

Légal:
- [ ] CGV validées par avocat
- [ ] Règlement du jeu publié
- [ ] Mentions légales complètes
- [ ] Conformité RGPD

Performance:
- [ ] Indexes DB créés
- [ ] Cache activé
- [ ] Images optimisées
- [ ] Tests de charge

Sécurité:
- [ ] HTTPS activé
- [ ] Rate limiting prod
- [ ] Admin 2FA
- [ ] Logs configurés
```

---

## 🎯 RÉCAPITULATIF - TO DO LIST

### Sprint 1 (Semaine 1)
```
Backend:
- [x] Créer migration_commercial.sql
- [ ] Exécuter migration sur Supabase
- [ ] Créer tierService.js
- [ ] Créer ticketService.js
- [ ] Créer lotteryService.js
- [ ] API /api/payment/create-checkout
- [ ] API /api/payment/webhook (mock)
- [ ] API /api/ticket/:orderId

Frontend:
- [ ] Page /buy.html (achat tickets)
- [ ] Page /my-tickets.html
- [ ] Admin: Section paliers
- [ ] Admin: Section tickets
```

### Sprint 2 (Semaine 2)
```
Backend:
- [ ] Créer referralService.js
- [ ] API parrainage
- [ ] Service email (SendGrid)
- [ ] Templates email

Frontend:
- [ ] Landing page complète
- [ ] Page /winners.html
- [ ] Admin: Section tirages
- [ ] Admin: Analytics business
```

### Sprint 3 (Semaine 3)
```
Intégration:
- [ ] Intégrer Stripe (test mode)
- [ ] Tester flux complet achat
- [ ] Webhook Stripe

Légal & Content:
- [ ] Rédiger CGV
- [ ] Rédiger règlement
- [ ] Pages légales

Polish:
- [ ] Design landing page
- [ ] Animations
- [ ] Mobile responsive
```

### Sprint 4 (Semaine 4)
```
Production:
- [ ] Setup infrastructure prod
- [ ] Stripe live mode
- [ ] Tests de charge
- [ ] Monitoring
- [ ] Beta fermée (50 users)
```

---

## 💰 Budget Estimé

```
Développement: Fait maison (0€)
Hébergement: 20-50€/mois (Render/Railway)
Database: 25€/mois (Supabase Pro)
Email: 10€/mois (SendGrid)
Paiement: 1.4% + 0.25€ par transaction (Stripe)
Légal: 500-1000€ (avocat CGV + règlement)
Marketing: Variable

Total setup: ~1500€
Total récurrent: ~55€/mois
```

---

## 📊 Métriques de Succès

### KPIs à Suivre
- Taux de conversion (visiteurs → acheteurs)
- Panier moyen (tickets par achat)
- Taux de parrainage
- Engagement (cases peintes / tickets vendus)
- CA par palier
- Coût acquisition client (CAC)

### Objectifs V1
- Palier 3 atteint (100k tickets = 200k€ CA)
- 10% taux parrainage
- 80% tickets utilisés (cases peintes)
- <5% refunds

---

**🚀 PRÊT À DÉMARRER?**

Quelle task tu veux qu'on tackle en premier?

Options:
1. Migration DB + Services backend
2. Landing page + Buy page
3. Admin dashboard enrichi
4. Autre chose?
