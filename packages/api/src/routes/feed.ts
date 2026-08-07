import { Hono } from "hono";
import { D1Client, randomHex } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

/** Cap results to keep feed responses cheap on Workers. */
const FEED_LIMIT = 50;

/** Authenticate via the `?token=<feed_token>` query param (not Bearer). */
async function authenticateByToken(env: any, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const row = await db(env).one<{ id: number }>(
    "SELECT id FROM users WHERE feed_token = ?",
    [token],
  ).catch(() => null);
  return row?.id ?? null;
}

/**
 * XML attribute escape — covers the chars an attacker could otherwise sneak in
 * via entry titles/URLs (HTML entity wrapping is what real feed readers expect).
 */
function escAttr(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Escapes text-only content (no attribute quotes needed). */
function escText(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts a D1 stored datetime ("YYYY-MM-DD HH:MM:SS" or already-ISO) into an
 * RFC 3339 timestamp suitable for both Atom <updated> and RSS pubDate.
 */
function toRfc3339(stored: string | null | undefined): string {
  if (!stored) return new Date(0).toISOString();
  // D1 stores as "2026-07-05 12:34:56"; swap the space for 'T' and add UTC Z.
  const iso = stored.includes("T")
    ? stored.replace(/\+0000$/, "+00:00")
    : stored.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** RSS 2.0 pubDate — RFC 822. */
function toRfc822(stored: string | null | undefined): string {
  const iso = toRfc3339(stored);
  return new Date(iso).toUTCString();
}

/**
 * Builds an Atom 1.0 feed document for a list of entries.
 * Source: https://validator.w3.org/feed/docs/atom.html
 */
function buildAtom(opts: {
  baseUrl: string;
  title: string;
  username: string;
  selfUrl: string;
  entries: any[];
}): string {
  const { baseUrl, title, username, selfUrl, entries } = opts;
  const updated = entries.length
    ? toRfc3339(entries[0].updated_at || entries[0].created_at)
    : toRfc3339(null);

  const items = entries
    .map((e) => {
      const link = e.url ? `<link href="${escAttr(e.url)}"/>\n      ` : "";
      const alt = e.url
        ? `\n      <link rel="alternate" type="text/html" href="${escAttr(e.url)}"/>`
        : "";
      const published = e.published_at
        ? `\n      <published>${toRfc3339(e.published_at)}</published>`
        : "";
      const summary = e.content
        ? `\n      <summary type="html"><![CDATA[${stripForSummary(e.content)}]]></summary>`
        : "";
      return `    <entry>
      <title>${escText(e.title || e.url || "Untitled")}</title>
      ${link}<id>${escAttr(`${baseUrl}/api/entries/${e.id}`)}</id>
      <updated>${toRfc3339(e.updated_at || e.created_at)}</updated>${alt}${published}${summary}
    </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escAttr(`${baseUrl}/api/feeds/${username}.atom`)}</id>
  <title>${escText(title)}</title>
  <updated>${updated}</updated>
  <link rel="self" type="application/atom+xml" href="${escAttr(selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${escAttr(`${baseUrl}/api/entries`)}"/>
  <author><name>${escText(username)}</name></author>
  <generator uri="https://github.com/openbag/openbag">OpenBag</generator>
${items}
</feed>`;
}

/**
 * Builds an RSS 2.0 feed document for a list of entries.
 * Spec: https://www.rssboard.org/rss-specification
 */
function buildRss(opts: {
  baseUrl: string;
  title: string;
  description: string;
  selfUrl: string;
  entries: any[];
}): string {
  const { baseUrl, title, description, selfUrl, entries } = opts;
  const items = entries
    .map((e) => {
      const guid = `${baseUrl}/api/entries/${e.id}`;
      const desc = e.content ? stripForSummary(e.content).slice(0, 500) : "";
      const pubDate = e.published_at
        ? `\n      <pubDate>${toRfc822(e.published_at)}</pubDate>`
        : `\n      <pubDate>${toRfc822(e.created_at)}</pubDate>`;
      return `    <item>
      <title>${escText(e.title || e.url || "Untitled")}</title>
      <link>${escText(e.url || guid)}</link>
      <guid isPermaLink="false">${escAttr(guid)}</guid>${pubDate}
      <description>${escText(desc)}</description>
    </item>`;
    })
    .join("\n");

  const lastBuild = entries.length
    ? toRfc822(entries[0].updated_at || entries[0].created_at)
    : toRfc822(null);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escText(title)}</title>
    <link>${escAttr(`${baseUrl}/api/entries`)}</link>
    <description>${escText(description)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <atom:link href="${escAttr(selfUrl)}" rel="self" type="application/rss+xml"/>
    <generator>OpenBag</generator>
${items}
  </channel>
</rss>`;
}

/** Strips tags + collapses whitespace so the feed reader preview stays short. */
function stripForSummary(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/**
 * Authenticated feed endpoints (mounted under /api/feed).
 * Used by the API owner to mint/revoke a long-lived feed token and to
 * preview their own feed in API explorers.
 */
export function feedRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  // URLs are `null` when no feed token has been issued yet.
  app.get("/token", async (c) => {
    const user: any = c.get("user");
    const row = await db(c.env).one<{ feed_token: string | null; username: string }>(
      "SELECT u.feed_token, u.username FROM users u WHERE u.id = ?",
      [user.id],
    );
    const token = row?.feed_token ?? null;
    const base = new URL(c.req.url).origin;
    const username = row?.username ?? "";
    const suffix = token ? `?token=${token}` : "";
    return c.json({
      feed_token: token,
      atom_url: token
        ? `${base}/api/feeds/${encodeURIComponent(username)}.atom${suffix}`
        : null,
      rss_url: token
        ? `${base}/api/feeds/${encodeURIComponent(username)}.xml${suffix}`
        : null,
    });
  });

  app.post("/token", async (c) => {
    const user: any = c.get("user");
    const token = randomHex(32); // 256-bit opaque secret
    await db(c.env).run(
      "UPDATE users SET feed_token = ?, updated_at = datetime('now') WHERE id = ?",
      [token, user.id],
    );
    const username = await db(c.env).one<{ username: string }>(
      "SELECT username FROM users WHERE id = ?",
      [user.id],
    );
    const base = new URL(c.req.url).origin;
    return c.json({
      feed_token: token,
      atom_url: `${base}/api/feeds/${encodeURIComponent(username!.username)}.atom?token=${token}`,
      rss_url: `${base}/api/feeds/${encodeURIComponent(username!.username)}.xml?token=${token}`,
    });
  });

  app.delete("/token", async (c) => {
    const user: any = c.get("user");
    await db(c.env).run(
      "UPDATE users SET feed_token = NULL, updated_at = datetime('now') WHERE id = ?",
      [user.id],
    );
    return c.json({ success: true });
  });

  app.get("/", async (c) => {
    const user: any = c.get("user");
    const entries = await fetchEntries(c.env, user.id);
    const selfUrl = c.req.url;
    const xml = buildAtom({
      baseUrl: new URL(c.req.url).origin,
      title: `${user.username}'s reading list`,
      username: user.username,
      selfUrl,
      entries,
    });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return app;
}

/**
 * Public feed URL endpoints (mounted under /api/feeds).
 * RSS readers fetch these with just `?token=<feed_token>` — no OAuth involved.
 */
export function feedPublicRoutes() {
  const app = new Hono();


  app.get("/:username\\.atom", async (c) => {
    const username = c.req.param("username")!;
    const token = c.req.query("token");
    const userId = await authenticateByToken(c.env, token);
    if (!userId) {
      return c.text("Unauthorized", 401);
    }
    // Confirm the username in the path matches the token's owner, so users
    // can't enumerate other accounts (token alone is enough, but this also
    // prevents confusion when readers fix-up URLs).
    const owner = await db(c.env).one<{ id: number; username: string }>(
      "SELECT id, username FROM users WHERE username = ?",
      [username],
    );
    if (!owner || owner.id !== userId) {
      return c.text("Not found", 404);
    }

    const entries = await fetchEntries(c.env, userId);
    const xml = buildAtom({
      baseUrl: new URL(c.req.url).origin,
      title: `${username}'s reading list`,
      username,
      selfUrl: c.req.url,
      entries,
    });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  });


  app.get("/:username\\.xml", async (c) => {
    const username = c.req.param("username")!;
    const token = c.req.query("token");
    const userId = await authenticateByToken(c.env, token);
    if (!userId) {
      return c.text("Unauthorized", 401);
    }
    const owner = await db(c.env).one<{ id: number; username: string }>(
      "SELECT id, username FROM users WHERE username = ?",
      [username],
    );
    if (!owner || owner.id !== userId) {
      return c.text("Not found", 404);
    }

    const entries = await fetchEntries(c.env, userId);
    const xml = buildRss({
      baseUrl: new URL(c.req.url).origin,
      title: `${username}'s reading list`,
      description: `Recent entries saved by ${username}`,
      selfUrl: c.req.url,
      entries,
    });
    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  return app;
}

async function fetchEntries(env: any, userId: number): Promise<any[]> {
  return db(env).all(
    `SELECT id, url, title, content, domain_name, authors, language,
            reading_time, preview_picture, published_at, created_at, updated_at
     FROM entries
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, FEED_LIMIT],
  );
}

// Re-exported for direct unit testing — the builders are otherwise private to keep the API surface tight.
export const __testBuildAtom = buildAtom;
export const __testBuildRss = buildRss;
