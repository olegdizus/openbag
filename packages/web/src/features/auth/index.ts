import { Hono } from "hono";
import { verifyPasswordAgainst } from "@openbag/auth";
import { isRegistrationEnabled } from "@openbag/core";
import { layout } from "../../templates/layout";

export function loginRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    const error = c.req.query("error");
    const signupLink = isRegistrationEnabled(c.env)
      ? `\n      <p>No account? <a href="/signup">Sign up</a></p>`
      : "";
    const alert = error
      ? `      <div class="alert alert-error" role="alert">${error}</div>\n`
      : "";
    return c.html(layout({
      title: "Login",
      hideNav: true,
      narrow: true,
      body: `${alert}      <h1>Login</h1>
      <form method="post" action="/login">
        <fieldset>
          <label for="li-username">Username</label>
          <input id="li-username" type="text" name="username" required autocomplete="username"/>
        </fieldset>
        <fieldset>
          <label for="li-password">Password</label>
          <input id="li-password" type="password" name="password" required autocomplete="current-password"/>
        </fieldset>
        <button type="submit">Login</button>
      </form>${signupLink}`,
    }));
  });

  app.post("/", async (c) => {
    const body = await c.req.parseBody();
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      return c.redirect("/login?error=" + encodeURIComponent("Invalid credentials"), 302);
    }

    const valid = await verifyPasswordAgainst(c.env, username, password);
    if (!valid) {
      return c.redirect("/login?error=" + encodeURIComponent("Invalid credentials"), 302);
    }

    c.header("Set-Cookie", `session=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`);
    return c.redirect("/", 302);
  });

  return app;
}
