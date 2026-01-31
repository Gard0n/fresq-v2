// FRESQ V2 - Pack Service
// Gestion des packs de tickets (multi-tickets avec bonus)

import { generateCode } from '../utils.js';
import { getCurrentTier, checkTierUpgrade, upgradeTier } from './tierService.js';

/**
 * Get all available packs
 * @param {object} client - PostgreSQL client
 * @returns {Promise<Array>} List of active packs
 */
export async function getAvailablePacks(client) {
  try {
    const result = await client.query(`
      SELECT *
      FROM pack_configs
      WHERE is_active = TRUE
      ORDER BY display_order ASC
    `);

    return result.rows;
  } catch (error) {
    console.error('[PackService] Error getting available packs:', error);
    throw error;
  }
}

/**
 * Get pack by key
 * @param {object} client - PostgreSQL client
 * @param {string} packKey - Pack key (solo, mini, medium, mega, ultra)
 * @returns {Promise<object|null>} Pack config or null
 */
export async function getPackByKey(client, packKey) {
  try {
    const result = await client.query(`
      SELECT *
      FROM pack_configs
      WHERE pack_key = $1 AND is_active = TRUE
    `, [packKey]);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[PackService] Error getting pack:', error);
    throw error;
  }
}

/**
 * Create a pack purchase (creates ticket with quantity)
 * @param {object} client - PostgreSQL client
 * @param {object} params - Purchase parameters
 * @param {string} params.email - Buyer email
 * @param {string} params.packKey - Pack key
 * @param {string} params.paymentProvider - Payment provider (default 'manual')
 * @param {string} params.paymentSessionId - Optional payment session ID
 * @returns {Promise<object>} Created ticket with pack info
 */
export async function createPackPurchase(client, { email, packKey, paymentProvider = 'manual', paymentSessionId = null }) {
  try {
    // Validate pack exists and is active
    const pack = await getPackByKey(client, packKey);

    if (!pack) {
      throw new Error(`Pack '${packKey}' not found or inactive`);
    }

    // Validate email
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email');
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Get or create user
    let userId = null;
    const userResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (userResult.rows.length > 0) {
      userId = userResult.rows[0].id;
    } else {
      // Create new user
      const newUserResult = await client.query(
        'INSERT INTO users (email) VALUES ($1) RETURNING id',
        [normalizedEmail]
      );
      userId = newUserResult.rows[0].id;
    }

    // Get current tier
    const currentTier = await getCurrentTier(client);

    if (!currentTier) {
      throw new Error('No tier available');
    }

    // Generate unique order ID
    const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();

    // Create ticket with quantity breakdown
    const ticketResult = await client.query(`
      INSERT INTO tickets (
        order_id,
        payment_provider,
        payment_session_id,
        email,
        user_id,
        amount,
        quantity,
        base_quantity,
        bonus_quantity,
        status,
        tier_id,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, NOW())
      RETURNING *
    `, [
      orderId,
      paymentProvider,
      paymentSessionId,
      normalizedEmail,
      userId,
      pack.price,
      pack.total_tickets,
      pack.base_tickets,
      pack.bonus_tickets,
      currentTier.id
    ]);

    const ticket = ticketResult.rows[0];

    return {
      ticket,
      pack: {
        key: pack.pack_key,
        label: pack.label,
        totalTickets: pack.total_tickets,
        baseTickets: pack.base_tickets,
        bonusTickets: pack.bonus_tickets,
        price: pack.price
      }
    };
  } catch (error) {
    console.error('[PackService] Error creating pack purchase:', error);
    throw error;
  }
}

/**
 * Confirm pack purchase and generate all codes
 * @param {object} client - PostgreSQL client
 * @param {string} orderId - Order ID
 * @returns {Promise<object>} Confirmed ticket with generated codes
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
      throw new Error('Ticket already paid');
    }

    const baseQuantity = ticket.base_quantity || 1;
    const bonusQuantity = ticket.bonus_quantity || 0;
    const totalQuantity = baseQuantity + bonusQuantity;

    // Generate codes: purchased codes first, then bonus codes
    const codes = [];
    const codeIds = [];
    const purchasedCodes = [];
    const bonusCodes = [];

    // Generate PURCHASED codes (base_quantity)
    for (let i = 0; i < baseQuantity; i++) {
      const code = generateCode();

      const codeResult = await client.query(`
        INSERT INTO codes (code, user_id, source)
        VALUES ($1, $2, 'purchased')
        RETURNING id
      `, [code, ticket.user_id]);

      const codeId = codeResult.rows[0].id;
      codes.push(code);
      codeIds.push(codeId);
      purchasedCodes.push(code);
    }

    // Generate BONUS codes (bonus_quantity)
    for (let i = 0; i < bonusQuantity; i++) {
      const code = generateCode();

      const codeResult = await client.query(`
        INSERT INTO codes (code, user_id, source)
        VALUES ($1, $2, 'pack_bonus')
        RETURNING id
      `, [code, ticket.user_id]);

      const codeId = codeResult.rows[0].id;
      codes.push(code);
      codeIds.push(codeId);
      bonusCodes.push(code);
    }

    // Get current tier before payment
    const tierBeforePayment = await getCurrentTier(client);

    // Update ticket to paid status (link first code as primary)
    await client.query(`
      UPDATE tickets
      SET
        status = 'paid',
        code_id = $1,
        paid_at = NOW()
      WHERE order_id = $2
    `, [codeIds[0], orderId]);

    // Check if tier upgrade is needed (based on quantity)
    let tierUpgradeResult = null;
    if (tierBeforePayment) {
      const newTier = await checkTierUpgrade(client, tierBeforePayment.tier_number);

      if (newTier) {
        // Perform tier upgrade
        tierUpgradeResult = await upgradeTier(client, newTier);
      }
    }

    // Get updated ticket
    const updatedTicketResult = await client.query(
      'SELECT * FROM tickets WHERE order_id = $1',
      [orderId]
    );

    return {
      ticket: updatedTicketResult.rows[0],
      codes,
      codeIds,
      purchasedCodes,
      bonusCodes,
      totalCodes: totalQuantity,
      baseQuantity,
      bonusQuantity,
      tierUpgrade: tierUpgradeResult
    };
  } catch (error) {
    console.error('[PackService] Error confirming pack purchase:', error);
    throw error;
  }
}

/**
 * Get pack statistics
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Pack purchase stats
 */
