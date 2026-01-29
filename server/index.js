import express from "express";
import "dotenv/config";
import { pool } from "./db.js";
import { generateCode, normalizeCode } from "./utils.js";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== HELPERS =====
async function getConfig(client) {
  const res = await client.query(
    "SELECT grid_w, grid_h, state_version, palette FROM config WHERE id = TRUE"
  );
  return res.rows[0];
}

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

app.post("/api/cell/claim", async (req, res) => {
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
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "claim_error" });
  } finally {
    client.release();
  }
});

app.post("/api/cell/paint", async (req, res) => {
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

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`🚀 FRESQ V2 running on http://localhost:${PORT}`);
});
