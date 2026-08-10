// Best-effort brute-force throttle for credential checks. D1-backed, keyed by
// username, capped + windowed. Fail-open: any DB error (incl. a missing table
// during dev) skips the throttle rather than blocking a legitimate login. The
// table is created lazily on first failure so callers (and test seeds) don't
// have to provision it — production gets it from schema.sql.

import { D1Client } from "../db";

const MAX_ATTEMPTS = 10;
const MAX_IP_ATTEMPTS = 50; // looser per-IP bucket — tolerates NAT / shared egress
const WINDOW_SECONDS = 15 * 60; // 15 min

/** True when the caller has exceeded the failure budget within the window.
 *  Checks both the per-username bucket and (when `ip` is given) a per-IP
 *  bucket so credential-stuffing across many usernames is still throttled. */
export async function isThrottled(env: any, username: string, ip?: string): Promise<boolean> {
  try {
    const db = new D1Client(env.DB);
    await ensureTable(db);
    const keys = [username.toLowerCase()];
    if (ip) keys.push(`ip:${ip}`);
    const placeholders = keys.map(() => "?").join(",");
    const rows = await db.all<{ key: string; n: number }>(
      `SELECT key, COUNT(*) AS n FROM login_attempts
       WHERE key IN (${placeholders}) AND attempted_at > datetime('now', '-${WINDOW_SECONDS} seconds')
       GROUP BY key`,
      keys,
    );
    for (const r of rows) {
      const limit = r.key.startsWith("ip:") ? MAX_IP_ATTEMPTS : MAX_ATTEMPTS;
      if (r.n >= limit) return true;
    }
    return false;
  } catch {
    return false; // fail-open — never block auth on a DB hiccup
  }
}

/** Record a failed credential check (under both the username and IP keys). */
export async function recordLoginFailure(env: any, username: string, ip?: string): Promise<void> {
  try {
    const db = new D1Client(env.DB);
    await ensureTable(db);
    await db.run(
      "INSERT INTO login_attempts (key, attempted_at) VALUES (?, datetime('now'))",
      [username.toLowerCase()],
    );
    if (ip) {
      await db.run(
        "INSERT INTO login_attempts (key, attempted_at) VALUES (?, datetime('now'))",
        [`ip:${ip}`],
      );
    }
  } catch {
    /* fail-open */
  }
}

/** Clear failures for a key after a successful login. */
export async function clearLoginFailures(env: any, username: string): Promise<void> {
  try {
    const db = new D1Client(env.DB);
    await db.run("DELETE FROM login_attempts WHERE key = ?", [username.toLowerCase()]);
  } catch {
    /* fail-open */
  }
}

// Lazily create the table once per isolate; subsequent calls are a cheap no-op.
let ensured = false;
async function ensureTable(db: D1Client): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS login_attempts (
       key TEXT NOT NULL,
       attempted_at TEXT NOT NULL
     )`,
    [],
  );
  // L1: match schema.sql's index so the throttling COUNT(*) stays indexed even
  // when this isolate lazily creates the table (dev / a fresh DB).
  await db.run(
    `CREATE INDEX IF NOT EXISTS idx_login_attempts_key_time ON login_attempts(key, attempted_at)`,
    [],
  );
  ensured = true;
}
