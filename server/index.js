import express from "express";
import "dotenv/config";
import { pool } from "./db.js";
import { generateCode, normalizeCode } from "./utils.js";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import Stripe from "stripe";

// Commercial services
import * as tierService from "./services/tierService.js";
import * as ticketService from "./services/ticketService.js";
import * as lotteryService from "./services/lotteryService.js";
import * as referralService from "./services/referralService.js";
import * as packService from "./services/packService.js";

// Stripe setup (graceful if key missing - endpoints will return error instead of crashing)
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const app = express();
const httpServer = createServer(app);

// Allowed origins for CORS
const allowedOrigins = [
  'https://fresq-v2.onrender.com',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
];

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"]
  }
});

const PORT = Number(process.env.PORT || 3001);

// Stripe webhook needs raw body - must be before express.json()
app.post("/api/stripe/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // Dev mode without webhook secret - parse body directly
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    log('error', 'Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: 'webhook_signature_invalid' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;

    if (!orderId) {
      log('error', 'Stripe webhook: missing order_id in metadata');
      return res.status(400).json({ error: 'missing_order_id' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update payment_session_id on the ticket
      await client.query(
        'UPDATE tickets SET payment_session_id = $1 WHERE order_id = $2',
        [session.id, orderId]
      );

      const result = await packService.confirmPackPurchase(client, orderId);

      await client.query('COMMIT');

      trackEvent('stripe', 'payment_confirmed', orderId, result.totalCodes);
      log('info', 'Stripe payment confirmed', { orderId, codesGenerated: result.totalCodes });

      // Broadcast tier upgrade if occurred
      if (result.tierUpgrade && result.tierUpgrade.upgraded) {
        io.emit('tier_upgrade', {
          oldTier: result.tierUpgrade.oldTier,
          newTier: result.tierUpgrade.newTier,
          expansion: result.tierUpgrade.expansion
        });
        clearCache('config');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      log('error', 'Stripe webhook processing error', { error: err.message, orderId });
    } finally {
      client.release();
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== RATE LIMITING =====
const rateLimitMap = new Map(); // key: ip:endpoint, value: { count, resetAt }

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const key = `${ip}:${req.path}`;
    const now = Date.now();

    let record = rateLimitMap.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      rateLimitMap.set(key, record);
    }

    record.count++;

    if (record.count > maxRequests) {
      return res.status(429).json({ error: 'too_many_requests' });
    }

    next();
  };
}

// Cleanup old rate limit records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ===== IN-MEMORY CACHE =====
const cache = new Map();

function setCache(key, value, ttlMs = 60000) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function clearCache(key) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

// Cleanup expired cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}, 60 * 1000);

// ===== ANALYTICS & LOGGING =====
const analytics = {
  events: [],
  maxEvents: 1000 // Keep last 1000 events in memory
};

function trackEvent(category, action, label = null, value = null) {
  const event = {
    timestamp: new Date().toISOString(),
    category,
    action,
    label,
    value
  };

  analytics.events.push(event);

  // Keep only last maxEvents
  if (analytics.events.length > analytics.maxEvents) {
    analytics.events.shift();
  }

  // Log to console in development
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[ANALYTICS] ${category}:${action}`, label || '', value || '');
  }
}

function log(level, message, meta = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  // Always log to console with color coding
  const colors = {
    error: '\x1b[31m', // Red
    warn: '\x1b[33m',  // Yellow
    info: '\x1b[36m',  // Cyan
    debug: '\x1b[90m'  // Gray
  };
  const reset = '\x1b[0m';
  const color = colors[level] || '';

  console.log(`${color}[${level.toUpperCase()}]${reset} ${message}`, meta);

  // Track errors and warnings as analytics events
  if (level === 'error' || level === 'warn') {
    trackEvent('system', level, message);
  }
}

// ===== HELPERS =====
async function getConfig(client) {
  const res = await client.query(
    "SELECT grid_w, grid_h, state_version, palette FROM config WHERE id = TRUE"
  );
  return res.rows[0];
}

// ===== USER AUTH API =====
app.post("/api/user/login", rateLimit(10, 60000), async (req, res) => { // 10 req/min
  const email = req.body?.email?.trim().toLowerCase();

  // Improved email validation
  if (!email || email.length > 254) {
    return res.status(400).json({ error: "invalid_email" });
  }

  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "invalid_email" });
  }

  const client = await pool.connect();
  try {
    // Get or create user
    let userRes = await client.query(
      "SELECT id, email FROM users WHERE email = $1",
      [email]
    );

    let user;
    if (userRes.rowCount === 0) {
      // Create new user
      const insertRes = await client.query(
        "INSERT INTO users (email) VALUES ($1) RETURNING id, email",
        [email]
      );
      user = insertRes.rows[0];
    } else {
      user = userRes.rows[0];
    }

    // Get all user's codes with cell info
    const codesRes = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color FROM codes WHERE user_id = $1 ORDER BY updated_at DESC",
      [user.id]
    );

    // Track login event
    trackEvent('user', 'login', user.email, codesRes.rows.length);
    log('info', 'User login', { email: user.email, codesCount: codesRes.rows.length });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email
      },
      codes: codesRes.rows
    });
  } catch (err) {
    log('error', 'User login error', { error: err.message });
    res.status(500).json({ error: "login_error" });
  } finally {
    client.release();
  }
});

app.post("/api/user/claim-code", rateLimit(20, 60000), async (req, res) => { // 20 req/min
  const userId = Number(req.body?.userId);
  const code = normalizeCode(req.body?.code);

  if (!userId || !code) {
    return res.status(400).json({ error: "invalid_params" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if code exists and is valid
    const codeRes = await client.query(
      "SELECT id, user_id, cell_x, cell_y, color FROM codes WHERE code = $1 FOR UPDATE",
      [code]
    );

    if (codeRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "invalid_code" });
    }

    const codeRow = codeRes.rows[0];

    // Check if code is already owned by another user
    if (codeRow.user_id !== null && codeRow.user_id !== userId) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "code_already_owned" });
    }

    // Assign code to user if not already assigned
    if (codeRow.user_id === null) {
      await client.query(
        "UPDATE codes SET user_id = $1, updated_at = NOW() WHERE id = $2",
        [userId, codeRow.id]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      code,
      assigned: codeRow.cell_x !== null ? {
        x: codeRow.cell_x,
        y: codeRow.cell_y,
        color: codeRow.color
      } : null
    });
  } catch (err) {
    await client.query("ROLLBACK");
    log('error', 'Claim code error', { error: err.message });
    res.status(500).json({ error: "claim_error" });
  } finally {
    client.release();
  }
});

app.get("/api/user/codes/:userId", async (req, res) => {
  const userId = Number(req.params.userId);

  if (!userId) {
    return res.status(400).json({ error: "invalid_user_id" });
  }

  const client = await pool.connect();
  try {
    const codesRes = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color FROM codes WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );

    res.json({
      ok: true,
      codes: codesRes.rows
    });
  } catch (err) {
    console.error('Get user codes error:', err);
    res.status(500).json({ error: "codes_error" });
  } finally {
    client.release();
  }
});

// ===== PUBLIC API =====
app.get("/api/config", async (req, res) => {
  // Try to get from cache first
  const cached = getCache('config');
  if (cached) {
    return res.json(cached);
  }

  const client = await pool.connect();
  try {
    const config = await getConfig(client);
    const response = {
      grid_w: config.grid_w,
      grid_h: config.grid_h,
      palette: config.palette
    };

    // Cache for 5 minutes
    setCache('config', response, 5 * 60 * 1000);

    res.json(response);
  } catch (err) {
    log('error', 'Config fetch error', { error: err.message });
    res.status(500).json({ error: "config_error" });
  } finally {
    client.release();
  }
});

app.get("/api/state", async (req, res) => {
  const client = await pool.connect();
  try {
    const config = await getConfig(client);
    const cellsRes = await client.query(
      "SELECT cell_x AS x, cell_y AS y, color FROM codes WHERE cell_x IS NOT NULL AND color IS NOT NULL"
    );

    res.json({
      config: {
        grid_w: config.grid_w,
        grid_h: config.grid_h,
        palette: config.palette
      },
      cells: cellsRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: "state_error" });
  } finally {
    client.release();
  }
});

app.post("/api/code/validate", async (req, res) => {
  const code = normalizeCode(req.body?.code);
  if (!code) return res.status(400).json({ error: "missing_code" });

  const client = await pool.connect();
  try {
    const codeRes = await client.query(
      "SELECT id, cell_x, cell_y, color FROM codes WHERE code = $1",
      [code]
    );

    if (codeRes.rowCount === 0) {
      return res.json({ ok: false });
    }

    const row = codeRes.rows[0];
    res.json({
      ok: true,
      code,
      assigned: row.cell_x !== null ? { x: row.cell_x, y: row.cell_y, color: row.color } : null
    });
  } catch (err) {
    res.status(500).json({ error: "validate_error" });
  } finally {
    client.release();
  }
});

app.post("/api/cell/claim", rateLimit(30, 60000), async (req, res) => { // 30 req/min
  const code = normalizeCode(req.body?.code);
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);

  if (!code || !Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: "invalid_params" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const codeRes = await client.query(
      "SELECT id, cell_x, cell_y FROM codes WHERE code = $1 FOR UPDATE",
      [code]
    );

    if (codeRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "invalid_code" });
    }

    const row = codeRes.rows[0];

    // Si déjà assigné, vérifier que c'est la même cellule
    if (row.cell_x !== null) {
      await client.query("COMMIT");
      return res.json({
        ok: row.cell_x === x && row.cell_y === y,
        error: row.cell_x !== x || row.cell_y !== y ? "already_assigned" : null
      });
    }

    // Vérifier que la cellule n'est pas prise
    const takenRes = await client.query(
      "SELECT id FROM codes WHERE cell_x = $1 AND cell_y = $2",
      [x, y]
    );

    if (takenRes.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "cell_taken" });
    }

    // Assigner la cellule
    await client.query(
      "UPDATE codes SET cell_x = $1, cell_y = $2, updated_at = NOW() WHERE id = $3",
      [x, y, row.id]
    );

    await client.query("COMMIT");

    // Track analytics
    trackEvent('cell', 'claim', `${x},${y}`, 1);
    log('info', 'Cell claimed', { x, y, code: code.substring(0, 3) + '...' });

    // Broadcast cell claim via WebSocket
    io.emit('cell:claimed', { x, y });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    log('error', 'Cell claim error', { error: err.message });
    res.status(500).json({ error: "claim_error" });
  } finally {
    client.release();
  }
});

app.post("/api/cell/paint", rateLimit(30, 60000), async (req, res) => { // 30 req/min
  const code = normalizeCode(req.body?.code);
  const color = Number(req.body?.color);

  if (!code || !Number.isInteger(color) || color < 1 || color > 10) {
    return res.status(400).json({ error: "invalid_params" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const codeRes = await client.query(
      "SELECT id, cell_x, cell_y FROM codes WHERE code = $1 FOR UPDATE",
      [code]
    );

    if (codeRes.rowCount === 0 || codeRes.rows[0].cell_x === null) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: "not_claimed" });
    }

    const row = codeRes.rows[0];

    await client.query(
      "UPDATE codes SET color = $1, updated_at = NOW() WHERE id = $2",
      [color, row.id]
    );

    await client.query("COMMIT");

    // Track analytics
    trackEvent('cell', 'paint', `${row.cell_x},${row.cell_y}`, color);
    log('info', 'Cell painted', { x: row.cell_x, y: row.cell_y, color });

    // Broadcast cell paint via WebSocket
    io.emit('cell:painted', { x: row.cell_x, y: row.cell_y, color });

    res.json({ ok: true, x: row.cell_x, y: row.cell_y, color });
  } catch (err) {
    await client.query("ROLLBACK");
    log('error', 'Cell paint error', { error: err.message });
    res.status(500).json({ error: "paint_error" });
  } finally {
    client.release();
  }
});

// Get cell information (history, owner, etc.)
app.get("/api/cell/:x/:y", async (req, res) => {
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 200 || y < 0 || y >= 200) {
    return res.status(400).json({ error: "invalid_coordinates" });
  }

  try {
    const result = await pool.query(
      `SELECT c.code, c.color, c.updated_at, c.claimed_at, u.email as owner_email
       FROM codes c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.cell_x = $1 AND c.cell_y = $2
       LIMIT 1`,
      [x, y]
    );

    if (result.rowCount === 0) {
      return res.json({ ok: true, painted: false, x, y });
    }

    const cell = result.rows[0];
    res.json({
      ok: true,
      painted: cell.color !== null,
      x,
      y,
      color: cell.color,
      owner_email: cell.owner_email,
      claimed_at: cell.claimed_at,
      last_painted_at: cell.updated_at,
      code: cell.code.substring(0, 3) + "..." // Partial code for privacy
    });
  } catch (err) {
    console.error("Error fetching cell info:", err);
    res.status(500).json({ error: "server_error" });
  }
});

// ===== ADMIN API =====
import bcrypt from "bcryptjs";
import { generateToken } from "./utils.js";

async function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await pool.query(
      "SELECT a.id, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token = $1 AND s.expires_at > NOW()",
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.admin = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: 'auth_error' });
  }
}

app.post("/api/admin/login", async (req, res) => {
  const email = req.body?.email?.trim().toLowerCase();
  const password = req.body?.password;

  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT id, email, password_hash FROM admins WHERE email = $1",
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'invalid_login' });
    }

    const admin = result.rows[0];
    const ok = await bcrypt.compare(password, admin.password_hash);

    if (!ok) {
      return res.status(401).json({ error: 'invalid_login' });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    await client.query(
      "INSERT INTO admin_sessions (admin_id, token, expires_at) VALUES ($1, $2, $3)",
      [admin.id, token, expiresAt]
    );

    res.json({ ok: true, token, admin: { id: admin.id, email: admin.email } });
  } catch (err) {
    res.status(500).json({ error: 'login_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/me", requireAdmin, async (req, res) => {
  res.json({ ok: true, admin: req.admin });
});

app.post("/api/admin/codes/generate", requireAdmin, async (req, res) => {
  const count = Number(req.body?.count || 0);

  if (!Number.isInteger(count) || count <= 0 || count > 10000) {
    return res.status(400).json({ error: 'invalid_count' });
  }

  const client = await pool.connect();
  try {
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = generateCode(8);
      codes.push(code);
    }

    // Batch insert for better performance
    const values = codes.map((code, i) => `($${i + 1})`).join(',');
    const query = `INSERT INTO codes (code) VALUES ${values} ON CONFLICT (code) DO NOTHING RETURNING code`;

    const result = await client.query(query, codes);

    res.json({ ok: true, generated: result.rowCount, codes: result.rows.map(r => r.code) });
  } catch (err) {
    console.error('Generate codes error:', err);
    res.status(500).json({ error: 'generate_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/codes", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { filter, page = 1, limit = 100 } = req.query;
    const offset = (page - 1) * limit;

    let query = "SELECT c.id, c.code, c.user_id, u.email, c.cell_x as x, c.cell_y as y, c.color, c.created_at, c.updated_at FROM codes c LEFT JOIN users u ON c.user_id = u.id";
    let whereClause = "";

    if (filter === 'unclaimed') {
      whereClause = " WHERE c.user_id IS NULL";
    } else if (filter === 'claimed') {
      whereClause = " WHERE c.user_id IS NOT NULL";
    } else if (filter === 'painted') {
      whereClause = " WHERE c.cell_x IS NOT NULL";
    } else if (filter === 'unpainted') {
      whereClause = " WHERE c.cell_x IS NULL";
    }

    query += whereClause + " ORDER BY c.created_at DESC LIMIT $1 OFFSET $2";

    const codes = await client.query(query, [limit, offset]);

    // Get total count
    let countQuery = "SELECT COUNT(*)::int as count FROM codes c" + whereClause;
    const totalCount = await client.query(countQuery);

    res.json({
      ok: true,
      codes: codes.rows,
      total: totalCount.rows[0].count,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount.rows[0].count / limit)
    });
  } catch (err) {
    console.error('Admin codes list error:', err);
    res.status(500).json({ error: 'codes_list_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/codes/export", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { filter } = req.query;

    let query = "SELECT c.code, c.user_id, u.email, c.cell_x as x, c.cell_y as y, c.color FROM codes c LEFT JOIN users u ON c.user_id = u.id";

    if (filter === 'unclaimed') {
      query += " WHERE c.user_id IS NULL";
    } else if (filter === 'claimed') {
      query += " WHERE c.user_id IS NOT NULL";
    }

    query += " ORDER BY c.created_at DESC";

    const codes = await client.query(query);

    // Generate CSV
    let csv = "Code,User Email,User ID,Cell X,Cell Y,Color\n";
    codes.rows.forEach(row => {
      csv += `${row.code},${row.email || ''},${row.user_id || ''},${row.x || ''},${row.y || ''},${row.color || ''}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=codes_${Date.now()}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('Admin export codes error:', err);
    res.status(500).json({ error: 'export_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    // Total users
    const usersCount = await client.query("SELECT COUNT(*)::int AS count FROM users");

    // Total codes
    const codesCount = await client.query("SELECT COUNT(*)::int AS count FROM codes");

    // Claimed codes
    const claimedCodesCount = await client.query("SELECT COUNT(*)::int AS count FROM codes WHERE user_id IS NOT NULL");

    // Painted cells
    const paintedCellsCount = await client.query("SELECT COUNT(*)::int AS count FROM codes WHERE cell_x IS NOT NULL");

    // Cells painted in last 24h
    const painted24h = await client.query(
      "SELECT COUNT(*)::int AS count FROM codes WHERE updated_at >= NOW() - INTERVAL '24 hours' AND cell_x IS NOT NULL"
    );

    res.json({
      ok: true,
      total_users: usersCount.rows[0].count,
      total_codes: codesCount.rows[0].count,
      claimed_codes: claimedCodesCount.rows[0].count,
      painted_cells: paintedCellsCount.rows[0].count,
      percent_painted: ((paintedCellsCount.rows[0].count / 40000) * 100).toFixed(2),
      painted_24h: painted24h.rows[0].count
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'stats_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/cells", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 1000);
  const offset = Number(req.query.offset || 0);

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color, updated_at FROM codes WHERE cell_x IS NOT NULL ORDER BY updated_at DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );

    const countRes = await client.query("SELECT COUNT(*)::int AS total FROM codes WHERE cell_x IS NOT NULL");

    res.json({
      ok: true,
      cells: result.rows,
      total: countRes.rows[0].total
    });
  } catch (err) {
    res.status(500).json({ error: 'cells_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/cell/delete", requireAdmin, async (req, res) => {
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      "UPDATE codes SET cell_x = NULL, cell_y = NULL, color = NULL, updated_at = NOW() WHERE cell_x = $1 AND cell_y = $2 RETURNING code",
      [x, y]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: 'cell_not_found' });
    }

    await client.query("COMMIT");

    // Broadcast cell deletion via WebSocket
    io.emit('cell:deleted', { x, y });

    res.json({ ok: true, code: result.rows[0].code });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: 'delete_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/cell/reset-color", requireAdmin, async (req, res) => {
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'invalid_params' });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      "UPDATE codes SET color = NULL, updated_at = NOW() WHERE cell_x = $1 AND cell_y = $2 RETURNING code",
      [x, y]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ ok: false, error: 'cell_not_found' });
    }

    await client.query("COMMIT");

    // Broadcast color reset via WebSocket
    io.emit('cell:deleted', { x, y });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: 'reset_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/export/codes", requireAdmin, async (req, res) => {
  const format = req.query.format || 'json';

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color, created_at, updated_at FROM codes ORDER BY created_at DESC"
    );

    if (format === 'csv') {
      const csv = [
        'code,x,y,color,created_at,updated_at',
        ...result.rows.map(r => `${r.code},${r.x || ''},${r.y || ''},${r.color || ''},${r.created_at},${r.updated_at}`)
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fresq_codes_${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        total: result.rowCount,
        codes: result.rows
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'export_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/export/cells", requireAdmin, async (req, res) => {
  const format = req.query.format || 'json';

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT cell_x AS x, cell_y AS y, color, code, updated_at FROM codes WHERE cell_x IS NOT NULL ORDER BY updated_at DESC"
    );

    if (format === 'csv') {
      const csv = [
        'x,y,color,code,updated_at',
        ...result.rows.map(r => `${r.x},${r.y},${r.color || ''},${r.code},${r.updated_at}`)
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="fresq_cells_${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        total: result.rowCount,
        cells: result.rows
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'export_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/export/full", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const configRes = await getConfig(client);
    const codesRes = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color, created_at, updated_at FROM codes"
    );
    const statsRes = await client.query(
      "SELECT COUNT(*)::int AS total_codes, COUNT(CASE WHEN cell_x IS NOT NULL THEN 1 END)::int AS assigned_codes FROM codes"
    );

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      config: {
        grid_w: configRes.grid_w,
        grid_h: configRes.grid_h,
        palette: configRes.palette
      },
      stats: statsRes.rows[0],
      codes: codesRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'export_error' });
  } finally {
    client.release();
  }
});

