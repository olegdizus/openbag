import { Hono } from "hono";
import { D1Client } from "../../../index";

const db = (env: any) => new D1Client(env.DB);

export function importRoutes() {
  const app = new Hono();

  app.post("/import", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file as File | undefined;
    if (!file) {
      return c.json({ error: { code: 400, message: "No file provided" } }, 400);
    }
    const text = await file.text();
    await db(c.env).run(
      "INSERT INTO entries (user_id, url, url_hash, title, content, is_not_parsed) VALUES (?, ?, ?, ?, ?, 1)",
      [user.id, "import://upload", "", file.name, text.slice(0, 2000)]
    );
    return c.json({ success: true, message: "Import queued" });
  });

  return app;
}
