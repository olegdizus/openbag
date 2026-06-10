import { D1Client } from "@wallabag/core";

async function verifyPassword(password: string, hashHex: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bytes = new Uint8Array(hashHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
  const salt = bytes.slice(0, 16);
  const expected = bytes.slice(16);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  const derived = new Uint8Array(bits);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

export async function passwordGrant(env: any, username: string, password: string) {
  const db = new D1Client(env.DB);
  const user = await db.one("SELECT id, password_hash FROM users WHERE username = ?", [username]);
  if (!user) throw new Error("Invalid credentials");
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error("Invalid credentials");
  return user.id;
}

export async function refreshTokenGrant(env: any, refreshToken: string) {
  const db = new D1Client(env.DB);
  const row = await db.one(
    "SELECT user_id, client_id FROM oauth_refresh_tokens WHERE token = ? AND expires_at > datetime('now')",
    [refreshToken]
  );
  return row;
}

export async function exchangeAuthCode(env: any, code: string) {
  const db = new D1Client(env.DB);
  const row = await db.one(
    "SELECT user_id, client_id FROM oauth_auth_codes WHERE token = ? AND expires_at > datetime('now')",
    [code]
  );
  await db.run("DELETE FROM oauth_auth_codes WHERE token = ?", [code]);
  return row;
}
