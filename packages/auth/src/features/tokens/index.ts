import { D1Client } from "@openbag/core";

function randomToken(len = 64): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export async function createAccessToken(env: any, userId: number, clientId: number) {
  const db = new D1Client(env.DB);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  await db.run(
    "INSERT INTO oauth_access_tokens (client_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    [clientId, userId, token, expiresAt]
  );
  return token;
}

export async function createRefreshToken(env: any, userId: number, clientId: number) {
  const db = new D1Client(env.DB);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await db.run(
    "INSERT INTO oauth_refresh_tokens (client_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    [clientId, userId, token, expiresAt]
  );
  return token;
}

export async function findAccessToken(env: any, token: string) {
  const db = new D1Client(env.DB);
  return db.one(
    "SELECT * FROM oauth_access_tokens WHERE token = ? AND expires_at > datetime('now')",
    [token]
  );
}

export async function revokeAccessToken(env: any, token: string) {
  const db = new D1Client(env.DB);
  await db.run("DELETE FROM oauth_access_tokens WHERE token = ?", [token]);
}

export async function revokeRefreshToken(env: any, token: string) {
  const db = new D1Client(env.DB);
  await db.run("DELETE FROM oauth_refresh_tokens WHERE token = ?", [token]);
}
