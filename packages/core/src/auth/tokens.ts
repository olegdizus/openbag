import { D1Client } from "../db";
import { randomHex, tokenHash } from "../crypto";

export async function createAccessToken(env: any, userId: number, clientId: number) {
  const db = new D1Client(env.DB);
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  // Store sha256(token), not the raw token — a DB leak can't forge a bearer.
  await db.run(
    "INSERT INTO oauth_access_tokens (client_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    [clientId, userId, await tokenHash(token), expiresAt],
  );
  return token;
}

export async function createRefreshToken(env: any, userId: number, clientId: number) {
  const db = new D1Client(env.DB);
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await db.run(
    "INSERT INTO oauth_refresh_tokens (client_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    [clientId, userId, await tokenHash(token), expiresAt],
  );
  return token;
}
