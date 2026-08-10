import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

/** L5: theme/language allowlists — mirrors queries/config.ts so the JSON API
 *  and the /ui form path apply the same server-side constraint. */
const ALLOWED_THEMES = new Set(["baggy", "dark", "light"]);
const LANG_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;

/**
 * Coerce `v` to 1/0 if it looks truthy/falsy, else `undefined` (skip).
 * Mirrors Wallabag's loose intake of checkbox-on / off / missing.
 */
function asFlag(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(s)) return 1;
  if (["0", "false", "off", "no", ""].includes(s)) return 0;
  return undefined;
}

/** Coerce to a positive integer, or undefined to skip. */
function asPositiveInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export function configRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.get("/", async (c) => {
    const user = c.get("user");
    const config = await db(c.env).one("SELECT * FROM user_config WHERE user_id = ?", [user.id]);
    return c.json(config);
  });

  /**
   * PUT /api/config — persist any of the 7 user_config fields.
   *
   * Wallabag-compatible fields:
   *   theme, items_per_page, reading_speed, language,
   *   action_mark_as_read, list_mode, display_thumbnails
   *
   * Accepts either full PUT (all fields) or partial PATCH-style updates.
   * Missing/blank fields are preserved.
   */
  app.put("/", async (c) => {
    const user = c.get("user");
    const contentType = (c.req.header("content-type") || "").toLowerCase();
    let body: Record<string, any>;
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      body = await c.req.parseBody();
    } else {
      body = await c.req.json().catch(() => ({}));
    }

    const sets: string[] = [];
    const params: any[] = [];

    if (typeof body.theme === "string") {
      const theme = body.theme.trim().slice(0, 32);
      if (ALLOWED_THEMES.has(theme)) { sets.push("theme = ?"); params.push(theme); }
    }
    const ipp = asPositiveInt(body.items_per_page);
    if (ipp !== undefined) { sets.push("items_per_page = ?"); params.push(ipp); }
    const rs = asPositiveInt(body.reading_speed);
    if (rs !== undefined) { sets.push("reading_speed = ?"); params.push(rs); }
    if (typeof body.language === "string") {
      const language = body.language.trim().slice(0, 16);
      if (LANG_RE.test(language)) { sets.push("language = ?"); params.push(language); }
    }
    const amr = asFlag(body.action_mark_as_read);
    if (amr !== undefined) { sets.push("action_mark_as_read = ?"); params.push(amr); }
    const lm = asFlag(body.list_mode);
    if (lm !== undefined) { sets.push("list_mode = ?"); params.push(lm); }
    const dt = asFlag(body.display_thumbnails);
    if (dt !== undefined) { sets.push("display_thumbnails = ?"); params.push(dt); }

    if (sets.length > 0) {
      params.push(user.id);
      await db(c.env).run(`UPDATE user_config SET ${sets.join(", ")} WHERE user_id = ?`, params);
    }
    const updated = await db(c.env).one("SELECT * FROM user_config WHERE user_id = ?", [user.id]);
    return c.json(updated ?? { success: true });
  });

  return app;
}
