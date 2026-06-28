import { Hono } from "hono";
import { createUser } from "@wallabag/auth";

export function signupRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>Sign Up</title>
        <script src="https://unpkg.com/htmx.org@1.9.10"></script>
        <style>
          body { font-family: system-ui; max-width: 400px; margin: 50px auto; padding: 20px; }
          input { width: 100%; padding: 8px; margin: 4px 0 12px; box-sizing: border-box; }
          button { padding: 10px 20px; background: #2563eb; color: white; border: none; cursor: pointer; }
          .error { color: #dc2626; }
        </style>
      </head>
      <body>
        <h1>Create Account</h1>
        <form method="post" action="/signup" hx-post="/signup" hx-target="body" hx-swap="outerHTML">
          <div>
            <label>Username</label>
            <input type="text" name="username" required minlength="3" maxlength="32"/>
          </div>
          <div>
            <label>Email</label>
            <input type="email" name="email"/>
          </div>
          <div>
            <label>Password</label>
            <input type="password" name="password" required minlength="8"/>
          </div>
          <button type="submit">Sign Up</button>
        </form>
        <p>Already have an account? <a href="/login">Login</a></p>
      </body>
    </html>
  `));
  app.post("/", async (c) => {
    const body = await c.req.parseBody();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || username.length < 3 || !password || password.length < 8) {
      return c.html(`<h1 class="error">Invalid input</h1><p>Username (3+ chars) and password (8+ chars) required.</p><a href="/signup">Back</a>`, 400);
    }
    try {
      await createUser(c.env, username, password, email || undefined);
      c.header("Set-Cookie", `session=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      return c.redirect("/", 302);
    } catch (e) {
      return c.html(`<h1 class="error">Sign up failed</h1><p>${(e as Error).message}</p><a href="/signup">Back</a>`, 400);
    }
  });
  return app;
}

export function logoutRoutes() {
  const app = new Hono();
  app.post("/", (c) => {
    c.header("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return c.redirect("/login", 302);
  });
  return app;
}
