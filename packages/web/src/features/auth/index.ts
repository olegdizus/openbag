import { Hono } from "hono";
import { verifyPasswordAgainst } from "@wallabag/auth";

export function loginRoutes() {
  const app = new Hono();

  app.get("/", (c) => c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>Login</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <style>
          body { font-family: system-ui; max-width: 400px; margin: 50px auto; padding: 20px; }
          input { width: 100%; padding: 8px; margin: 4px 0 12px; box-sizing: border-box; }
          button { padding: 10px 20px; background: #2563eb; color: white; border: none; cursor: pointer; }
          .error { color: #dc2626; }
        </style>
      </head>
      <body>
        <h1>Login</h1>
        <form method="post" action="/login" hx-post="/login" hx-target="body" hx-swap="outerHTML">
          <div>
            <label>Username</label>
            <input type="text" name="username" required/>
          </div>
          <div>
            <label>Password</label>
            <input type="password" name="password" required/>
          </div>
          <button type="submit">Login</button>
        </form>
        <p>No account? <a href="/signup">Sign up</a></p>
      </body>
    </html>
  `));

  app.post("/", async (c) => {
    const body = await c.req.parseBody();
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return c.html(`<h1 class="error">Invalid credentials</h1><a href="/login">Back</a>`, 401);
    }

    const valid = await verifyPasswordAgainst(c.env, username, password);
    if (!valid) {
      return c.html(`<h1 class="error">Invalid credentials</h1><a href="/login">Back</a>`, 401);
    }

    c.header("Set-Cookie", `session=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return c.redirect("/", 302);
  });

  return app;
}
