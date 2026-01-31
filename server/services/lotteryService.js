// FRESQ V2 - Lottery Service
// Gestion des tirages au sort et des gains

/**
 * Create a new prize draw for a tier
 * @param {object} client - PostgreSQL client
 * @param {object} params - Prize parameters
 * @param {number} params.tierId - Tier ID
 * @param {string} params.name - Prize name
 * @param {number} params.amount - Prize amount
 * @param {string} params.prizeType - Prize type (main, secondary, daily)
 * @param {Date} params.drawDate - Scheduled draw date (optional)
 * @returns {Promise<object>} Created prize
 */
export async function createPrizeDraw(client, { tierId, name, amount, prizeType = 'main', drawDate = null }) {
  try {
    // Validate tier exists
    const tierResult = await client.query(
      'SELECT * FROM tiers WHERE id = $1',
      [tierId]
    );

    if (tierResult.rows.length === 0) {
      throw new Error('Tier not found');
    }

    const tier = tierResult.rows[0];

    // If no amount specified, use tier's prize amount
    const prizeAmount = amount || tier.prize_amount;

    // If no name specified, generate one
    const prizeName = name || `Gain ${prizeType === 'main' ? 'Principal' : 'Secondaire'} Palier ${tier.tier_number}`;

    // Create prize
    const result = await client.query(`
      INSERT INTO prizes (
        tier_id,
        name,
        amount,
        prize_type,
        draw_date,
        status,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
      RETURNING *
    `, [tierId, prizeName, prizeAmount, prizeType, drawDate]);

    return result.rows[0];
  } catch (error) {
    console.error('[LotteryService] Error creating prize draw:', error);
    throw error;
  }
}

/**
 * Draw a prize - randomly select a winner from eligible tickets
 * @param {object} client - PostgreSQL client
 * @param {number} prizeId - Prize ID
 * @returns {Promise<object>} Prize with winner information
 */
export async function drawPrize(client, prizeId) {
  try {
    // Get prize
    const prizeResult = await client.query(
      'SELECT * FROM prizes WHERE id = $1',
      [prizeId]
    );

    if (prizeResult.rows.length === 0) {
      throw new Error('Prize not found');
    }

    const prize = prizeResult.rows[0];

    if (prize.status !== 'pending') {
      throw new Error('Prize already drawn');
    }

    // Get all eligible tickets for this tier (paid tickets)
    const eligibleTicketsResult = await client.query(`
      SELECT id
      FROM tickets
      WHERE tier_id = $1
        AND status = 'paid'
      ORDER BY RANDOM()
      LIMIT 1
    `, [prize.tier_id]);

    if (eligibleTicketsResult.rows.length === 0) {
      throw new Error('No eligible tickets for this tier');
    }

    const winnerTicketId = eligibleTicketsResult.rows[0].id;

    // Update prize with winner
    await client.query(`
      UPDATE prizes
      SET
        winner_ticket_id = $1,
        status = 'drawn',
        draw_date = NOW()
      WHERE id = $2
    `, [winnerTicketId, prizeId]);

    // Get complete prize information with winner details
    const updatedPrizeResult = await client.query(`
      SELECT
        p.*,
        t.order_id as winner_order_id,
        t.email as winner_email,
        t.user_id as winner_user_id,
        c.code as winner_code,
        tier.tier_number
      FROM prizes p
      LEFT JOIN tickets t ON p.winner_ticket_id = t.id
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON p.tier_id = tier.id
      WHERE p.id = $1
    `, [prizeId]);

    return updatedPrizeResult.rows[0];
  } catch (error) {
    console.error('[LotteryService] Error drawing prize:', error);
    throw error;
  }
}

/**
 * Get prize by ID with full details
 * @param {object} client - PostgreSQL client
 * @param {number} prizeId - Prize ID
 * @returns {Promise<object|null>} Prize or null
 */
