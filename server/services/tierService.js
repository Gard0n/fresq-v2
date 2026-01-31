// FRESQ V2 - Tier Service
// Gestion des paliers (tiers) et expansion de la grille

/**
 * Get current active tier based on total paid tickets
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object|null>} Current tier or null
 */
export async function getCurrentTier(client) {
  try {
    // Count total paid tickets
    const ticketCountResult = await client.query(`
      SELECT COUNT(*) as total
      FROM tickets
      WHERE status = 'paid'
    `);

    const totalPaidTickets = parseInt(ticketCountResult.rows[0].total) || 0;

    // Find the appropriate tier for this ticket count
    const tierResult = await client.query(`
      SELECT *
      FROM tiers
      WHERE is_active = TRUE
        AND min_tickets <= $1
        AND (max_tickets >= $1 OR max_tickets IS NULL)
      ORDER BY tier_number DESC
      LIMIT 1
    `, [totalPaidTickets]);

    if (tierResult.rows.length === 0) {
      // Return tier 0 by default if no tier found
      const defaultTier = await client.query(`
        SELECT * FROM tiers WHERE tier_number = 0 LIMIT 1
      `);
      return defaultTier.rows[0] || null;
    }

    return tierResult.rows[0];
  } catch (error) {
    console.error('[TierService] Error getting current tier:', error);
    throw error;
  }
}

/**
 * Check if a tier upgrade is needed after a new ticket purchase
 * @param {object} client - PostgreSQL client
 * @param {number} currentTierNumber - Current tier number
 * @returns {Promise<object|null>} Next tier if upgrade needed, null otherwise
 */
export async function checkTierUpgrade(client, currentTierNumber) {
  try {
    const currentTier = await getCurrentTier(client);

    if (!currentTier) {
      return null;
    }

    // If the current tier number is different from the provided one, upgrade is needed
    if (currentTier.tier_number > currentTierNumber) {
      return currentTier;
    }

    return null;
  } catch (error) {
    console.error('[TierService] Error checking tier upgrade:', error);
    throw error;
  }
}

/**
 * Expand the grid to accommodate a new tier
 * Old cells remain in the center, new cells are added around
 * @param {object} client - PostgreSQL client
 * @param {object} oldTier - Previous tier
 * @param {object} newTier - New tier to upgrade to
 * @returns {Promise<object>} Expansion details
 */
export async function expandGrid(client, oldTier, newTier) {
  try {
    const oldWidth = oldTier.grid_width;
    const oldHeight = oldTier.grid_height;
    const newWidth = newTier.grid_width;
    const newHeight = newTier.grid_height;

    // Calculate offset to center old grid in new grid
    const offsetX = Math.floor((newWidth - oldWidth) / 2);
    const offsetY = Math.floor((newHeight - oldHeight) / 2);

    // Shift all existing cells to center them in the new grid
    await client.query(`
      UPDATE codes
      SET
        cell_x = cell_x + $1,
        cell_y = cell_y + $2
      WHERE cell_x IS NOT NULL AND cell_y IS NOT NULL
    `, [offsetX, offsetY]);

    // Update config table with new dimensions
    await client.query(`
      UPDATE config
      SET
        grid_width = $1,
        grid_height = $2,
        state_version = state_version + 1,
        updated_at = NOW()
    `, [newWidth, newHeight]);

    return {
      oldDimensions: { width: oldWidth, height: oldHeight },
      newDimensions: { width: newWidth, height: newHeight },
      offset: { x: offsetX, y: offsetY },
      cellsShifted: true
    };
  } catch (error) {
    console.error('[TierService] Error expanding grid:', error);
    throw error;
  }
}

/**
 * Perform a complete tier upgrade
 * @param {object} client - PostgreSQL client
 * @param {object} newTier - New tier to upgrade to
 * @returns {Promise<object>} Upgrade result
 */
export async function upgradeTier(client, newTier) {
  try {
    // Get current tier from config or calculate it
    const configResult = await client.query(`
      SELECT grid_width, grid_height FROM config LIMIT 1
    `);

    if (configResult.rows.length === 0) {
      throw new Error('Config not found');
    }

    const currentGridWidth = configResult.rows[0].grid_width;
    const currentGridHeight = configResult.rows[0].grid_height;

    // Find the tier that matches current dimensions
    const currentTierResult = await client.query(`
      SELECT * FROM tiers
      WHERE grid_width = $1 AND grid_height = $2
      LIMIT 1
    `, [currentGridWidth, currentGridHeight]);

    const oldTier = currentTierResult.rows[0];

    if (!oldTier) {
      throw new Error('Current tier not found');
    }

    // Check if upgrade is actually needed
    if (newTier.tier_number <= oldTier.tier_number) {
      return {
        upgraded: false,
        reason: 'new_tier_not_higher',
        currentTier: oldTier
      };
    }

    // Expand the grid
    const expansionResult = await expandGrid(client, oldTier, newTier);

    return {
      upgraded: true,
      oldTier,
      newTier,
      expansion: expansionResult
    };
  } catch (error) {
    console.error('[TierService] Error upgrading tier:', error);
    throw error;
  }
}

/**
 * Get next tier information
 * @param {object} client - PostgreSQL client
 * @param {number} currentTierNumber - Current tier number
 * @returns {Promise<object|null>} Next tier or null if max tier reached
 */
export async function getNextTier(client, currentTierNumber) {
  try {
    const nextTierResult = await client.query(`
      SELECT * FROM tiers
      WHERE tier_number = $1 AND is_active = TRUE
      LIMIT 1
    `, [currentTierNumber + 1]);

    return nextTierResult.rows[0] || null;
  } catch (error) {
    console.error('[TierService] Error getting next tier:', error);
    throw error;
  }
}

/**
 * Get tier progress information (tickets sold vs needed for next tier)
 * @param {object} client - PostgreSQL client
 * @returns {Promise<object>} Progress information
 */
export async function getTierProgress(client) {
  try {
    const currentTier = await getCurrentTier(client);

    if (!currentTier) {
      return {
        currentTier: null,
        nextTier: null,
        ticketsSold: 0,
        ticketsNeeded: 0,
        progress: 0
      };
    }

    const ticketCountResult = await client.query(`
      SELECT COUNT(*) as total
      FROM tickets
      WHERE status = 'paid'
    `);

    const ticketsSold = parseInt(ticketCountResult.rows[0].total) || 0;
    const nextTier = await getNextTier(client, currentTier.tier_number);

    if (!nextTier) {
      // Max tier reached
      return {
        currentTier,
        nextTier: null,
        ticketsSold,
        ticketsNeeded: 0,
        progress: 100,
        maxTierReached: true
      };
    }

    const ticketsNeeded = nextTier.min_tickets - ticketsSold;
    const progress = Math.min(100, (ticketsSold / nextTier.min_tickets) * 100);

    return {
      currentTier,
      nextTier,
      ticketsSold,
      ticketsNeeded: Math.max(0, ticketsNeeded),
      progress: Math.round(progress * 100) / 100,
      maxTierReached: false
    };
  } catch (error) {
    console.error('[TierService] Error getting tier progress:', error);
    throw error;
  }
}

/**
 * Get all tiers
 * @param {object} client - PostgreSQL client
 * @returns {Promise<Array>} List of all tiers
 */
export async function getAllTiers(client) {
  try {
    const result = await client.query(`
      SELECT * FROM tiers
      WHERE is_active = TRUE
      ORDER BY tier_number ASC
    `);

    return result.rows;
  } catch (error) {
    console.error('[TierService] Error getting all tiers:', error);
    throw error;
  }
}
