import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { webRoutes } from "@openbag/web";
import { D1Client } from "@openbag/core";

const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const USER = "edittest";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `session=${encodeURIComponent(USER)}`, ...extra };
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return webRoutes().fetch(new Request(`https://x${path}`, init), env as any, ctx);
}

async function insertEntry(overrides: Partial<{ content: string | null; content_raw: string | null }> = {}) {
  const r = await env.DB.prepare(
    "INSERT INTO entries (user_id, url, url_hash, title, content, content_raw, reading_time, mimetype) VALUES (?,?,?,?,?,?,?,?) RETURNING id",
  )
    .bind(1, "https://e/" + Math.random(), "h" + Math.random(), "T", overrides.content ?? "", overrides.content_raw ?? null, 1, "text/html")
    .first<{ id: number }>();
  return r!.id;
}

beforeAll(async () => {
  const d = new D1Client(env.DB);
  await d.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`, []);
  await d.run(`CREATE TABLE IF NOT EXISTS entries (
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
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM entries").run();
  await env.DB.prepare("DELETE FROM users").run();
  await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash) VALUES (1, ?, 'x')",
  ).bind(USER).run();
});

describe("GET /entries/:id — editing affordances", () => {
  it("renders the edit button, content div id, and editor.js when content exists", async () => {
    const id = await insertEntry({ content: "<p>body</p>" });
    const res = await request(`/entries/${id}`, { headers: authHeaders() });
    const body = await res.text();
    expect(body).toContain('id="entry-content"');
    expect(body).toContain('data-has-raw="0"');
    expect(body).toContain('id="entry-edit-btn"');
    expect(body).toContain('src="/editor.js"');
  });

  it("omits the edit affordances when there is no content", async () => {
    const id = await insertEntry({ content: "" });
    const res = await request(`/entries/${id}`, { headers: authHeaders() });
    const body = await res.text();
    expect(body).not.toContain('id="entry-edit-btn"');
    expect(body).not.toContain('src="/editor.js"');
  });

  it("requires a session (redirects to /login without cookie)", async () => {
    const id = await insertEntry({ content: "<p>x</p>" });
    const res = await request(`/entries/${id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

describe("POST /entries/:id/content", () => {
  it("sanitizes and persists the content", async () => {
    const id = await insertEntry({ content: "<p>orig</p>" });
    const form = new URLSearchParams({ content: '<p>edited</p><script>alert(1)</script>' });
    const res = await request(`/entries/${id}/content`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" }),
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="entry-content"');
    expect(html).toContain("edited");
    expect(html).not.toContain("script");
    expect(html).toContain('data-has-raw="1"');

    const row = await env.DB.prepare("SELECT content, content_raw, reading_time FROM entries WHERE id = ?").bind(id).first<{ content: string; content_raw: string | null; reading_time: number }>();
    expect(row!.content).toBe("<p>edited</p>");
    expect(row!.content_raw).toBe("<p>orig</p>");
    expect(row!.reading_time).toBeGreaterThanOrEqual(1);
  });

  it("snapshots content_raw only on the first edit", async () => {
    const id = await insertEntry({ content: "<p>original</p>" });
    const post = (content: string) =>
      request(`/entries/${id}/content`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" }),
        body: new URLSearchParams({ content }).toString(),
      });

    await post("<p>first edit</p>");
    await post("<p>second edit</p>");

    const row = await env.DB.prepare("SELECT content, content_raw FROM entries WHERE id = ?").bind(id).first<{ content: string; content_raw: string }>();
    expect(row!.content).toBe("<p>second edit</p>");
    expect(row!.content_raw).toBe("<p>original</p>");
  });

  it("redirects (non-XHR) to the entry page", async () => {
    const id = await insertEntry({ content: "<p>orig</p>" });
    const res = await request(`/entries/${id}/content`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({ content: "<p>x</p>" }).toString(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/entries/${id}`);
  });

  it("returns 404 for another user's entry", async () => {
    const id = await insertEntry({ content: "<p>o</p>" });
    await env.DB.prepare("UPDATE entries SET user_id = 999 WHERE id = ?").bind(id).run();
    const res = await request(`/entries/${id}/content`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" }),
      body: new URLSearchParams({ content: "<p>x</p>" }).toString(),
    });
    expect(res.status).toBe(404);
  });

  it("strips an inline event handler from submitted content", async () => {
    const id = await insertEntry({ content: "<p>o</p>" });
    await request(`/entries/${id}/content`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" }),
      body: new URLSearchParams({ content: '<img src="x.jpg" onerror="alert(1)">' }).toString(),
    });
    const row = await env.DB.prepare("SELECT content FROM entries WHERE id = ?").bind(id).first<{ content: string }>();
    expect(row!.content).not.toContain("onerror");
    expect(row!.content).toContain('src="x.jpg"');
  });
});

describe("POST /entries/:id/content/reset", () => {
  it("restores content from content_raw", async () => {
    const id = await insertEntry({ content: "<p>changed</p>", content_raw: "<p>original</p>" });
    const res = await request(`/entries/${id}/content/reset`, {
      method: "POST",
      headers: authHeaders({ "x-requested-with": "XMLHttpRequest" }),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("original");

    const row = await env.DB.prepare("SELECT content, content_raw FROM entries WHERE id = ?").bind(id).first<{ content: string; content_raw: string }>();
    expect(row!.content).toBe("<p>original</p>");
    expect(row!.content_raw).toBe("<p>original</p>");
  });

  it("returns 400 when there is no original to restore", async () => {
    const id = await insertEntry({ content: "<p>never edited</p>" });
    const res = await request(`/entries/${id}/content/reset`, {
      method: "POST",
      headers: authHeaders({ "x-requested-with": "XMLHttpRequest" }),
    });
    expect(res.status).toBe(400);
  });

  it("redirects (non-XHR) to the entry page on reset", async () => {
    const id = await insertEntry({ content: "<p>x</p>", content_raw: "<p>orig</p>" });
    const res = await request(`/entries/${id}/content/reset`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/entries/${id}`);
  });
});