// ===== ADMIN: USER MANAGEMENT =====
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        u.id,
        u.email,
        u.is_banned,
        u.created_at,
        COUNT(c.id)::int as codes_count,
        COUNT(CASE WHEN c.cell_x IS NOT NULL THEN 1 END)::int as painted_count
      FROM users u
      LEFT JOIN codes c ON u.id = c.user_id
    `;

    const params = [];
    if (search) {
      query += " WHERE u.email ILIKE $1";
      params.push(`%${search}%`);
    }

    query += " GROUP BY u.id ORDER BY u.created_at DESC LIMIT $" + (params.length + 1) + " OFFSET $" + (params.length + 2);
    params.push(limit, offset);

    const users = await client.query(query, params);

    // Get total count
    let countQuery = "SELECT COUNT(*)::int as count FROM users";
    if (search) {
      countQuery += " WHERE email ILIKE $1";
    }
    const totalCount = await client.query(countQuery, search ? [`%${search}%`] : []);

    res.json({
      ok: true,
      users: users.rows,
      total: totalCount.rows[0].count,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount.rows[0].count / limit)
    });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).json({ error: 'users_list_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/users/:userId", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const client = await pool.connect();

  try {
    const user = await client.query(
      "SELECT id, email, is_banned, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (user.rowCount === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    const codes = await client.query(
      "SELECT code, cell_x as x, cell_y as y, color, created_at, updated_at FROM codes WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );

    res.json({
      ok: true,
      user: user.rows[0],
      codes: codes.rows
    });
  } catch (err) {
    console.error('Admin user detail error:', err);
    res.status(500).json({ error: 'user_detail_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/users/:userId/ban", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const client = await pool.connect();

  try {
    await client.query(
      "UPDATE users SET is_banned = TRUE WHERE id = $1",
      [userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Admin ban user error:', err);
    res.status(500).json({ error: 'ban_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/users/:userId/unban", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const client = await pool.connect();

  try {
    await client.query(
      "UPDATE users SET is_banned = FALSE WHERE id = $1",
      [userId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Admin unban user error:', err);
    res.status(500).json({ error: 'unban_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/users/:userId/clear-cells", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get count before clearing
    const countRes = await client.query(
      "SELECT COUNT(*)::int AS count FROM codes WHERE user_id = $1 AND cell_x IS NOT NULL",
      [userId]
    );

    // Clear cells
    await client.query(
      "UPDATE codes SET cell_x = NULL, cell_y = NULL, color = NULL WHERE user_id = $1",
      [userId]
    );

    // Increment state version
    await client.query("UPDATE config SET state_version = state_version + 1 WHERE id = TRUE");

    await client.query("COMMIT");

    res.json({ ok: true, clearedCount: countRes.rows[0].count });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error('Admin clear cells error:', err);
    res.status(500).json({ error: 'clear_cells_error' });
  } finally {
    client.release();
  }
});

// ===== ADMIN: ENHANCED STATS =====
app.get("/api/admin/stats/detailed", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    // Activity by day (last 7 days)
    const activityByDay = await client.query(`
      SELECT
        DATE(updated_at) as date,
        COUNT(*)::int as count
      FROM codes
      WHERE updated_at >= NOW() - INTERVAL '7 days' AND cell_x IS NOT NULL
      GROUP BY DATE(updated_at)
      ORDER BY date DESC
    `);

    // Recent activity (last 50 paints)
    const recentActivity = await client.query(`
      SELECT
        c.code,
        c.cell_x as x,
        c.cell_y as y,
        c.color,
        c.updated_at,
        u.email
      FROM codes c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.cell_x IS NOT NULL
      ORDER BY c.updated_at DESC
      LIMIT 50
    `);

    res.json({
      ok: true,
      activityByDay: activityByDay.rows,
      recentActivity: recentActivity.rows
    });
  } catch (err) {
    console.error('Admin detailed stats error:', err);
    res.status(500).json({ error: 'stats_error' });
  } finally {
    client.release();
  }
});

// ===== ADMIN: GRID MODERATION =====
app.get("/api/admin/grid/cell/:x/:y", requireAdmin, async (req, res) => {
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const client = await pool.connect();

  try {
    const cell = await client.query(
      "SELECT c.code, c.user_id, u.email, c.color, c.updated_at FROM codes c LEFT JOIN users u ON c.user_id = u.id WHERE c.cell_x = $1 AND c.cell_y = $2",
      [x, y]
    );

    if (cell.rowCount === 0) {
      return res.json({ ok: true, cell: null });
    }

    res.json({ ok: true, cell: cell.rows[0] });
  } catch (err) {
    console.error('Admin cell info error:', err);
    res.status(500).json({ error: 'cell_info_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/grid/cell/:x/:y/clear", requireAdmin, async (req, res) => {
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE codes SET cell_x = NULL, cell_y = NULL, color = NULL WHERE cell_x = $1 AND cell_y = $2",
      [x, y]
    );

    // Increment state version
    await client.query("UPDATE config SET state_version = state_version + 1 WHERE id = TRUE");

    await client.query("COMMIT");

    // Broadcast update via WebSocket
    io.emit('cell_update', { x, y, color: 0 });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error('Admin clear cell error:', err);
    res.status(500).json({ error: 'clear_cell_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/grid/reset", requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Clear all cells
    await client.query("UPDATE codes SET cell_x = NULL, cell_y = NULL, color = NULL");

    // Increment state version
    await client.query("UPDATE config SET state_version = state_version + 1 WHERE id = TRUE");

    await client.query("COMMIT");

    // Broadcast full reset
    io.emit('full_reset');

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error('Admin reset grid error:', err);
    res.status(500).json({ error: 'reset_grid_error' });
  } finally {
    client.release();
  }
});

// ===== ADMIN: CONFIGURATION =====
app.get("/api/admin/config", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const config = await client.query("SELECT grid_w, grid_h, palette FROM config WHERE id = TRUE");
    res.json({ ok: true, config: config.rows[0] });
  } catch (err) {
    console.error('Admin get config error:', err);
    res.status(500).json({ error: 'config_error' });
  } finally {
    client.release();
  }
});

app.post("/api/admin/config/palette", requireAdmin, async (req, res) => {
  const { palette } = req.body;

  if (!Array.isArray(palette) || palette.length !== 10) {
    return res.status(400).json({ error: 'invalid_palette' });
  }

  // Validate hex colors
  const hexRegex = /^#[0-9A-F]{6}$/i;
  if (!palette.every(color => hexRegex.test(color))) {
    return res.status(400).json({ error: 'invalid_colors' });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "UPDATE config SET palette = $1 WHERE id = TRUE",
      [JSON.stringify(palette)]
    );

    // Increment state version
    await client.query("UPDATE config SET state_version = state_version + 1 WHERE id = TRUE");

    await client.query("COMMIT");

    // Invalidate config cache to force refresh
    clearCache('config');

    // Broadcast palette update
    io.emit('palette_update', { palette });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error('Admin update palette error:', err);
    res.status(500).json({ error: 'update_palette_error' });
  } finally {
    client.release();
  }
});

// ===== PUBLIC: LEADERBOARD =====
app.get("/api/leaderboard", async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(Number(req.query.limit || 10), 50);

    const leaderboard = await client.query(`
      SELECT
        u.email,
        COUNT(c.id)::int as painted_count
      FROM users u
      INNER JOIN codes c ON u.id = c.user_id
      WHERE c.cell_x IS NOT NULL
      GROUP BY u.id, u.email
      HAVING COUNT(c.id) > 0
      ORDER BY painted_count DESC
      LIMIT $1
    `, [limit]);

    // Anonymize emails (keep first 3 chars + ***)
    const anonymized = leaderboard.rows.map(row => ({
      email: row.email.substring(0, 3) + '***@' + row.email.split('@')[1],
      painted_count: row.painted_count
    }));

    res.json({ ok: true, leaderboard: anonymized });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'leaderboard_error' });
  } finally {
    client.release();
  }
});

// Get analytics data (admin only)
app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const category = req.query.category;

  let events = analytics.events;

  // Filter by category if provided
  if (category) {
    events = events.filter(e => e.category === category);
  }

  // Return last N events
  const recentEvents = events.slice(-limit);

  // Calculate some basic stats
  const stats = {
    total_events: analytics.events.length,
    categories: {},
    actions: {}
  };

  analytics.events.forEach(event => {
    stats.categories[event.category] = (stats.categories[event.category] || 0) + 1;
    stats.actions[event.action] = (stats.actions[event.action] || 0) + 1;
  });

  res.json({
    ok: true,
    events: recentEvents,
    stats,
    cache_info: {
      size: cache.size,
      keys: Array.from(cache.keys())
    }
  });
});

// Clear cache (admin only)
app.post("/api/admin/cache/clear", requireAdmin, async (req, res) => {
  const key = req.body?.key;

  clearCache(key);

  log('info', 'Cache cleared', { key: key || 'all' });

  res.json({
    ok: true,
    message: key ? `Cache key '${key}' cleared` : 'All cache cleared'
  });
});

// ===== COMMERCIAL: TIERS =====

// Get all tiers
app.get("/api/tiers", async (req, res) => {
  const client = await pool.connect();
  try {
    const tiers = await tierService.getAllTiers(client);
    res.json({ ok: true, tiers });
  } catch (err) {
    log('error', 'Get tiers error', { error: err.message });
    res.status(500).json({ error: 'get_tiers_error' });
  } finally {
    client.release();
  }
});

// Get current tier
app.get("/api/tier/current", async (req, res) => {
  const client = await pool.connect();
  try {
    const currentTier = await tierService.getCurrentTier(client);
    res.json({ ok: true, currentTier });
  } catch (err) {
    log('error', 'Get current tier error', { error: err.message });
    res.status(500).json({ error: 'get_current_tier_error' });
  } finally {
    client.release();
  }
});

// Get tier progress
app.get("/api/tier/progress", async (req, res) => {
  const client = await pool.connect();
  try {
    const progress = await tierService.getTierProgress(client);
    res.json({ ok: true, progress });
  } catch (err) {
    log('error', 'Get tier progress error', { error: err.message });
    res.status(500).json({ error: 'get_tier_progress_error' });
  } finally {
    client.release();
  }
});

// ===== COMMERCIAL: TICKETS (PUBLIC) =====

// Create a ticket (manual mode - for testing)
app.post("/api/ticket/create", rateLimit(5, 60000), async (req, res) => {
  const { email, amount } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticket = await ticketService.createTicket(client, {
      email,
      amount: amount || 2.00,
      paymentProvider: 'manual'
    });

    await client.query('COMMIT');

    trackEvent('ticket', 'created', ticket.order_id);
    log('info', 'Ticket created', { orderId: ticket.order_id, email });

    res.json({ ok: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create ticket error', { error: err.message });
    res.status(500).json({ error: 'create_ticket_error' });
  } finally {
    client.release();
  }
});

// Get ticket by order ID
app.get("/api/ticket/:orderId", async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    const ticket = await ticketService.getTicketByOrderId(client, orderId);

    if (!ticket) {
      return res.status(404).json({ error: 'ticket_not_found' });
    }

    res.json({ ok: true, ticket });
  } catch (err) {
    log('error', 'Get ticket error', { error: err.message });
    res.status(500).json({ error: 'get_ticket_error' });
  } finally {
    client.release();
  }
});

// Get user tickets
app.get("/api/user/tickets", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email_required' });
  }

  const client = await pool.connect();
  try {
    const tickets = await ticketService.getUserTickets(client, email);
    res.json({ ok: true, tickets });
  } catch (err) {
    log('error', 'Get user tickets error', { error: err.message });
    res.status(500).json({ error: 'get_user_tickets_error' });
  } finally {
    client.release();
  }
});

// ===== COMMERCIAL: TICKETS (ADMIN) =====

// Confirm ticket payment (manual mode)
app.post("/api/admin/ticket/:orderId/confirm", requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await ticketService.confirmTicketPayment(client, orderId);

    await client.query('COMMIT');

    trackEvent('ticket', 'confirmed', orderId);
    log('info', 'Ticket confirmed', { orderId, code: result.code });

    // Broadcast tier upgrade if it happened
    if (result.tierUpgrade && result.tierUpgrade.upgraded) {
      io.emit('tier_upgrade', {
        oldTier: result.tierUpgrade.oldTier,
        newTier: result.tierUpgrade.newTier,
        expansion: result.tierUpgrade.expansion
      });

      // Clear config cache to force refresh
      clearCache('config');
    }

    res.json({ ok: true, result });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Confirm ticket error', { error: err.message });
    res.status(500).json({ error: 'confirm_ticket_error', message: err.message });
  } finally {
    client.release();
  }
});

// Cancel/refund ticket
app.post("/api/admin/ticket/:orderId/cancel", requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ticket = await ticketService.cancelTicket(client, orderId);

    await client.query('COMMIT');

    trackEvent('ticket', 'cancelled', orderId);
    log('info', 'Ticket cancelled', { orderId });

    res.json({ ok: true, ticket });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Cancel ticket error', { error: err.message });
    res.status(500).json({ error: 'cancel_ticket_error', message: err.message });
  } finally {
    client.release();
  }
});

// Get all tickets (admin)
app.get("/api/admin/tickets", requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const client = await pool.connect();
  try {
    const tickets = await ticketService.getRecentTickets(client, limit);
    const stats = await ticketService.getTicketStats(client);

    res.json({ ok: true, tickets, stats });
  } catch (err) {
    log('error', 'Get admin tickets error', { error: err.message });
    res.status(500).json({ error: 'get_admin_tickets_error' });
  } finally {
    client.release();
  }
});

// Bulk create tickets (admin)
app.post("/api/admin/tickets/bulk", requireAdmin, async (req, res) => {
  const { tickets } = req.body;

  if (!tickets || !Array.isArray(tickets)) {
    return res.status(400).json({ error: 'tickets_array_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdTickets = await ticketService.bulkCreateTickets(client, tickets);

    await client.query('COMMIT');

    trackEvent('ticket', 'bulk_created', null, createdTickets.length);
    log('info', 'Bulk tickets created', { count: createdTickets.length });

    res.json({ ok: true, tickets: createdTickets });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Bulk create tickets error', { error: err.message });
    res.status(500).json({ error: 'bulk_create_tickets_error' });
  } finally {
    client.release();
  }
});

// ===== COMMERCIAL: LOTTERY/PRIZES (ADMIN) =====

// Create a prize draw
app.post("/api/admin/prize/create", requireAdmin, async (req, res) => {
  const { tierId, name, amount, prizeType, drawDate } = req.body;

  if (!tierId) {
    return res.status(400).json({ error: 'tier_id_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prize = await lotteryService.createPrizeDraw(client, {
      tierId,
      name,
      amount,
      prizeType,
      drawDate: drawDate ? new Date(drawDate) : null
    });

    await client.query('COMMIT');

    trackEvent('prize', 'created', prize.name);
    log('info', 'Prize created', { prizeId: prize.id, name: prize.name });

    res.json({ ok: true, prize });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create prize error', { error: err.message });
    res.status(500).json({ error: 'create_prize_error', message: err.message });
  } finally {
    client.release();
  }
});

// Draw a prize
app.post("/api/admin/prize/:prizeId/draw", requireAdmin, async (req, res) => {
  const { prizeId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prize = await lotteryService.drawPrize(client, parseInt(prizeId));

    await client.query('COMMIT');

    trackEvent('prize', 'drawn', prize.name, prize.amount);
    log('info', 'Prize drawn', { prizeId: prize.id, winner: prize.winner_email });

    // Broadcast prize draw event
    io.emit('prize_drawn', {
      prizeId: prize.id,
      prizeName: prize.name,
      tierNumber: prize.tier_number
    });

    res.json({ ok: true, prize });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Draw prize error', { error: err.message });
    res.status(500).json({ error: 'draw_prize_error', message: err.message });
  } finally {
    client.release();
  }
});

// Get prize by ID
app.get("/api/admin/prize/:prizeId", requireAdmin, async (req, res) => {
  const { prizeId } = req.params;

  const client = await pool.connect();
  try {
    const prize = await lotteryService.getPrizeById(client, parseInt(prizeId));

    if (!prize) {
      return res.status(404).json({ error: 'prize_not_found' });
    }

    res.json({ ok: true, prize });
  } catch (err) {
    log('error', 'Get prize error', { error: err.message });
    res.status(500).json({ error: 'get_prize_error' });
  } finally {
    client.release();
  }
});

// Get all prizes
app.get("/api/admin/prizes", requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const client = await pool.connect();
  try {
    const result = await lotteryService.getAllPrizes(client, page, limit);
    const stats = await lotteryService.getPrizeStats(client);

    res.json({ ok: true, ...result, stats });
  } catch (err) {
    log('error', 'Get prizes error', { error: err.message });
    res.status(500).json({ error: 'get_prizes_error' });
  } finally {
    client.release();
  }
});

// Get pending prizes
app.get("/api/admin/prizes/pending", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const prizes = await lotteryService.getPendingPrizes(client);
    res.json({ ok: true, prizes });
  } catch (err) {
    log('error', 'Get pending prizes error', { error: err.message });
    res.status(500).json({ error: 'get_pending_prizes_error' });
  } finally {
    client.release();
  }
});

// Mark prize as claimed
app.post("/api/admin/prize/:prizeId/claim", requireAdmin, async (req, res) => {
  const { prizeId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prize = await lotteryService.markPrizeAsClaimed(client, parseInt(prizeId));

    await client.query('COMMIT');

    trackEvent('prize', 'claimed', prize.name);
    log('info', 'Prize claimed', { prizeId: prize.id });

    res.json({ ok: true, prize });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Claim prize error', { error: err.message });
    res.status(500).json({ error: 'claim_prize_error', message: err.message });
  } finally {
    client.release();
  }
});

// Mark prize as paid
app.post("/api/admin/prize/:prizeId/pay", requireAdmin, async (req, res) => {
  const { prizeId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const prize = await lotteryService.markPrizeAsPaid(client, parseInt(prizeId));

    await client.query('COMMIT');

    trackEvent('prize', 'paid', prize.name);
    log('info', 'Prize paid', { prizeId: prize.id });

    res.json({ ok: true, prize });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Pay prize error', { error: err.message });
    res.status(500).json({ error: 'pay_prize_error', message: err.message });
  } finally {
    client.release();
  }
});

// ===== COMMERCIAL: REFERRALS =====

// Create referral
app.post("/api/referral/create", rateLimit(10, 60000), async (req, res) => {
  const { userId, referredEmail } = req.body;

  if (!userId || !referredEmail) {
    return res.status(400).json({ error: 'user_id_and_email_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const referral = await referralService.createReferral(client, userId, referredEmail);

    await client.query('COMMIT');

    trackEvent('referral', 'created', referredEmail);
    log('info', 'Referral created', { userId, referredEmail });

    res.json({ ok: true, referral });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create referral error', { error: err.message });
    res.status(500).json({ error: 'create_referral_error', message: err.message });
  } finally {
    client.release();
  }
});

// Check referral eligibility
app.get("/api/referral/check", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email_required' });
  }

  const client = await pool.connect();
  try {
    const eligibility = await referralService.checkReferralEligibility(client, email);
    res.json({ ok: true, ...eligibility });
  } catch (err) {
    log('error', 'Check referral eligibility error', { error: err.message });
    res.status(500).json({ error: 'check_eligibility_error' });
  } finally {
    client.release();
  }
});

// Get user referrals
app.get("/api/user/:userId/referrals", async (req, res) => {
  const { userId } = req.params;

  const client = await pool.connect();
  try {
    const referrals = await referralService.getReferralsByUser(client, parseInt(userId));
    const stats = await referralService.getUserReferralStats(client, parseInt(userId));

    res.json({ ok: true, referrals, stats });
  } catch (err) {
    log('error', 'Get user referrals error', { error: err.message });
    res.status(500).json({ error: 'get_user_referrals_error' });
  } finally {
    client.release();
  }
});

// Get all referrals (admin)
app.get("/api/admin/referrals", requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  const client = await pool.connect();
  try {
    const result = await referralService.getAllReferrals(client, page, limit);
    const stats = await referralService.getReferralStats(client);
    const topReferrers = await referralService.getTopReferrers(client, 10);

    res.json({ ok: true, ...result, stats, topReferrers });
  } catch (err) {
    log('error', 'Get referrals error', { error: err.message });
    res.status(500).json({ error: 'get_referrals_error' });
  } finally {
    client.release();
  }
});

// ===== STRIPE CHECKOUT =====

// Create Stripe Checkout session
app.post("/api/create-checkout-session", rateLimit(5, 60000), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'stripe_not_configured', message: 'Stripe is not configured on this server' });
  }

  const { email, packKey } = req.body;

  if (!email || !packKey) {
    return res.status(400).json({ error: 'email_and_pack_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the pack purchase (status: pending)
    const result = await packService.createPackPurchase(client, {
      email,
      packKey,
      paymentProvider: 'stripe'
    });

    await client.query('COMMIT');

    const { ticket, pack } = result;

    // Determine base URL for redirects
    const baseUrl = req.headers.origin || `${req.protocol}://${req.get('host')}`;

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `FRESQ - Pack ${pack.label}`,
            description: `${pack.totalTickets} ticket${pack.totalTickets > 1 ? 's' : ''} (${pack.baseTickets} + ${pack.bonusTickets} bonus)`,
          },
          unit_amount: Math.round(pack.price * 100), // Stripe uses cents
        },
        quantity: 1,
      }],
      metadata: {
        order_id: ticket.order_id,
        pack_key: packKey,
        email: email,
      },
      success_url: `${baseUrl}/?payment=success&order_id=${ticket.order_id}`,
      cancel_url: `${baseUrl}/?payment=cancelled`,
    });

    // Store the Stripe session ID on the ticket
    await pool.query(
      'UPDATE tickets SET payment_session_id = $1 WHERE order_id = $2',
      [session.id, ticket.order_id]
    );

    trackEvent('stripe', 'checkout_created', packKey, pack.price);
    log('info', 'Stripe checkout created', { orderId: ticket.order_id, packKey, sessionId: session.id });

    res.json({ ok: true, url: session.url, sessionId: session.id, orderId: ticket.order_id });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create checkout session error', { error: err.message });
    res.status(500).json({ error: 'checkout_error', message: err.message });
  } finally {
    client.release();
  }
});

