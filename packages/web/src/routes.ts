import { Hono } from "hono";
import { loginRoutes } from "./features/auth";
import { developerRoutes } from "./features/developer";
import { settingsRoutes } from "./features/settings";
import { entryWebRoutes } from "./features/entries";
import { shareRoutes as webShareRoutes } from "./features/share";
import { importRoutes as webImportRoutes } from "./features/import";
import { createUser } from "@wallabag/auth";
import { sessionMiddleware, D1Client } from "@wallabag/core";

export function webRoutes() {
  const app = new Hono() as any;

  // Optional session — sets user if cookie present, but doesn't redirect
  app.use("/", async (c: any, next: () => Promise<void>) => {
    const cookie = c.req.header("cookie") || "";
    const match = cookie.match(/session=([^;]+)/);
    if (match) {
      const username = decodeURIComponent(match[1]);
      const db = new D1Client(c.env.DB);
      const user = await db.one<{ id: number; username: string }>(
        "SELECT id, username FROM users WHERE username = ?",
        [username]
      );
      if (user) c.set("user", user);
    }
    await next();
  });

  app.route("/login", loginRoutes());

  app.get("/signup", (c) => c.html(`
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

  app.post("/signup", async (c) => {
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

  app.post("/logout", (c) => {
    c.header("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return c.redirect("/login", 302);
  });

  app.use("/developer/*", sessionMiddleware());
  app.use("/settings/*", sessionMiddleware());
  app.use("/entries/*", sessionMiddleware());
  app.use("/share/*", sessionMiddleware());
  app.use("/import/*", sessionMiddleware());
  app.route("/developer", developerRoutes());
  app.route("/settings", settingsRoutes());
  app.route("/entries", entryWebRoutes());
  app.route("/share", webShareRoutes());
  app.route("/import", webImportRoutes());
  app.get("/", (c) => {
    const user = c.get("user");
    if (user) {
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>Wallabag CF</title>
            <script src="https://unpkg.com/htmx.org@1.9.10"></script>
            <style>
              body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
              nav { display: flex; gap: 16px; margin-bottom: 24px; align-items: center; }
              nav a { color: #2563eb; text-decoration: none; }
              .card { border: 1px solid #e5e7eb; padding: 16px; margin: 12px 0; border-radius: 6px; }
            </style>
          </head>
          <body>
            <nav>
              <strong>Wallabag CF</strong>
              <span>Welcome, ${user.username}</span>
              <a href="/entries">Entries</a>
              <a href="/settings">Settings</a>
              <a href="/developer">Developer</a>
              <form method="post" action="/logout" style="display:inline">
                <button type="submit" style="background:none;border:none;color:#2563eb;cursor:pointer;text-decoration:underline;">Logout</button>
              </form>
            </nav>
            <h1>Dashboard</h1>
            <div class="card">
              <h2>Quick Start</h2>
              <ul>
                <li><a href="/entries">Browse entries</a></li>
                <li><a href="/settings">Configure your account</a></li>
                <li><a href="/developer">Manage OAuth clients</a></li>
                <li><a href="/import">Import bookmarks</a></li>
              </ul>
            </div>
          </body>
        </html>
      `);
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Wallabag CF</title>
          <script src="https://unpkg.com/htmx.org@1.9.10"></script>
          <style>body { font-family: system-ui; max-width: 400px; margin: 50px auto; padding: 20px; }</style>
        </head>
        <body>
          <h1>Welcome to Wallabag CF</h1>
          <p><a href="/login">Login</a> or <a href="/signup">Sign up</a></p>
        </body>
      </html>
    `);
  });
  return app;
}
