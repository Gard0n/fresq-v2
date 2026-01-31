// FRESQ V2 - Referral Service
// Gestion du système de parrainage

import { generateCode } from '../utils.js';

/**
 * Create a new referral
 * @param {object} client - PostgreSQL client
 * @param {number} referrerUserId - User ID of the referrer
 * @param {string} referredEmail - Email of the referred person
 * @returns {Promise<object>} Created referral
 */
export async function createReferral(client, referrerUserId, referredEmail) {
  try {
    // Validate referrer exists
    const referrerResult = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [referrerUserId]
    );

    if (referrerResult.rows.length === 0) {
      throw new Error('Referrer not found');
    }

    const referrer = referrerResult.rows[0];
    const normalizedEmail = referredEmail.trim().toLowerCase();

    // Check if user is trying to refer themselves
    if (referrer.email === normalizedEmail) {
      throw new Error('Cannot refer yourself');
    }

    // Check if this email has already been referred by this user
    const existingReferralResult = await client.query(`
      SELECT * FROM referrals
      WHERE referrer_user_id = $1 AND referred_email = $2
    `, [referrerUserId, normalizedEmail]);

    if (existingReferralResult.rows.length > 0) {
      throw new Error('This email has already been referred by you');
    }

    // Check if referred email already has an account or tickets
    const referredUserResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (referredUserResult.rows.length > 0) {
      const referredUserId = referredUserResult.rows[0].id;

      // Check if they already have paid tickets
      const ticketsResult = await client.query(
        'SELECT COUNT(*) as count FROM tickets WHERE user_id = $1 AND status = $2',
        [referredUserId, 'paid']
      );

      if (parseInt(ticketsResult.rows[0].count) > 0) {
        throw new Error('This person already has tickets');
      }
    }

    // Create referral
    const result = await client.query(`
      INSERT INTO referrals (
        referrer_user_id,
        referred_email,
        referred_user_id,
        status,
        created_at
      )
      VALUES ($1, $2, $3, 'pending', NOW())
      RETURNING *
    `, [
      referrerUserId,
      normalizedEmail,
      referredUserResult.rows.length > 0 ? referredUserResult.rows[0].id : null
    ]);

    return result.rows[0];
  } catch (error) {
    console.error('[ReferralService] Error creating referral:', error);
    throw error;
  }
}

/**
 * Complete a referral when the referred person makes their first purchase
 * @param {object} client - PostgreSQL client
 * @param {string} referredEmail - Email of the referred person
 * @returns {Promise<object|null>} Completed referral with free code, or null if no referral
 */
export async function completeReferral(client, referredEmail) {
  try {
    const normalizedEmail = referredEmail.trim().toLowerCase();

    // Find pending referral for this email
    const referralResult = await client.query(`
      SELECT * FROM referrals
      WHERE referred_email = $1 AND status = 'pending'
      LIMIT 1
    `, [normalizedEmail]);

    if (referralResult.rows.length === 0) {
      return null; // No referral to complete
    }

    const referral = referralResult.rows[0];

    // Generate free code for referrer
    const freeCode = generateCode();

    // Insert code (source = referral for free referral codes)
    const codeResult = await client.query(`
      INSERT INTO codes (code, user_id, source)
      VALUES ($1, $2, 'referral')
      RETURNING id
    `, [freeCode, referral.referrer_user_id]);

    const codeId = codeResult.rows[0].id;

    // Get or create user for referred email
    let referredUserId = referral.referred_user_id;

    if (!referredUserId) {
      const userResult = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [normalizedEmail]
      );

      if (userResult.rows.length > 0) {
        referredUserId = userResult.rows[0].id;
      }
    }

    // Update referral
    await client.query(`
      UPDATE referrals
      SET
        referred_user_id = $1,
        free_ticket_code_id = $2,
        status = 'completed',
        completed_at = NOW()
      WHERE id = $3
    `, [referredUserId, codeId, referral.id]);

    // Get updated referral with details
    const updatedResult = await client.query(`
      SELECT
        r.*,
        c.code as free_code,
        u.email as referrer_email
      FROM referrals r
      LEFT JOIN codes c ON r.free_ticket_code_id = c.id
      LEFT JOIN users u ON r.referrer_user_id = u.id
      WHERE r.id = $1
    `, [referral.id]);

    return updatedResult.rows[0];
  } catch (error) {
    console.error('[ReferralService] Error completing referral:', error);
    throw error;
  }
}

/**
 * Get all referrals for a user
 * @param {object} client - PostgreSQL client
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of referrals
 */
export async function getReferralsByUser(client, userId) {
  try {
    const result = await client.query(`
      SELECT
        r.*,
        c.code as free_code,
        u.email as referred_user_email
      FROM referrals r
      LEFT JOIN codes c ON r.free_ticket_code_id = c.id
      LEFT JOIN users u ON r.referred_user_id = u.id
      WHERE r.referrer_user_id = $1
      ORDER BY r.created_at DESC
    `, [userId]);

    return result.rows;
  } catch (error) {
    console.error('[ReferralService] Error getting referrals by user:', error);
    throw error;
  }
}