export async function getPrizeById(client, prizeId) {
  try {
    const result = await client.query(`
      SELECT
        p.*,
        t.order_id as winner_order_id,
        t.email as winner_email,
        t.user_id as winner_user_id,
        c.code as winner_code,
        tier.tier_number,
        tier.prize_amount as tier_prize_amount
      FROM prizes p
      LEFT JOIN tickets t ON p.winner_ticket_id = t.id
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON p.tier_id = tier.id
      WHERE p.id = $1
    `, [prizeId]);

    return result.rows[0] || null;
  } catch (error) {
    console.error('[LotteryService] Error getting prize:', error);
    throw error;
  }
}

/**
 * Get all prizes for a specific tier
 * @param {object} client - PostgreSQL client
 * @param {number} tierId - Tier ID
 * @returns {Promise<Array>} List of prizes
 */
export async function getTierPrizes(client, tierId) {
  try {
    const result = await client.query(`
      SELECT
        p.*,
        t.order_id as winner_order_id,
        t.email as winner_email,
        c.code as winner_code
      FROM prizes p
      LEFT JOIN tickets t ON p.winner_ticket_id = t.id
      LEFT JOIN codes c ON t.code_id = c.id
      WHERE p.tier_id = $1
      ORDER BY p.created_at DESC
    `, [tierId]);

    return result.rows;
  } catch (error) {
    console.error('[LotteryService] Error getting tier prizes:', error);
    throw error;
  }
}

/**
 * Get pending prizes (not yet drawn)
 * @param {object} client - PostgreSQL client
 * @returns {Promise<Array>} List of pending prizes
 */
export async function getPendingPrizes(client) {
  try {
    const result = await client.query(`
      SELECT
        p.*,
        tier.tier_number,
        tier.prize_amount as tier_prize_amount
      FROM prizes p
      LEFT JOIN tiers tier ON p.tier_id = tier.id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
    `);

    return result.rows;
  } catch (error) {
    console.error('[LotteryService] Error getting pending prizes:', error);
    throw error;
  }
}

/**
 * Get all prizes with pagination
 * @param {object} client - PostgreSQL client
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<object>} Prizes and pagination info
 */
export async function getAllPrizes(client, page = 1, limit = 20) {
  try {
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await client.query('SELECT COUNT(*) as total FROM prizes');
    const total = parseInt(countResult.rows[0].total);

    // Get prizes
    const result = await client.query(`
      SELECT
        p.*,
        t.order_id as winner_order_id,
        t.email as winner_email,
        c.code as winner_code,
        tier.tier_number
      FROM prizes p
      LEFT JOIN tickets t ON p.winner_ticket_id = t.id
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON p.tier_id = tier.id
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return {
      prizes: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('[LotteryService] Error getting all prizes:', error);
    throw error;
  }
}

/**
 * Mark a prize as claimed by the winner
 * @param {object} client - PostgreSQL client
 * @param {number} prizeId - Prize ID
 * @returns {Promise<object>} Updated prize
 */
export async function markPrizeAsClaimed(client, prizeId) {
  try {
    const prizeResult = await client.query(
      'SELECT * FROM prizes WHERE id = $1',
      [prizeId]
    );

    if (prizeResult.rows.length === 0) {
      throw new Error('Prize not found');
    }

    const prize = prizeResult.rows[0];

    if (prize.status !== 'drawn') {
      throw new Error('Prize must be drawn before it can be claimed');
    }

    await client.query(
      'UPDATE prizes SET status = $1 WHERE id = $2',
      ['claimed', prizeId]
    );

    return await getPrizeById(client, prizeId);
  } catch (error) {
    console.error('[LotteryService] Error marking prize as claimed:', error);
    throw error;
  }
}

/**
 * Mark a prize as paid
 * @param {object} client - PostgreSQL client
 * @param {number} prizeId - Prize ID
 * @returns {Promise<object>} Updated prize
 */
export async function markPrizeAsPaid(client, prizeId) {
  try {
    const prizeResult = await client.query(
      'SELECT * FROM prizes WHERE id = $1',
      [prizeId]
    );

    if (prizeResult.rows.length === 0) {
      throw new Error('Prize not found');
    }

    const prize = prizeResult.rows[0];

    if (prize.status !== 'claimed') {
      throw new Error('Prize must be claimed before it can be marked as paid');
    }

    await client.query(
      'UPDATE prizes SET status = $1 WHERE id = $2',
      ['paid', prizeId]
    );

    return await getPrizeById(client, prizeId);
  } catch (error) {
    console.error('[LotteryService] Error marking prize as paid:', error);
    throw error;
  }
}

/**
 * Get prize statistics
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Prize stats
 */
export async function getPrizeStats(client) {
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'drawn') as drawn,
        COUNT(*) FILTER (WHERE status = 'claimed') as claimed,
        COUNT(*) FILTER (WHERE status = 'paid') as paid,
        COUNT(*) as total,
        SUM(amount) as total_amount,
        SUM(amount) FILTER (WHERE status = 'paid') as paid_amount
      FROM prizes
    `);

    return result.rows[0];
  } catch (error) {
    console.error('[LotteryService] Error getting prize stats:', error);
    throw error;
  }
}

