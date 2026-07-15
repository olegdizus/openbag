// web-gui/src/pages/developer.tsx — GET /developer OAuth client page.
//
// Fetches OAuth clients via `@openbag/core` `listClients` (D1 direct).
// The create form is a real `<form action="/ui/oauth/clients" method=post>` so
// no-JS works; the `<oauth-client-card>` WC progressively enhances each card
// with confirm dialogs + optimistic delete.

import { SiteShell, type User } from "../layout";
import { listClients } from "@openbag/core";
import { esc } from "../render";
import type { FC } from "hono/jsx";

interface DeveloperPageProps {
  user: User;
  env: any;
}

/** Format the redirect_uris / allowed_grant_types columns as a comma list. */
function fmtList(v: unknown): string {
  if (v == null) return "[]";
  let a: unknown;
  try {
    a = typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return String(v);
  }
  return Array.isArray(a) ? a.join(", ") : JSON.stringify(v);
}

export const DeveloperPage: FC<DeveloperPageProps> = async ({ user, env }) => {
  const clients = await listClients(env, user.id);
  return (
    <SiteShell user={user} title="Developer" bundle="/c/developer.js">
      <h1>Developer — OAuth clients</h1>
      <p class="text-muted">
        OAuth clients are how native Wallabag apps (and your own scripts) authenticate.
        The Wallabag token endpoint is <code>POST /oauth/v2/token</code> with grant type
        <code>password</code> or <code>refresh_token</code>.
      </p>
      <div id="result"></div>

      <h2>Create a new client</h2>
      <form action="/ui/oauth/clients" method="post">
        <fieldset>
          <label for="draft-name">New client name</label>
          <input type="text" id="draft-name" name="name" placeholder="e.g. Wallabag Android" required />
        </fieldset>
        <button type="submit">Create client</button>
      </form>

      <div id="clients">
        {clients.length === 0 ? (
          <p class="text-muted">No OAuth clients yet. Create one to use the Wallabag API.</p>
        ) : (
          clients.map((c: any) => {
            const clientId = `${c.id}_${c.random_id || ""}`;
            return (
              <oauth-client-card class="client-card" data-id={c.id}>
                <div class="client-card" data-id={c.id}>
                  <h3>{esc(c.name)}</h3>
                  <div class="cred-row">
                    <strong>Client ID:</strong>
                    <code>{esc(clientId)}</code>
                  </div>
                  <div class="cred-row">
                    <strong>Secret:</strong>
                    <code>{esc(c.secret)}</code>
                  </div>
                  <div class="cred-row">
                    <strong>Redirect URIs:</strong>
                    <code>{esc(fmtList(c.redirect_uris))}</code>
                  </div>
                  <div class="cred-row">
                    <strong>Grant types:</strong>
                    <code>{esc(fmtList(c.allowed_grant_types))}</code>
                  </div>
                  <div class="client-actions">
                    <form action={`/ui/oauth/clients/${c.id}/delete`} method="post">
                      <button type="submit" class="btn-danger" data-delete>Delete</button>
                    </form>
                  </div>
                </div>
              </oauth-client-card>
            );
          })
        )}
      </div>
    </SiteShell>
  );
};
