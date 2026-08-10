// Best-effort brute-force throttle for credential checks. D1-backed, keyed by
// username, capped + windowed. Fail-open: any DB error (incl. a missing table
// during dev) skips the throttle rather than blocking a legitimate login. The
// table is created lazily on first failure so callers (and test seeds) don't
// have to provision it — production gets it from schema.sql.

import { D1Client } from "../db";

const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60; // 15 min

/** True when the caller has exceeded the failure budget within the window. */
export async function isThrottled(env: any, username: string): Promise<boolean> {
  try {
    const db = new D1Client(env.DB);
    await ensureTable(db);
    const row = await db.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE key = ? AND attempted_at > datetime('now', '-${WINDOW_SECONDS} seconds')`,
      [username.toLowerCase()],
    );
    return !!row && row.n >= MAX_ATTEMPTS;
  } catch {
    return false; // fail-open — never block auth on a DB hiccup
  }
}

/** Record a failed credential check. */
export async function recordLoginFailure(env: any, username: string): Promise<void> {
  try {
    const db = new D1Client(env.DB);
    await ensureTable(db);
    await db.run(
      "INSERT INTO login_attempts (key, attempted_at) VALUES (?, datetime('now'))",
      [username.toLowerCase()],
    );
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
  ensured = true;
}
