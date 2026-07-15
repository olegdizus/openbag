// web-gui/src/pages/login.tsx — /login + /signup page.
//
// Renders both `#login-form` and `#signup-form` as REAL form POSTs to
// `/api/auth/login|signup` — these hit the API Worker via the Cloudflare route
// table (ADR-0018). JS enhancement (`/c/login.js`) intercepts and pre-applies
// the session cookie by reading the JSON response, then handles redirects
// client-side so error toasts work without a page reload.
//
// Signup section visibility is gated by `@openbag/core`'s
// `isRegistrationEnabled(env)` — the no-JS HTML is statically correct.

import { Html } from "../layout";
import { isRegistrationEnabled } from "@openbag/core";
import { esc } from "../render";
import type { FC } from "hono/jsx";

interface LoginPageProps {
  env: any;
  /** ?next=/entries — once the login/signup form posts to the API and the
   *  browser is bounced to /, the home route detects the session and 302s
   *  to /entries. For UX reasons, the form also sends a hidden `next` field
   *  — read by /c/login.js when JS is on. */
  next?: string;
  /** ?error=... query string (rendered as an inline alert). */
  error?: string;
}

export const LoginPage: FC<LoginPageProps> = async ({ env, next = "/entries", error }) => {
  const registrationEnabled = isRegistrationEnabled(env);
  return (
    <Html title="OpenBag — Login" bundle="/c/login.js" bodyClass="narrow">
      <h1>OpenBag</h1>
      <p class="text-muted">A self-hosted read-it-later service.</p>

      {error ? (
        <div id="result" class="alert alert-error">{esc(error)}</div>
      ) : (
        <div id="result"></div>
      )}

      <h2>Log in</h2>
      <form id="login-form" action="/api/auth/login" method="post">
        <input type="hidden" name="next" value={esc(next)} />
        <fieldset>
          <label for="login-username">Username</label>
          <input type="text" id="login-username" name="username" autocomplete="username" required />
        </fieldset>
        <fieldset>
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" autocomplete="current-password" required />
        </fieldset>
        <button type="submit">Log in</button>
      </form>

      {registrationEnabled ? (
        <div id="signup-container">
          <h2>Create account</h2>
          <form id="signup-form" action="/api/auth/signup" method="post">
            <input type="hidden" name="next" value={esc(next)} />
            <fieldset>
              <label for="signup-username">Username</label>
              <input type="text" id="signup-username" name="username" autocomplete="username" required />
            </fieldset>
            <fieldset>
              <label for="signup-email">Email (optional)</label>
              <input type="email" id="signup-email" name="email" autocomplete="email" />
            </fieldset>
            <fieldset>
              <label for="signup-password">Password (at least 8 characters)</label>
              <input type="password" id="signup-password" name="password" autocomplete="new-password" required />
            </fieldset>
            <button type="submit">Sign up</button>
          </form>
        </div>
      ) : (
        <p class="text-muted">New account registration is disabled.</p>
      )}
    </Html>
  );
};
