import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./server/db.js";

const email = "admin@fresq.local";
const password = "admin123";

async function createAdmin() {
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(password, 10);

    await client.query(
      "INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET password_hash = $2",
      [email, hash]
    );

    console.log("✅ Admin créé !");
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
  } catch (err) {
    console.error("❌ Erreur:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

createAdmin();
