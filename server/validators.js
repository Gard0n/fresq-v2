// FRESQ V2 - Input Validators

import { GRID_WIDTH, GRID_HEIGHT, COLOR_MIN, COLOR_MAX } from './constants.js';

/**
 * Validate grid coordinates
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateCoordinates(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { valid: false, error: 'invalid_type' };
  }

  if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
    return { valid: false, error: 'out_of_bounds' };
  }

  return { valid: true };
}

/**
 * Validate color index
 * @param {number} color - Color index
 * @returns {{valid: boolean, error?: string}}
 */
export function validateColor(color) {
  if (!Number.isInteger(color)) {
    return { valid: false, error: 'invalid_type' };
  }

  if (color < COLOR_MIN || color > COLOR_MAX) {
    return { valid: false, error: 'out_of_range' };
  }

  return { valid: true };
}

/**
 * Validate email format (RFC 5322 simplified)
 * @param {string} email - Email address
 * @returns {{valid: boolean, error?: string}}
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'invalid_type' };
  }

  const trimmed = email.trim().toLowerCase();

  if (trimmed.length === 0 || trimmed.length > 254) {
    return { valid: false, error: 'invalid_length' };
  }

  const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'invalid_format' };
  }

  return { valid: true, email: trimmed };
}

/**
 * Validate pagination parameters
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @param {number} maxLimit - Maximum allowed limit
 * @returns {{valid: boolean, page?: number, limit?: number, offset?: number, error?: string}}
 */
export function validatePagination(page, limit, maxLimit = 1000) {
  const parsedPage = parseInt(page) || 1;
  const parsedLimit = parseInt(limit) || 100;

  if (parsedPage < 1) {
    return { valid: false, error: 'invalid_page' };
  }

  if (parsedLimit < 1 || parsedLimit > maxLimit) {
    return { valid: false, error: 'invalid_limit' };
  }

  const offset = (parsedPage - 1) * parsedLimit;

  return {
    valid: true,
    page: parsedPage,
    limit: parsedLimit,
    offset
  };
}
