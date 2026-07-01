import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { webRoutes } from "@openbag/web";
import { app as apiApp } from "@openbag/api";
import { D1Client } from "@openbag/core";

// Real D1 binding from the test pool + an overridden registration flag.
const regEnv = (allow: string) => ({ ...env, ALLOWED_REGISTRATION: allow });
const ctx = { waitUntil() {} } as unknown as ExecutionContext;

let db: D1Client;
beforeAll(async () => {
  db = new D1Client(env.DB);
  // Seed the minimum schema the signup flow touches. (The vitest pool doesn't
  // auto-apply wrangler D1 migrations, and readD1Migrations is Node-only.)
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT DEFAULT 'baggy',
      items_per_page INTEGER DEFAULT 30,
      reading_speed INTEGER DEFAULT 200,
      language TEXT DEFAULT 'en',
      action_mark_as_read INTEGER DEFAULT 0,
      list_mode INTEGER DEFAULT 0,
      display_thumbnails INTEGER DEFAULT 1,
      UNIQUE(user_id)
    )
  `).run();
});

describe("GUI signup gating", () => {
  it("GET /signup returns 404 when registration disabled", async () => {
    const res = await webRoutes().fetch(
      new Request("https://x/signup"),
      regEnv("false") as any,
      ctx,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("404");
  });

  it("POST /signup returns 404 when registration disabled (direct post)", async () => {
    const form = new URLSearchParams({ username: "ghost", password: "12345678" });
    const res = await webRoutes().fetch(
      new Request("https://x/signup", {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      regEnv("false") as any,
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("GET /signup returns 200 with a form when registration enabled", async () => {
    const res = await webRoutes().fetch(
      new Request("https://x/signup"),
      regEnv("true") as any,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Create Account");
  });

  it("POST /signup creates a user and redirects when enabled", async () => {
    const username = `itest_${Date.now()}`;
    const form = new URLSearchParams({ username, password: "12345678" });
    const res = await webRoutes().fetch(
      new Request("https://x/signup", {
        method: "POST",
        body: form.toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      regEnv("true") as any,
      ctx,
    );
    expect(res.status).toBe(302);
    const user = await db.one<{ username: string }>(
      "SELECT username FROM users WHERE username = ?",
      [username],
    );
    expect(user?.username).toBe(username);
  });

  it("landing page hides Sign up link when disabled", async () => {
    const res = await webRoutes().fetch(
      new Request("https://x/"),
      regEnv("false") as any,
      ctx,
    );
    const body = await res.text();
    expect(body).not.toContain('href="/signup"');
  });
});

describe("API info reflects the flag", () => {
  it("/api/info reports allowed_registration:false when disabled", async () => {
    const res = await apiApp.fetch(
      new Request("https://x/api/info"),
      regEnv("false") as any,
      ctx,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { allowed_registration: boolean };
    expect(json.allowed_registration).toBe(false);
  });

  it("/api/info reports allowed_registration:true when enabled", async () => {
    const res = await apiApp.fetch(
      new Request("https://x/api/info"),
      regEnv("true") as any,
      ctx,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { allowed_registration: boolean };
    expect(json.allowed_registration).toBe(true);
  });
});
