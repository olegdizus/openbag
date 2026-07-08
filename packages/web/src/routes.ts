import { Hono } from "hono";
import { loginRoutes } from "./features/auth";
import { developerRoutes } from "./features/developer";
import { settingsRoutes } from "./features/settings";
import { entryWebRoutes } from "./features/entries";
import { importRoutes as webImportRoutes } from "./features/import";
import { layout, escapeHtml } from "./templates/layout";
import { createUser } from "@openbag/auth";
import { sessionMiddleware, isRegistrationEnabled } from "@openbag/core";

function notFoundPage(): string {
  return layout({
    title: "Not Found",
    hideNav: true,
    narrow: true,
    body: `      <h1>404</h1>
      <p>This page does not exist.</p>
      <p><a href="/login">Login</a></p>`,
  });
}

function signupForm(opts: { username?: string; email?: string; error?: string } = {}): string {
  const alert = opts.error ? `      <div class="alert alert-error" role="alert">${escapeHtml(opts.error)}</div>\n` : "";
  return `${alert}      <h1>Create Account</h1>
      <form method="post" action="/signup">
        <fieldset>
          <label for="su-username">Username</label>
          <input id="su-username" type="text" name="username" value="${escapeHtml(opts.username || "")}" required minlength="3" maxlength="32" autocomplete="username"/>
        </fieldset>
        <fieldset>
          <label for="su-email">Email (optional)</label>
          <input id="su-email" type="email" name="email" value="${escapeHtml(opts.email || "")}" autocomplete="email"/>
        </fieldset>
        <fieldset>
          <label for="su-password">Password</label>
          <input id="su-password" type="password" name="password" required minlength="8" autocomplete="new-password"/>
        </fieldset>
        <button type="submit">Sign Up</button>
      </form>
      <p>Already have an account? <a href="/login">Login</a></p>`;
}

export function webRoutes() {
  const app = new Hono() as any;

  // Optional session — sets user if cookie present, but doesn't redirect.
  app.use("/", sessionMiddleware({ required: false }));

  app.route("/login", loginRoutes());

  app.get("/signup", (c: any) => {
    if (!isRegistrationEnabled(c.env)) return c.html(notFoundPage(), 404);
    return c.html(layout({ title: "Sign Up", hideNav: true, narrow: true, body: signupForm() }));
  });

  app.post("/signup", async (c: any) => {
    if (!isRegistrationEnabled(c.env)) return c.html(notFoundPage(), 404);
    const body = await c.req.parseBody();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || username.length < 3 || !password || password.length < 8) {
      return c.html(layout({ title: "Sign Up", hideNav: true, narrow: true, body: signupForm({ username, email, error: "Username (3+ chars) and password (8+ chars) required." }) }), 400);
    }

    try {
      await createUser(c.env, username, password, email || undefined);
      c.header("Set-Cookie", `session=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
      return c.redirect("/", 302);
    } catch (e) {
      if ((e as Error).message === "REGISTRATION_DISABLED") {
        return c.html(notFoundPage(), 404);
      }
      return c.html(layout({ title: "Sign Up", hideNav: true, narrow: true, body: `      <div class="alert alert-error" role="alert">${escapeHtml((e as Error).message)}</div>\n      <p><a href="/signup">Back to sign up</a></p>` }), 400);
    }
  });

  app.post("/logout", (c: any) => {
    c.header("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    return c.redirect("/login", 302);
  });

  app.use("/developer/*", sessionMiddleware());
  app.use("/settings/*", sessionMiddleware());
  app.use("/entries/*", sessionMiddleware());
  app.use("/import/*", sessionMiddleware());
  app.route("/developer", developerRoutes());
  app.route("/settings", settingsRoutes());
  app.route("/entries", entryWebRoutes());
  app.route("/import", webImportRoutes());
  app.get("/", (c: any) => {
    const user = c.get("user");
    if (user) {
      return c.html(layout({
        title: "OpenBag",
        user,
        body: `      <h1>Dashboard</h1>
      <div class="card">
        <h2>Quick Start</h2>
        <ul>
          <li><a href="/entries">Browse entries</a></li>
          <li><a href="/import">Import bookmarks</a></li>
          <li><a href="/settings">Configure your account & feeds</a></li>
          <li><a href="/developer">Manage OAuth clients</a></li>
        </ul>
      </div>`,
      }));
    }
    const signupLink = isRegistrationEnabled(c.env)
      ? ` or <a href="/signup">Sign up</a>`
      : "";
    return c.html(layout({
      title: "OpenBag",
      hideNav: true,
      narrow: true,
      body: `      <h1>Welcome to OpenBag</h1>
      <p><a href="/login">Login</a>${signupLink}</p>`,
    }));
  });
  return app;
}
