// Integration tests for the OAuth clients CRUD, config 7-field update,
// feed token read endpoint, and entry content reset endpoint.
//
// All these tests authenticate via a pre-seeded session row (cookie auth)
// so they exercise the cookie → authMiddleware path.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../../worker/src/api";
import { D1Client } from "../../worker/src";
import { createSession } from "../../worker/src/session";

const ctx = { waitUntil() { } } as unknown as ExecutionContext;

beforeAll(async () => {
  const db = new D1Client(env.DB);
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    name TEXT,
    feed_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS user_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    theme TEXT DEFAULT 'baggy',
    items_per_page INTEGER DEFAULT 30,
    reading_speed INTEGER DEFAULT 200,
    language TEXT DEFAULT 'en',
    action_mark_as_read INTEGER DEFAULT 0,
    list_mode INTEGER DEFAULT 0,
    display_thumbnails INTEGER DEFAULT 1,
    UNIQUE(user_id)
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
  await db.run(`CREATE TABLE IF NOT EXISTS oauth_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    random_id TEXT NOT NULL,
    secret TEXT NOT NULL,
    name TEXT NOT NULL,
    redirect_uris TEXT DEFAULT '[]',
    allowed_grant_types TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL,
    origin_url TEXT,
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
  await db.run("DELETE FROM oauth_clients", []);
  await db.run("DELETE FROM entry_tags", []);
  await db.run("DELETE FROM tags", []);
  await db.run("DELETE FROM entries", []);
  await db.run("DELETE FROM user_config WHERE user_id != 1", []);
  await db.run("DELETE FROM users WHERE id != 1", []);
  // Upsert test user #1 + config.
  await db.run(
    "INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (1, 'alice', 'x')",
    [],
  );
  await db.run("INSERT OR IGNORE INTO user_config (user_id) VALUES (1)", []);
  // Issue a fresh session.
  sessionId = await createSession(env, 1);
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `session=${sessionId}`);
  return app.fetch(new Request(`https://openbag.test${path}`, { ...init, headers }), env as any, ctx);
}

function jsonBody(o: unknown): string {
  return JSON.stringify(o);
}

describe("GET /api/oauth/clients", () => {
  it("returns an empty list when there are no clients", async () => {
    const res = await authed("/api/oauth/clients");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: any[] };
    expect(body.items).toEqual([]);
  });

  it("returns clients created via POST", async () => {
    const created = await authed("/api/oauth/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody({ name: "My App" }),
    });
    expect(created.status).toBe(201);
    const list = await authed("/api/oauth/clients");
    const body = (await list.json()) as { items: any[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("My App");
  });

  it("requires auth", async () => {
    const res = await app.fetch(
      new Request("https://openbag.test/api/oauth/clients"),
      env as any,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/oauth/clients", () => {
  it("returns the new client with random_id + secret", async () => {
    const res = await authed("/api/oauth/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody({ name: "Wallabag Android", redirect_uris: ["oob:wallabag"] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      random_id: string;
      secret: string;
      name: string;
      redirect_uris: string[];
    };
    expect(body.name).toBe("Wallabag Android");
    expect(body.random_id.length).toBeGreaterThanOrEqual(32);
    expect(body.secret.length).toBeGreaterThanOrEqual(32);
    expect(body.redirect_uris).toEqual(["oob:wallabag"]);
  });

  it("400s when name is missing", async () => {
    const res = await authed("/api/oauth/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/oauth/clients/:id", () => {
  it("deletes an owned client", async () => {
    const created = await authed("/api/oauth/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: jsonBody({ name: "ToDelete" }),
    });
    const c = (await created.json()) as { id: number };
    const del = await authed(`/api/oauth/clients/${c.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const list = (await (await authed("/api/oauth/clients")).json()) as { items: any[] };
    expect(list.items).toHaveLength(0);
  });

  it("404s when deleting another user's client", async () => {
    const db = new D1Client(env.DB);
    // Seed a client under user #2.
    await db.run(
      "INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (2, 'bob', 'x')",
      [],
    );
    await db.run(
      "INSERT INTO oauth_clients (user_id, random_id, secret, name) VALUES (2, 'r', 's', 'Bob-client')",
      [],
    );
    const row = await db.one<{ id: number }>("SELECT id FROM oauth_clients WHERE user_id = 2");
    expect(row).not.toBeNull();
    const del = await authed(`/api/oauth/clients/${row!.id}`, { method: "DELETE" });
    expect(del.status).toBe(404);
  });
});

describe("GET /api/feed/token (read)", () => {
  it("returns null fields when no token has been issued", async () => {
    const db = new D1Client(env.DB);
    await db.run("UPDATE users SET feed_token = NULL WHERE id = 1");
    const res = await authed("/api/feed/token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feed_token: string | null };
    expect(body.feed_token).toBeNull();
  });

  it("returns the current token without rotating it", async () => {
    const db = new D1Client(env.DB);
    await db.run("UPDATE users SET feed_token = 'abc123' WHERE id = 1");
    const res = await authed("/api/feed/token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feed_token: string; atom_url: string; rss_url: string };
    expect(body.feed_token).toBe("abc123"); // not rotated
    expect(body.atom_url).toContain("abc123");
    expect(body.atom_url).toContain("alice.atom");
  });
});

describe("PUT /api/config (7-field)", () => {
  it("persists the four fields that previously dropped (Phase 2 gap)", async () => {
    const res = await authed("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: jsonBody({
        reading_speed: 350,
        action_mark_as_read: true,
        list_mode: 1,
        display_thumbnails: false,
        theme: "dark",
        items_per_page: 50,
        language: "fr",
      }),
    });
    expect(res.status).toBe(200);

    const row = await new D1Client(env.DB).one(
      "SELECT theme, items_per_page, reading_speed, language, action_mark_as_read, list_mode, display_thumbnails FROM user_config WHERE user_id = 1",
      [],
    );
    expect(row).toMatchObject({
      theme: "dark",
      items_per_page: 50,
      reading_speed: 350,
      language: "fr",
      action_mark_as_read: 1,
      list_mode: 1,
      display_thumbnails: 0,
    });
  });

  it("accepts partial updates (only fields provided change)", async () => {
    // First set everything to known values.
    await new D1Client(env.DB).run(
      "UPDATE user_config SET reading_speed = 200, list_mode = 0 WHERE user_id = 1",
      [],
    );
    const res = await authed("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: jsonBody({ list_mode: 1 }),
    });
    expect(res.status).toBe(200);
    const row = await new D1Client(env.DB).one<{ reading_speed: number; list_mode: number }>(
      "SELECT reading_speed, list_mode FROM user_config WHERE user_id = 1",
      [],
    );
    expect(row!.reading_speed).toBe(200); // unchanged
    expect(row!.list_mode).toBe(1);
  });

  it("also accepts form-urlencoded bodies (Wallabag-style)", async () => {
    const form = new URLSearchParams({
      reading_speed: "275",
      action_mark_as_read: "on",
      list_mode: "1",
      display_thumbnails: "0",
    });
    const res = await authed("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    const row = await new D1Client(env.DB).one<{ reading_speed: number; action_mark_as_read: number; list_mode: number; display_thumbnails: number }>(
      "SELECT reading_speed, action_mark_as_read, list_mode, display_thumbnails FROM user_config WHERE user_id = 1",
      [],
    );
    expect(row!.reading_speed).toBe(275);
    expect(row!.action_mark_as_read).toBe(1);
    expect(row!.list_mode).toBe(1);
    expect(row!.display_thumbnails).toBe(0);
  });
});

describe("POST /api/entries/:id/content/reset", () => {
  async function insertEntry(opts: { content: string; content_raw: string | null }): Promise<number> {
    const r = await env.DB.prepare(
      "INSERT INTO entries (user_id, url, url_hash, title, content, content_raw, reading_time, mimetype) VALUES (1, ?, ?, ?, ?, ?, 1, 'text/html') RETURNING id",
    )
      .bind(
        "https://e/" + Math.random(),
        "h" + Math.random(),
        "T",
        opts.content,
        opts.content_raw,
      )
      .first<{ id: number }>();
    return r!.id;
  }

  it("restores content from content_raw and clears the snapshot", async () => {
    const id = await insertEntry({ content: "<p>edited</p>", content_raw: "<p>original</p>" });
    const res = await authed(`/api/entries/${id}/content/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; content_raw: null };
    expect(body.content).toBe("<p>original</p>");
    expect(body.content_raw).toBeNull();
    const row = await env.DB.prepare("SELECT content_raw FROM entries WHERE id = ?").bind(id).first<{ content_raw: string | null }>();
    expect(row!.content_raw).toBeNull();
  });

  it("409s when there is no snapshot to restore", async () => {
    const id = await insertEntry({ content: "<p>orig</p>", content_raw: null });
    const res = await authed(`/api/entries/${id}/content/reset`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("sanitizes the restored content", async () => {
    const id = await insertEntry({
      content: "<p>edited</p>",
      content_raw: "<p>restored</p><script>alert(1)</script>",
    });
    const res = await authed(`/api/entries/${id}/content/reset`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(body.content).toContain("restored");
    expect(body.content).not.toContain("script");
  });

  it("404s for another user's entry", async () => {
    const id = await insertEntry({ content: "<p>x</p>", content_raw: "<p>y</p>" });
    await env.DB.prepare("UPDATE entries SET user_id = 999 WHERE id = ?").bind(id).run();
    const res = await authed(`/api/entries/${id}/content/reset`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
