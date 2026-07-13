// Session management — opaque session ids stored in a `sessions` table.
//
// Replaces the former forgeable `session=<urlencoded_username>` cookie. The
// cookie value is now a 32-byte hex secret; only its sha256 is persisted in
// D1, so a DB leak cannot forge a valid browser session.
//
// Three operations: create, lookup (used per-request by auth middleware),
// revoke (logout). Plus `clearSessionCookie` for the logout response.

import { D1Client, toHex, randomHex } from "./index";

/** Cookie name. Keep stable so logout works across the rollout. */
export const SESSION_COOKIE = "session";

/** Session lifetime in seconds (30 days, mirrors the cookie Max-Age). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 2592000

/** sha256(id) as lowercase hex; what we actually persist as `token_hash`. */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** Builds the `Set-Cookie` header value for a freshly issued session id. */
export function buildSessionCookie(id: string): string {
  // HttpOnly + Secure + SameSite=Strict keeps the cookie JS-invisible and
  // cross-site-proof. Same-origin Pages+Worker routing means no Domain attr.
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** Builds the cookie-clearing header value used on logout. */
export function buildExpiredCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * Issue a new session for `userId`. Returns the cookie id string (the raw
 * secret) so the caller can set the cookie. Records `userAgent` (limited
 * length) for the future "device list" UI.
 */
export async function createSession(
  env: any,
  userId: number,
  userAgent?: string,
): Promise<string> {
  const db = new D1Client(env.DB);
  const id = randomHex(32); // 256-bit opaque secret — the cookie value
  const tokenHash = await hashToken(id);
  await db.run(
    `INSERT INTO sessions (id, token_hash, user_id, expires_at, user_agent)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'), ?)`,
    [
      id,
      tokenHash,
      userId,
      String(SESSION_TTL_SECONDS),
      userAgent ? userAgent.slice(0, 256) : null,
    ],
  );
  return id;
}

/**
 * Look up a session by its raw cookie value. Returns the user row when valid;
 * null when the session is missing, expired, or belongs to a deleted user.
 * Side-effect: stamps `last_used_at` so the device list reflects real usage.
 */
export async function lookupSession(
  env: any,
  token: string | undefined | null,
): Promise<{ id: number; username: string } | null> {
  if (!token) return null;
  const db = new D1Client(env.DB);
  const tokenHash = await hashToken(token);
  const row = await db.one<{ user_id: number; expires_at: string }>(
    "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    [tokenHash],
  );
  if (!row) return null;
  // Paranoia: also verify expiry (the row may have outlived its window).
  const expiresAtMs = Date.parse(row.expires_at.replace(" ", "T") + "Z");
  if (!Number.isNaN(expiresAtMs) && expiresAtMs <= Date.now()) {
    // Best-effort cleanup; ignore the rejection if D1 is slow.
    await db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]).catch(() => { });
    return null;
  }
  const user = await db.one<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE id = ?",
    [row.user_id],
  );
  if (!user) return null;
  // Cheap, non-blocking timestamp update; failures don't fail auth.
  await db
    .run("UPDATE sessions SET last_used_at = datetime('now') WHERE token_hash = ?", [tokenHash])
    .catch(() => { });
  return user;
}

/**
 * Delete a session row by its raw cookie value. Idempotent — calling with an
 * unknown/already-revoked session is a no-op (returns silently).
 */
export async function revokeSession(env: any, token: string | undefined | null): Promise<void> {
  if (!token) return;
  const db = new D1Client(env.DB);
  const tokenHash = await hashToken(token);
  await db.run("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
}
