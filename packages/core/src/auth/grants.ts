import { D1Client } from "../db";
import { tokenHash } from "../crypto";
import { verifyPassword, DUMMY_HASH } from "./password";

export async function passwordGrant(env: any, username: string, password: string) {
  const db = new D1Client(env.DB);
  const user = await db.one("SELECT id, password_hash FROM users WHERE username = ?", [username]);
  if (!user) {
    // Equalize timing so a miss is as slow as a hit (username-enumeration defense).
    await verifyPassword(password, DUMMY_HASH);
    throw new Error("Invalid credentials");
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new Error("Invalid credentials");
  return user.id;
}

/**
 * Resolve a refresh token. Bound to `clientId` (RFC 6749 §10.4): a token minted
 * for client A cannot be redeemed by client B even if leaked. Looks up by
 * sha256(token) — the raw token is never stored.
 *
 * H1: rotates on use — the consumed token is deleted so a leaked refresh
 * token can't be replayed after the legitimate client refreshes (RFC 6749
 * §10.4 / OAuth 2.0 BCP §4.13.2). The caller mints a fresh one.
 */
export async function refreshTokenGrant(env: any, refreshToken: string, clientId: number) {
  const db = new D1Client(env.DB);
  const hash = await tokenHash(refreshToken);
  const row = await db.one<{ user_id: number }>(
    "SELECT user_id FROM oauth_refresh_tokens WHERE token = ? AND client_id = ? AND expires_at > datetime('now')",
    [hash, clientId],
  );
  if (!row) return null;
  await db.run("DELETE FROM oauth_refresh_tokens WHERE token = ?", [hash]);
  return row;
}

/** One-shot: exchange + delete, bound to `clientId`. Looks up by sha256(token). */
export async function exchangeAuthCode(env: any, code: string, clientId: number) {
  const db = new D1Client(env.DB);
  const row = await db.one<{ user_id: number }>(
    "SELECT user_id FROM oauth_auth_codes WHERE token = ? AND client_id = ? AND expires_at > datetime('now')",
    [await tokenHash(code), clientId],
  );
  await db.run("DELETE FROM oauth_auth_codes WHERE token = ?", [await tokenHash(code)]);
  return row ?? null;
}