export async function getPackStats(client) {
  try {
    const result = await client.query(`
      SELECT
        pc.pack_key,
        pc.label,
        pc.price,
        pc.total_tickets,
        COUNT(t.id) FILTER (WHERE t.status = 'paid') as purchases_count,
        SUM(t.quantity) FILTER (WHERE t.status = 'paid') as total_tickets_sold,
        SUM(t.amount) FILTER (WHERE t.status = 'paid') as total_revenue
      FROM pack_configs pc
      LEFT JOIN tickets t ON t.quantity = pc.total_tickets AND t.amount = pc.price
      WHERE pc.is_active = TRUE
      GROUP BY pc.id, pc.pack_key, pc.label, pc.price, pc.total_tickets
      ORDER BY pc.display_order ASC
    `);

    return result.rows;
  } catch (error) {
    console.error('[PackService] Error getting pack stats:', error);
    throw error;
  }
}

/**
 * Update pack configuration (admin)
 * @param {object} client - PostgreSQL client
 * @param {string} packKey - Pack key
 * @param {object} updates - Fields to update
 * @returns {Promise<object>} Updated pack config
 */
export async function updatePackConfig(client, packKey, updates) {
  try {
    const allowedFields = ['label', 'base_tickets', 'bonus_tickets', 'total_tickets', 'price', 'is_active', 'display_order'];
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

    // Add updated_at
    updateFields.push(`updated_at = NOW()`);

    // Add pack_key to values
    values.push(packKey);

    const query = `
      UPDATE pack_configs
      SET ${updateFields.join(', ')}
      WHERE pack_key = $${paramIndex}
      RETURNING *
    `;

    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('Pack not found');
    }

    // Recalculate discount_percent if price or total_tickets changed
    if (updates.price || updates.total_tickets) {
      await client.query(`
        UPDATE pack_configs
        SET discount_percent = (
          CASE
            WHEN total_tickets = 1 THEN 0
            ELSE ROUND((1 - (price / total_tickets) / 2.00) * 100)
          END
        )
        WHERE pack_key = $1
      `, [packKey]);
    }

    // Get updated pack
    const updatedResult = await client.query(
      'SELECT * FROM pack_configs WHERE pack_key = $1',
      [packKey]
    );

    return updatedResult.rows[0];
  } catch (error) {
    console.error('[PackService] Error updating pack config:', error);
    throw error;
  }
}

/**
 * Create a new pack configuration (admin)
 * @param {object} client - PostgreSQL client
 * @param {object} packData - Pack configuration
 * @returns {Promise<object>} Created pack config
 */
export async function createPackConfig(client, packData) {
  try {
    const { packKey, label, baseTickets, bonusTickets, price, displayOrder } = packData;

    if (!packKey || !label || !baseTickets || price === undefined) {
      throw new Error('Missing required fields');
    }

    const totalTickets = baseTickets + (bonusTickets || 0);

    const result = await client.query(`
      INSERT INTO pack_configs (
        pack_key,
        label,
        base_tickets,
        bonus_tickets,
        total_tickets,
        price,
        display_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [packKey, label, baseTickets, bonusTickets || 0, totalTickets, price, displayOrder || 0]);

    // Calculate discount_percent
    await client.query(`
      UPDATE pack_configs
      SET discount_percent = (
        CASE
          WHEN total_tickets = 1 THEN 0
          ELSE ROUND((1 - (price / total_tickets) / 2.00) * 100)
        END
      )
      WHERE pack_key = $1
    `, [packKey]);

    // Get updated pack
    const updatedResult = await client.query(
      'SELECT * FROM pack_configs WHERE pack_key = $1',
      [packKey]
    );

    return updatedResult.rows[0];
  } catch (error) {
    console.error('[PackService] Error creating pack config:', error);
    throw error;
  }
}

/**
 * Delete pack configuration (admin)
 * @param {object} client - PostgreSQL client
 * @param {string} packKey - Pack key
 * @returns {Promise<boolean>} Success status
 */
export async function deletePackConfig(client, packKey) {
  try {
    await client.query('DELETE FROM pack_configs WHERE pack_key = $1', [packKey]);
    return true;
  } catch (error) {
    console.error('[PackService] Error deleting pack config:', error);
    throw error;
  }
}
