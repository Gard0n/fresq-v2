import crypto from "crypto";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

export function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return out;
}

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}