// Check Stripe session status (for polling after redirect)
app.get("/api/stripe/session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.json({
      ok: true,
      status: session.payment_status,
      orderId: session.metadata?.order_id,
    });
  } catch (err) {
    log('error', 'Get stripe session error', { error: err.message });
    res.status(500).json({ error: 'session_error' });
  }
});

// ===== COMMERCIAL: PACKS =====

// Get available packs
app.get("/api/packs", async (req, res) => {
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

// Create pack purchase
app.post("/api/pack/purchase", rateLimit(5, 60000), async (req, res) => {
  const { email, packKey } = req.body;

  if (!email || !packKey) {
    return res.status(400).json({ error: 'email_and_pack_required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await packService.createPackPurchase(client, {
      email,
      packKey,
      paymentProvider: 'manual'
    });

    await client.query('COMMIT');

    trackEvent('pack', 'purchased', packKey, result.pack.totalTickets);
    log('info', 'Pack purchased', { email, packKey, totalTickets: result.pack.totalTickets });

    res.json({ ok: true, ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Pack purchase error', { error: err.message });
    res.status(500).json({ error: 'pack_purchase_error', message: err.message });
  } finally {
    client.release();
  }
});

// Confirm pack purchase (admin)
app.post("/api/admin/pack/:orderId/confirm", requireAdmin, async (req, res) => {
  const { orderId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await packService.confirmPackPurchase(client, orderId);

    await client.query('COMMIT');

    trackEvent('pack', 'confirmed', orderId, result.totalCodes);
    log('info', 'Pack confirmed', { orderId, codesGenerated: result.totalCodes });

    // Broadcast tier upgrade if occurred
    if (result.tierUpgrade && result.tierUpgrade.upgraded) {
      io.emit('tier_upgrade', {
        oldTier: result.tierUpgrade.oldTier,
        newTier: result.tierUpgrade.newTier,
        expansion: result.tierUpgrade.expansion
      });

      // Invalidate config cache
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

// Get pack statistics (admin)
app.get("/api/admin/packs/stats", requireAdmin, async (req, res) => {
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

// Update pack configuration (admin)
app.put("/api/admin/pack/:packKey", requireAdmin, async (req, res) => {
  const { packKey } = req.params;
  const updates = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updatedPack = await packService.updatePackConfig(client, packKey, updates);

    await client.query('COMMIT');

    trackEvent('pack', 'config_updated', packKey);
    log('info', 'Pack config updated', { packKey, updates });

    res.json({ ok: true, pack: updatedPack });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Update pack config error', { error: err.message });
    res.status(500).json({ error: 'update_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// Create new pack configuration (admin)
app.post("/api/admin/pack/create", requireAdmin, async (req, res) => {
  const packData = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const newPack = await packService.createPackConfig(client, packData);

    await client.query('COMMIT');

    trackEvent('pack', 'config_created', packData.packKey);
    log('info', 'Pack config created', { packKey: packData.packKey });

    res.json({ ok: true, pack: newPack });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Create pack config error', { error: err.message });
    res.status(500).json({ error: 'create_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// Delete pack configuration (admin)
app.delete("/api/admin/pack/:packKey", requireAdmin, async (req, res) => {
  const { packKey } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await packService.deletePackConfig(client, packKey);

    await client.query('COMMIT');

    trackEvent('pack', 'config_deleted', packKey);
    log('info', 'Pack config deleted', { packKey });

    res.json({ ok: true, message: 'Pack deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', 'Delete pack config error', { error: err.message });
    res.status(500).json({ error: 'delete_pack_error', message: err.message });
  } finally {
    client.release();
  }
});

// ===== WEBSOCKET CONNECTION =====
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ===== STATIC FILES =====
// Disable cache in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
}

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (process.env.NODE_ENV === 'development') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

httpServer.listen(PORT, () => {
  console.log(`🚀 FRESQ V2 running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server ready`);
});
