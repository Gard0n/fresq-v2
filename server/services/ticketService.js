// FRESQ V2 - Ticket Service
// Gestion des tickets (achats) - Mode manuel/test (sans paiement)

import { generateCode } from '../utils.js';
import { getCurrentTier, checkTierUpgrade, upgradeTier } from './tierService.js';

/**
 * Create a new ticket order
 * @param {object} client - PostgreSQL client
 * @param {object} params - Ticket parameters
 * @param {string} params.email - Buyer email
 * @param {number} params.amount - Amount paid (default 2.00€)
 * @param {string} params.paymentProvider - Payment provider (default 'manual')
 * @param {string} params.paymentSessionId - Optional payment session ID
 * @returns {Promise<object>} Created ticket
 */
export async function createTicket(client, { email, amount = 2.00, paymentProvider = 'manual', paymentSessionId = null }) {
  try {
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

    // Get current tier to associate with ticket
    const currentTier = await getCurrentTier(client);

    if (!currentTier) {
      throw new Error('No tier available');
    }

    // Generate unique order ID
    const orderId = `ORDER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase();

    // Create ticket with pending status (solo ticket: 1 paid, 0 bonus)
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
      VALUES ($1, $2, $3, $4, $5, $6, 1, 1, 0, 'pending', $7, NOW())
      RETURNING *
    `, [orderId, paymentProvider, paymentSessionId, normalizedEmail, userId, amount, currentTier.id]);

    return ticketResult.rows[0];
  } catch (error) {
    console.error('[TicketService] Error creating ticket:', error);
    throw error;
  }
}

/**
 * Confirm ticket payment and generate associated code
 * @param {object} client - PostgreSQL client
 * @param {string} orderId - Order ID
 * @returns {Promise<object>} Updated ticket with code
 */
export async function confirmTicketPayment(client, orderId) {
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

    // Generate code for this ticket
    const code = generateCode();

    // Insert code in codes table (source = purchased for paid tickets)
    const codeResult = await client.query(`
      INSERT INTO codes (code, user_id, source)
      VALUES ($1, $2, 'purchased')
      RETURNING id
    `, [code, ticket.user_id]);

    const codeId = codeResult.rows[0].id;

    // Get current tier before payment
    const tierBeforePayment = await getCurrentTier(client);

    // Update ticket to paid status
    await client.query(`
      UPDATE tickets
      SET
        status = 'paid',
        code_id = $1,
        paid_at = NOW()
      WHERE order_id = $2
    `, [codeId, orderId]);

    // Check if tier upgrade is needed
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
      code,
      codeId,
      tierUpgrade: tierUpgradeResult
    };
  } catch (error) {
    console.error('[TicketService] Error confirming ticket payment:', error);
    throw error;
  }
}

/**
 * Get ticket by order ID
 * @param {object} client - PostgreSQL client
 * @param {string} orderId - Order ID
 * @returns {Promise<object|null>} Ticket or null
 */
export async function getTicketByOrderId(client, orderId) {
  try {
    const result = await client.query(`
      SELECT
        t.*,
        c.code,
        u.email as user_email,
        tier.tier_number,
        tier.prize_amount
      FROM tickets t
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN tiers tier ON t.tier_id = tier.id
      WHERE t.order_id = $1
    `, [orderId]);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[TicketService] Error getting ticket:', error);
    throw error;
  }
}

/**
 * Get all tickets for a user by email
 * @param {object} client - PostgreSQL client
 * @param {string} email - User email
 * @returns {Promise<Array>} List of tickets
 */
export async function getUserTickets(client, email) {
  try {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await client.query(`
      SELECT
        t.*,
        c.code,
        tier.tier_number,
        tier.prize_amount
      FROM tickets t
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON t.tier_id = tier.id
      WHERE t.email = $1
      ORDER BY t.created_at DESC
    `, [normalizedEmail]);

    return result.rows;
  } catch (error) {
    console.error('[TicketService] Error getting user tickets:', error);
    throw error;
  }
}

/**
 * Cancel/refund a ticket
 * @param {object} client - PostgreSQL client
 * @param {string} orderId - Order ID
 * @returns {Promise<object>} Updated ticket
 */
export async function cancelTicket(client, orderId) {
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

    if (ticket.status === 'refunded' || ticket.status === 'cancelled') {
      throw new Error('Ticket already cancelled or refunded');
    }

    // RÈGLE: Bloquer remboursement des packs (quantity > 1)
    if ((ticket.quantity || 1) > 1) {
      throw new Error('Cannot refund pack purchases. Please contact support.');
    }

    // If ticket was paid, we need to handle the code
    if (ticket.status === 'paid' && ticket.code_id) {
      // Check code status
      const codeResult = await client.query(
        'SELECT * FROM codes WHERE id = $1',
        [ticket.code_id]
      );

      if (codeResult.rows.length > 0) {
        const code = codeResult.rows[0];

        // RÈGLE: Bloquer remboursement si case PEINTE (color !== null)
        if (code.color !== null) {
          throw new Error('Cannot refund: cell already painted');
        }

        // Si case sélectionnée mais NON peinte (cell_x/y SET, color NULL)
        // → Permettre remboursement mais garder la case pour l'user
        if (code.cell_x !== null && code.cell_y !== null) {
          throw new Error('Cannot refund: cell position already claimed. Contact support.');
        }

        // Si code réclamé mais case non sélectionnée (cell_x/y NULL)
        // → Safe to delete
        await client.query('DELETE FROM codes WHERE id = $1', [ticket.code_id]);
      }
    }

    // Update ticket status
    const newStatus = ticket.status === 'paid' ? 'refunded' : 'cancelled';

    await client.query(`
      UPDATE tickets
      SET
        status = $1,
        refunded_at = NOW()
      WHERE order_id = $2
    `, [newStatus, orderId]);

    // Get updated ticket
    const updatedResult = await client.query(
      'SELECT * FROM tickets WHERE order_id = $1',
      [orderId]
    );

    return updatedResult.rows[0];
  } catch (error) {
    console.error('[TicketService] Error cancelling ticket:', error);
    throw error;
  }
}

/**
 * Get ticket statistics
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Ticket stats
 */
export async function getTicketStats(client) {
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'paid') as paid,
        COUNT(*) FILTER (WHERE status = 'refunded') as refunded,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) as total,
        SUM(amount) FILTER (WHERE status = 'paid') as total_revenue
      FROM tickets
    `);

    return result.rows[0];
  } catch (error) {
    console.error('[TicketService] Error getting ticket stats:', error);
    throw error;
  }
}

/**
 * Get recent tickets (for admin dashboard)
 * @param {object} client - PostgreSQL client
 * @param {number} limit - Number of tickets to return
 * @returns {Promise<Array>} Recent tickets
 */
export async function getRecentTickets(client, limit = 10) {
  try {
    const result = await client.query(`
      SELECT
        t.*,
        c.code,
        tier.tier_number
      FROM tickets t
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON t.tier_id = tier.id
      ORDER BY t.created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    console.error('[TicketService] Error getting recent tickets:', error);
    throw error;
  }
}

/**
 * Bulk create tickets (for testing/manual entry)
 * @param {object} client - PostgreSQL client
 * @param {Array} tickets - Array of ticket objects
 * @returns {Promise<Array>} Created tickets
 */
export async function bulkCreateTickets(client, tickets) {
  try {
    const createdTickets = [];

    for (const ticketData of tickets) {
      const ticket = await createTicket(client, ticketData);
      createdTickets.push(ticket);
    }

    return createdTickets;
  } catch (error) {
    console.error('[TicketService] Error bulk creating tickets:', error);
    throw error;
  }
}
