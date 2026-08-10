// Shared data helpers for feed tokens (ADR-0014). Pure data — XML
// generation stays in the route handler.

import { D1Client } from "../db";
import { randomHex, tokenHash } from "../crypto";

/**
 * User's feed-token response shape. The UI settings page and the API endpoint
 * both go through these helpers so they share one query path.
 */
export interface FeedToken {
  /** A token exists (hashed at rest — the value can't be reconstructed). */
  has_token: boolean;
  /** Always null on read; the plaintext is returned only by `rotateFeedToken`. */
  feed_token: string | null;
  atom_url: string | null;
  rss_url: string | null;
}

export async function getFeedToken(env: any, userId: number, baseUrl: string): Promise<FeedToken> {
  const dbc = new D1Client(env.DB);
  const row = await dbc.one<{ feed_token: string | null }>(
    "SELECT u.feed_token FROM users u WHERE u.id = ?",
    [userId],
  );
  // Token is hashed at rest — we can confirm it exists but not reconstruct it.
  // The plaintext is returned only by `rotateFeedToken` (shown once).
  return { has_token: !!row?.feed_token, feed_token: null, atom_url: null, rss_url: null };
}

/**
 * Resolve an incoming `?token=` feed token to a user id, or null. Hashes the
 * token before lookup (the stored value is sha256, never plaintext).
 */
export async function resolveFeedTokenUserId(env: any, token: string): Promise<number | null> {
  const dbc = new D1Client(env.DB);
  const row = await dbc.one<{ id: number }>(
    "SELECT id FROM users WHERE feed_token = ?",
    [await tokenHash(token)],
  ).catch(() => null);
  return row?.id ?? null;
}

/** Old token stops working immediately (single value per user). Returns the
 *  raw token once — only its sha256 is persisted. */
export async function rotateFeedToken(env: any, userId: number): Promise<string> {
  const dbc = new D1Client(env.DB);
  const token = randomHex(32);
  await dbc.run(
    "UPDATE users SET feed_token = ?, updated_at = datetime('now') WHERE id = ?",
    [await tokenHash(token), userId],
  );
  return token;
}

/** Existing feed URLs return 401 immediately (no grace period). */
export async function revokeFeedToken(env: any, userId: number): Promise<void> {
  const dbc = new D1Client(env.DB);
  await dbc.run(
    "UPDATE users SET feed_token = NULL, updated_at = datetime('now') WHERE id = ?",
    [userId],
  );
}
