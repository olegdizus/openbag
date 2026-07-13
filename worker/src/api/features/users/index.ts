import { Hono } from "hono";
import { getUserInfo } from "../../../auth";
import { D1Client } from "../../../index";

const db = (env: any) => new D1Client(env.DB);

export function userRoutes() {
  const app = new Hono();

  // GET /api/user — get current user info
  app.get("/user", async (c) => {
    const user = c.get("user");
    const info = await getUserInfo(c.env, user.id);
    return c.json(info);
  });

  // PUT /api/user — update current user
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