/**
 * Get user's won prizes
 * @param {object} client - PostgreSQL client
 * @param {string} email - User email
 * @returns {Promise<Array>} List of won prizes
 */
export async function getUserPrizes(client, email) {
  try {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await client.query(`
      SELECT
        p.*,
        t.order_id,
        c.code,
        tier.tier_number
      FROM prizes p
      INNER JOIN tickets t ON p.winner_ticket_id = t.id
      LEFT JOIN codes c ON t.code_id = c.id
      LEFT JOIN tiers tier ON p.tier_id = tier.id
      WHERE t.email = $1
      ORDER BY p.draw_date DESC
    `, [normalizedEmail]);

    return result.rows;
  } catch (error) {
    console.error('[LotteryService] Error getting user prizes:', error);
    throw error;
  }
}

/**
 * Cancel a prize draw (only if not drawn yet)
 * @param {object} client - PostgreSQL client
 * @param {number} prizeId - Prize ID
 * @returns {Promise<boolean>} Success status
 */
export async function cancelPrizeDraw(client, prizeId) {
  try {
    const prizeResult = await client.query(
      'SELECT * FROM prizes WHERE id = $1',
      [prizeId]
    );

    if (prizeResult.rows.length === 0) {
      throw new Error('Prize not found');
    }

    const prize = prizeResult.rows[0];

    if (prize.status !== 'pending') {
      throw new Error('Can only cancel pending prizes');
    }

    await client.query('DELETE FROM prizes WHERE id = $1', [prizeId]);

    return true;
  } catch (error) {
    console.error('[LotteryService] Error cancelling prize draw:', error);
    throw error;
  }
}

/**
 * Automatically draw all pending prizes that are past their draw date
 * @param {object} client - PostgreSQL client
 * @returns {Promise<Array>} Drawn prizes
 */
export async function autoDrawPendingPrizes(client) {
  try {
    // Get pending prizes with past draw dates
    const pendingResult = await client.query(`
      SELECT id
      FROM prizes
      WHERE status = 'pending'
        AND draw_date IS NOT NULL
        AND draw_date <= NOW()
    `);

    const drawnPrizes = [];

    for (const prize of pendingResult.rows) {
      try {
        const drawn = await drawPrize(client, prize.id);
        drawnPrizes.push(drawn);
      } catch (error) {
        console.error(`[LotteryService] Failed to auto-draw prize ${prize.id}:`, error);
      }
    }

    return drawnPrizes;
  } catch (error) {
    console.error('[LotteryService] Error auto-drawing pending prizes:', error);
    throw error;
  }
}
