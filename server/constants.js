// FRESQ V2 - Application Constants

// Grid Configuration
export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT; // 40,000

// Colors Configuration
export const COLOR_MIN = 1;
export const COLOR_MAX = 10;
export const COLOR_COUNT = COLOR_MAX - COLOR_MIN + 1;

// Canvas Rendering
export const CELL_SIZE = 3;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 10;

// Cache Configuration
export const CACHE_CONFIG_TTL = 5 * 60 * 1000; // 5 minutes
export const CACHE_STATE_TTL = 2 * 60 * 1000;  // 2 minutes
export const CACHE_CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Rate Limiting
export const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Analytics
export const MAX_ANALYTICS_EVENTS = 1000;

// Code Generation
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
export const CODE_LENGTH = 8;
