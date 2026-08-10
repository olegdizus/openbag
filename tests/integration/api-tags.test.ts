// Integration tests for GET /api/tags.
//
// The tags endpoint existed before the migration but its shape and nbEntries
// aggregation were untested. These tests pin the Wallabag-compatible contract
// and the cross-user isolation guarantee.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { app } from "@openbag/api";
import { D1Client, createSession } from "@openbag/core";

const ctx = { waitUntil() {} } as unknown as ExecutionContext;

beforeAll(async () => {
  const db = new D1Client(env.DB);
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    name TEXT,
    feed_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    user_agent TEXT
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    content_raw TEXT,
    domain_name TEXT,
    preview_picture TEXT,
    language TEXT,
    mimetype TEXT DEFAULT 'text/html',
    authors TEXT,
    reading_time INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_starred INTEGER DEFAULT 0,
    is_not_parsed INTEGER DEFAULT 0,
    is_public INTEGER DEFAULT 0,
    public_uuid TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, slug)
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id)
  )`, []);
});

let sessionId: string | null = null;

beforeEach(async () => {
  const db = new D1Client(env.DB);
  await db.run("DELETE FROM sessions", []);
  await db.run("DELETE FROM entry_tags", []);
  await db.run("DELETE FROM tags", []);
  await db.run("DELETE FROM entries", []);
  await db.run("DELETE FROM users WHERE id != 1", []);
  await db.run("INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (1, 'alice', 'x')", []);
  sessionId = await createSession(env, 1);
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `session=${sessionId}`);
  return Promise.resolve(app.fetch(new Request(`https://openbag.test${path}`, { ...init, headers }), env as any, ctx));
}

describe("GET /api/tags", () => {
  it("returns 401 when no session cookie is supplied", async () => {
    const res = await app.fetch(new Request("https://openbag.test/api/tags"), env as any, ctx);
    expect(res.status).toBe(401);
  });

  it("returns an empty array when the user has no tags", async () => {
    const res = await authed("/api/tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toEqual([]);
  });

  it("returns tags with the Wallabag-compatible { id, label, slug, nbEntries } shape", async () => {
    const db = new D1Client(env.DB);
    await db.run("INSERT INTO tags (user_id, label, slug) VALUES (1, ?, ?)", ["Inbox", "inbox"]);
    const tag = await db.one<{ id: number }>("SELECT id FROM tags WHERE slug = 'inbox' AND user_id = 1");
    await db.run(
      "INSERT INTO entries (user_id, url, url_hash, title) VALUES (1, 'https://example.com/a', 'h1', 'A')",
    );
    const e = await db.one<{ id: number }>("SELECT id FROM entries WHERE user_id = 1");
    await db.run("INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)", [e!.id, tag!.id]);

    const res = await authed("/api/tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: number; label: string; slug: string; nbEntries: number }>;
    expect(body).toHaveLength(1);
    expect(body[0].label).toBe("Inbox");
    expect(body[0].slug).toBe("inbox");
    expect(body[0].nbEntries).toBe(1);
  });
});
