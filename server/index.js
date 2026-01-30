import express from "express";
import "dotenv/config";
import { pool } from "./db.js";
import { generateCode, normalizeCode } from "./utils.js";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

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

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email
      },
      codes: codesRes.rows
    });
  } catch (err) {
    console.error('User login error:', err);
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
    console.error('Claim code error:', err);
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
  const client = await pool.connect();
  try {
    const config = await getConfig(client);
    res.json({
      grid_w: config.grid_w,
      grid_h: config.grid_h,
      palette: config.palette
    });
  } catch (err) {
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

    // Broadcast cell claim via WebSocket
    io.emit('cell:claimed', { x, y });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
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

    // Broadcast cell paint via WebSocket
    io.emit('cell:painted', { x: row.cell_x, y: row.cell_y, color });

    res.json({ ok: true, x: row.cell_x, y: row.cell_y, color });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "paint_error" });
  } finally {
    client.release();
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

  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    return res.status(400).json({ error: 'invalid_count' });
  }

  const client = await pool.connect();
  try {
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = generateCode(8);
      const result = await client.query(
        "INSERT INTO codes (code) VALUES ($1) ON CONFLICT DO NOTHING RETURNING code",
        [code]
      );
      if (result.rowCount > 0) {
        codes.push(result.rows[0].code);
      }
    }

    res.json({ ok: true, generated: codes.length, codes });
  } catch (err) {
    res.status(500).json({ error: 'generate_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/codes", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 1000);

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT code, cell_x AS x, cell_y AS y, color FROM codes ORDER BY created_at DESC LIMIT $1",
      [limit]
    );

    res.json({ ok: true, codes: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'codes_error' });
  } finally {
    client.release();
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const totalRes = await client.query("SELECT COUNT(*)::int AS total FROM codes");
    const assignedRes = await client.query("SELECT COUNT(*)::int AS assigned FROM codes WHERE cell_x IS NOT NULL");

    res.json({
      ok: true,
      counts: {
        total_codes: totalRes.rows[0].total,
        assigned_codes: assignedRes.rows[0].assigned
      }
    });
  } catch (err) {
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

// ===== WEBSOCKET CONNECTION =====
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname, "..", "public")));

httpServer.listen(PORT, () => {
  console.log(`🚀 FRESQ V2 running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server ready`);
});
