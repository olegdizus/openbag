// Shared data helpers for feed tokens (ADR-0014). Pure data — XML
// generation stays in the route handler.

import { D1Client } from "../db";
import { randomHex } from "../crypto";

/**
 * User's feed-token response shape. The UI settings page and the API endpoint
 * both go through these helpers so they share one query path.
 */
export interface FeedToken {
  feed_token: string | null;
  atom_url: string | null;
  rss_url: string | null;
}

export async function getFeedToken(env: any, userId: number, baseUrl: string): Promise<FeedToken> {
  const dbc = new D1Client(env.DB);
  const row = await dbc.one<{ feed_token: string | null; username: string }>(
    "SELECT u.feed_token, u.username FROM users u WHERE u.id = ?",
    [userId],
  );
  const token = row?.feed_token ?? null;
  const username = row?.username ?? "";
  const suffix = token ? `?token=${token}` : "";
  return {
    feed_token: token,
    atom_url: token ? `${baseUrl}/api/feeds/${encodeURIComponent(username)}.atom${suffix}` : null,
    rss_url: token ? `${baseUrl}/api/feeds/${encodeURIComponent(username)}.xml${suffix}` : null,
  };
}

/** Old token stops working immediately (single value per user). */
export async function rotateFeedToken(env: any, userId: number): Promise<string> {
  const dbc = new D1Client(env.DB);
  const token = randomHex(32);
  await dbc.run(
    "UPDATE users SET feed_token = ?, updated_at = datetime('now') WHERE id = ?",
    [token, userId],
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
