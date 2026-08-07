import { Hono } from "hono";
import { D1Client, getUserInfo } from "@openbag/core";

const db = (env: any) => new D1Client(env.DB);

export function userRoutes() {
  const app = new Hono<{ Variables: { user: { id: number; username: string } }; Bindings: { DB: D1Database } }>();

  app.get("/user", async (c) => {
    const user = c.get("user");
    const info = await getUserInfo(c.env, user.id);
    return c.json(info);
  });

  app.put("/user", async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    const sets: string[] = [];
    const params: any[] = [];
    if (body.email) { sets.push("email = ?"); params.push(body.email); }
    if (body.name) { sets.push("username = ?"); params.push(body.name); }
    if (sets.length === 0) return c.json({ success: true });
    params.push(user.id);
    await db(c.env).run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    return c.json({ success: true });
  });

  return app;
}
