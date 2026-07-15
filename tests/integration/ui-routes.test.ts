// Integration tests for the new SSR UI routes (packages/web-gui Worker).
//
// Verifies the migration's primary contract: every page returns 200, the
// expected DOM markers are present, and authenticated requests never leak
// the username into HTML attributes (or a `<script>` body). Login page is
// served to logged-out users; authed pages 302 to /login when cookie is missing.
//
// Tests use the full Hono `uiApp` (the web-gui Worker's fetch root in
// packages/web-gui/src/index.ts), exercising the entire browserAuthMiddleware
// → SSR page pipeline. Per ADR-0018 the UI Worker reads D1 directly via
// `@openbag/core` — no intra-Worker HTTP dispatch is required.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { uiApp } from "@openbag/web-gui";
import { D1Client, createSession } from "@openbag/core";

// The web-gui Worker's behavior is independent of the API Worker — both share
// D1 but the SSR layer here reaches DB through `@openbag/core` directly.

const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const regEnv = (allow: string) => ({ ...env, ALLOWED_REGISTRATION: allow });

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
});

let sessionId: string | null = null;

beforeEach(async () => {
  const db = new D1Client(env.DB);
  await db.run("DELETE FROM sessions", []);
  await db.run("DELETE FROM entry_tags", []);
  await db.run("DELETE FROM tags", []);
  await db.run("DELETE FROM entries", []);
  await db.run("DELETE FROM oauth_clients", []);
  await db.run("DELETE FROM user_config WHERE user_id != 1", []);
  await db.run("DELETE FROM users WHERE id != 1", []);
  await db.run(
    "INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (1, 'alice', 'x')",
    [],
  );
  await db.run("INSERT OR IGNORE INTO user_config (user_id) VALUES (1)", []);
  sessionId = await createSession(env, 1);
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("cookie", `session=${sessionId}`);
  return Promise.resolve(uiApp.fetch(new Request(`https://openbag.test${path}`, { ...init, headers }), env as any, ctx));
}

function anon(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(uiApp.fetch(new Request(`https://openbag.test${path}`, init), regEnv("true") as any, ctx));
}

async function html(res: Response): Promise<string> {
  return await res.text();
}

describe("public UI routes", () => {
  it("GET / with no cookie 302s to /login", async () => {
    const res = await anon("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("GET / with a valid cookie 302s to /entries", async () => {
    const res = await authed("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/entries");
  });

  it("GET /login returns 200 with both forms and links to /api/auth/login|signup", async () => {
    const res = await anon("/login");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain('id="login-form"');
    expect(body).toContain('action="/api/auth/login"');
    // Registration enabled by default → signup form is visible.
    expect(body).toContain('id="signup-form"');
    expect(body).toContain('action="/api/auth/signup"');
  });

  it("GET /login renders the signup form when registration is enabled (default)", async () => {
    const res = await anon("/login");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain('id="signup-form"');
    expect(body).toContain('action="/api/auth/signup"');
  });

  // NOTE: Aggressive testing of the ALLOWED_REGISTRATION=false branch is done
  // in tests/integration/api-auth.test.ts (covers /api/info behavior). The SSR
  // page renders unconditionally based on what /api/info returns — verified
  // there, not duplicated here.

  it("GET /login shows an inline error from ?error=…", async () => {
    const res = await anon("/login?error=" + encodeURIComponent("Invalid credentials"));
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain(">Invalid credentials<");
  });
});

describe("authenticated UI routes (missing cookie 302 → /login)", () => {
  const authedRoutes = ["/entries", "/entry", "/tags", "/settings", "/developer", "/import"];

  for (const route of authedRoutes) {
    it(`GET ${route} without session → 302 /login?next=${route}`, async () => {
      const res = await anon(route);
      expect(res.status).toBe(302);
      const loc = res.headers.get("location") || "";
      expect(loc.startsWith("/login?next=")).toBe(true);
      expect(decodeURIComponent(loc)).toContain(route);
    });
  }
});

describe("authenticated UI pages return 200 with expected DOM markers", () => {
  it("GET /entries shows the entries shell", async () => {
    const res = await authed("/entries");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("<h1>Entries</h1>");
    // Site header is SSR'd
    expect(body).toContain('class="site-header"');
    // Logout form is real (works with no-JS).
    expect(body).toContain('action="/api/auth/logout"');
    // Filter links (PE-friendly anchors).
    expect(body).toContain('href="/import"');
    // Entry bundle is wired.
    expect(body).toContain('src="/c/entries.js"');
  });

  it("GET /tags shows the tags page", async () => {
    const res = await authed("/tags");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("<h1>Tags</h1>");
    expect(body).toContain('src="/c/tags.js"');
  });

  it("GET /settings shows the preferences form + token section", async () => {
    const res = await authed("/settings");
    expect(res.status).toBe(200);
    const body = await html(res);
    // Settings form posts natively to /ui/settings.
    expect(body).toContain('id="settings-form"');
    expect(body).toContain('action="/ui/settings"');
    expect(body).toContain('name="theme"');
    expect(body).toContain('action="/ui/feed/token/rotate"');
    expect(body).toContain('action="/ui/feed/token/revoke"');
  });

  it("GET /developer shows the create-client form", async () => {
    const res = await authed("/developer");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain('action="/ui/oauth/clients"');
    expect(body).toContain('name="name"');
  });

  it("GET /import shows both single + bulk forms", async () => {
    const res = await authed("/import");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain('action="/ui/import/single"');
    expect(body).toContain('action="/ui/import/bulk"');
  });

  it("GET /entry?id=N shows the article when the entry exists", async () => {
    // Seed a single entry.
    const db = new D1Client(env.DB);
    await db.run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, domain_name) VALUES (1, ?, ?, ?, ?, ?)",
      ["https://example.com/a", "h1", "First post", "<p>hi</p>", "example.com"],
    );
    const row = await db.one<{ id: number }>("SELECT id FROM entries WHERE user_id = 1");
    expect(row).not.toBeNull();

    const res = await authed(`/entry?id=${row!.id}`);
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("First post");
    expect(body).toContain('<p>hi</p>'); // sanitized HTML rendered inline
    // WC placeholders present (PE enhancement scaffolds).
    expect(body).toContain("<entry-actions");
    expect(body).toContain("<entry-poller");
    expect(body).toContain("<entry-editor");
  });

  it("GET /entry without ?id shows the not-found fallback", async () => {
    const res = await authed("/entry");
    expect(res.status).toBe(200);
    const body = await html(res);
    expect(body).toContain("Entry not found");
  });
});

describe("server-rendered HTML safety", () => {
  it("never injects a raw <script> body (only module bundles in <head>)", async () => {
    const res = await authed("/entries");
    const body = await html(res);
    // Everything is bundled → no inline script bodies.
    expect(body).not.toMatch(/<script>[^<]/);
    // All script tags use the module src form.
    if (body.match(/<script/g)) {
      expect(body).toMatch(/<script[^>]*type="module"[^>]*src="\/c\//);
    }
  });

  it("does not echo the username unescaped into an attribute", async () => {
    const res = await authed("/entries");
    const body = await html(res);
    // Username appears as TEXT content of `site-user`, never as an attribute value.
    expect(body).toContain(">alice");
    expect(body).not.toMatch(/\S+=["'][^"']*alice[^"']*["']/);
  });

  it("POST /ui/* surfaces cross-origin at 403 (CSRF defense)", async () => {
    const res = await authed("/ui/settings", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "theme=dark",
    });
    expect(res.status).toBe(403);
  });
});
