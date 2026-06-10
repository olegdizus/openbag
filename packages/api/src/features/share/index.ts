import { Hono } from "hono";
import { D1Client } from "@wallabag/core";

const db = (env: any) => new D1Client(env.DB);

export function shareRoutes() {
  const app = new Hono();

  app.get("/:uuid", async (c) => {
    const uuid = c.req.param("uuid");
    try {
      const entry = await db(c.env).one("SELECT * FROM entries WHERE public_uuid = ? AND is_public = 1", [uuid]);
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${entry.title}</title>
            <meta property="og:title" content="${entry.title}"/>
            <meta property="og:url" content="${entry.url}"/>
            <meta name="description" content="${(entry.content || "").replace(/<[^>]*>/g, "").slice(0, 200)}"/>
          </head>
          <body>
            <article>
              <h1>${entry.title}</h1>
              ${entry.content || "<p>No content</p>"}
            </article>
            <p><a href="${entry.url}">Original article</a></p>
          </body>
        </html>
      `;
      return c.html(html);
    } catch {
      return c.text("Not found", 404);
    }
  });

  return app;
}
