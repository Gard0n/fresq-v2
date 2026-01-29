import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL");
}

const sslEnabled =
  String(process.env.DATABASE_SSL || "").toLowerCase() === "true" ||
  String(process.env.DATABASE_SSL || "") === "1";
const ssl = sslEnabled ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(ssl ? { ssl } : {})
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}
