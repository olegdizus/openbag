import { Hono } from "hono";
import { D1Client } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

function escapeHtml(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) URLs may go into href/src; everything else is dropped. */
function safeHref(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
  } catch {
    /* not absolute — leave href off entirely */
  }
  return "";
}

export function shareRoutes() {
  const app = new Hono();

  app.get("/:uuid", async (c) => {
    const uuid = c.req.param("uuid");
    let entry: any;
    try {
      entry = await db(c.env).one("SELECT * FROM entries WHERE public_uuid = ? AND is_public = 1", [uuid]);
    } catch {
      return c.text("Not found", 404);
    }
    if (!entry) return c.text("Not found", 404);

    // Every interpolated value is escaped (C2). entry.content is sanitized
    // HTML by design (rendered raw so article formatting survives); title,
    // url, and the description excerpt are attacker-influenced and MUST be
    // escaped. url is also scheme-checked before going into href.
    const title = escapeHtml(entry.title || "");
    const url = escapeHtml(entry.url || "");
    const href = safeHref(entry.url || "");
    const description = escapeHtml((entry.content || "").replace(/<[^>]*>/g, "").slice(0, 200));
    const content = entry.content || "<p>No content</p>";
    const linkEl = href ? `<p><a href="${escapeHtml(href)}" rel="noopener nofollow">Original article</a></p>` : "";

    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <meta property="og:title" content="${title}"/>
    ${url ? `<meta property="og:url" content="${url}"/>` : ""}
    <meta name="description" content="${description}"/>
  </head>
  <body>
    <article>
      <h1>${title}</h1>
      ${content}
    </article>
    ${linkEl}
  </body>
</html>`;
    return c.html(html);
  });

  return app;
}