/**
 * Get referral statistics for a user
 * @param {object} client - PostgreSQL client
 * @param {number} userId - User ID
 * @returns {Promise<object>} Referral stats
 */
export async function getUserReferralStats(client, userId) {
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'claimed') as claimed,
        COUNT(*) as total
      FROM referrals
      WHERE referrer_user_id = $1
    `, [userId]);

    return result.rows[0];
  } catch (error) {
    console.error('[ReferralService] Error getting user referral stats:', error);
    throw error;
  }
}

/**
 * Get global referral statistics
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Global referral stats
 */
export async function getReferralStats(client) {
  try {
    const result = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'claimed') as claimed,
        COUNT(*) as total,
        COUNT(DISTINCT referrer_user_id) as total_referrers
      FROM referrals
    `);

    return result.rows[0];
  } catch (error) {
    console.error('[ReferralService] Error getting referral stats:', error);
    throw error;
  }
}

/**
 * Check if an email is eligible to be referred
 * @param {object} client - PostgreSQL client
 * @param {string} email - Email to check
 * @returns {Promise<object>} Eligibility status
 */
export async function checkReferralEligibility(client, email) {
  try {
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already has an account
    const userResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].id;

      // Check if they have paid tickets
      const ticketsResult = await client.query(
        'SELECT COUNT(*) as count FROM tickets WHERE user_id = $1 AND status = $2',
        [userId, 'paid']
      );

      if (parseInt(ticketsResult.rows[0].count) > 0) {
        return {
          eligible: false,
          reason: 'already_has_tickets'
        };
      }
    }

    // Check if email has already been referred
    const referralResult = await client.query(
      'SELECT COUNT(*) as count FROM referrals WHERE referred_email = $1',
      [normalizedEmail]
    );

    if (parseInt(referralResult.rows[0].count) > 0) {
      return {
        eligible: false,
        reason: 'already_referred'
      };
    }

    return {
      eligible: true
    };
  } catch (error) {
    console.error('[ReferralService] Error checking referral eligibility:', error);
    throw error;
  }
}

/**
 * Mark a referral's free code as claimed
 * @param {object} client - PostgreSQL client
 * @param {number} referralId - Referral ID
 * @returns {Promise<object>} Updated referral
 */
export async function markReferralAsClaimed(client, referralId) {
  try {
    const referralResult = await client.query(
      'SELECT * FROM referrals WHERE id = $1',
      [referralId]
    );

    if (referralResult.rows.length === 0) {
      throw new Error('Referral not found');
    }

    const referral = referralResult.rows[0];

    if (referral.status !== 'completed') {
      throw new Error('Referral must be completed before claiming');
    }

    await client.query(
      'UPDATE referrals SET status = $1 WHERE id = $2',
      ['claimed', referralId]
    );

    return await client.query(
      'SELECT * FROM referrals WHERE id = $1',
      [referralId]
    ).then(r => r.rows[0]);
  } catch (error) {
    console.error('[ReferralService] Error marking referral as claimed:', error);
    throw error;
  }
}

/**
 * Get top referrers (leaderboard)
 * @param {object} client - PostgreSQL client
 * @param {number} limit - Number of top referrers to return
 * @returns {Promise<Array>} Top referrers
 */
export async function getTopReferrers(client, limit = 10) {
  try {
    const result = await client.query(`
      SELECT
        r.referrer_user_id,
        u.email as referrer_email,
        COUNT(*) FILTER (WHERE r.status = 'completed') as completed_referrals,
        COUNT(*) as total_referrals
      FROM referrals r
      LEFT JOIN users u ON r.referrer_user_id = u.id
      GROUP BY r.referrer_user_id, u.email
      ORDER BY completed_referrals DESC, total_referrals DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  } catch (error) {
    console.error('[ReferralService] Error getting top referrers:', error);
    throw error;
  }
}

/**
 * Get all referrals (admin view) with pagination
 * @param {object} client - PostgreSQL client
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<object>} Referrals and pagination info
 */
export async function getAllReferrals(client, page = 1, limit = 20) {
  try {
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await client.query('SELECT COUNT(*) as total FROM referrals');
    const total = parseInt(countResult.rows[0].total);

    // Get referrals
    const result = await client.query(`
      SELECT
        r.*,
        c.code as free_code,
        u1.email as referrer_email,
        u2.email as referred_user_email
      FROM referrals r
      LEFT JOIN codes c ON r.free_ticket_code_id = c.id
      LEFT JOIN users u1 ON r.referrer_user_id = u1.id
      LEFT JOIN users u2 ON r.referred_user_id = u2.id
      ORDER BY r.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return {
      referrals: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('[ReferralService] Error getting all referrals:', error);
    throw error;
  }
}

/**
 * Delete a referral (admin only)
 * @param {object} client - PostgreSQL client
 * @param {number} referralId - Referral ID
 * @returns {Promise<boolean>} Success status
 */
export async function deleteReferral(client, referralId) {
  try {
    await client.query('DELETE FROM referrals WHERE id = $1', [referralId]);
    return true;
  } catch (error) {
    console.error('[ReferralService] Error deleting referral:', error);
    throw error;
  }
}
