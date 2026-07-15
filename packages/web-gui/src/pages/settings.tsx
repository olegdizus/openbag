// web-gui/src/pages/settings.tsx — GET /settings page.
//
// Server-side prefill via `@openbag/core` `getConfig` + `getFeedToken`
// (D1 direct — ADR-0018). The preferences form POSTs to `/ui/settings`; the
// token buttons are intercepted by the `<feed-token-actions>` WC when JS is
// on (calls /api/feed/token for instant updates), but server-side they fall
// back to `/ui/feed/token/*` POSTs.

import { SiteShell, type User } from "../layout";
import { getConfig, getFeedToken } from "@openbag/core";
import { esc } from "../render";
import type { FC } from "hono/jsx";

interface SettingsPageProps {
  user: User;
  env: any;
  /** Origin for building feed-token URLs. The web-gui Worker knows the
   *  request URL; we pass it explicitly to keep `@openbag/core` calls siteless. */
  baseUrl: string;
  /** ?success=1 query after a successful settings save. */
  success?: boolean;
}

export const SettingsPage: FC<SettingsPageProps> = async ({ user, env, baseUrl, success }) => {
  const cfg = await getConfig(env, user.id);
  const token = await getFeedToken(env, user.id, baseUrl);

  return (
    <SiteShell user={user} title="Settings" bundle="/c/settings.js">
      <h1>Settings</h1>
      <div id="result">
        {success ? <div class="alert alert-success">Saved.</div> : null}
      </div>

      <h2>Preferences</h2>
      <form id="settings-form" action="/ui/settings" method="post">
        <fieldset>
          <label for="settings-theme">Theme</label>
          <select id="settings-theme" name="theme">
            <option value="baggy" selected={cfg?.theme === "baggy" || !cfg?.theme}>Baggy</option>
            <option value="dark" selected={cfg?.theme === "dark"}>Dark</option>
            <option value="light" selected={cfg?.theme === "light"}>Light</option>
          </select>
        </fieldset>
        <fieldset>
          <label for="settings-items_per_page">Items per page</label>
          <input
            type="number"
            id="settings-items_per_page"
            name="items_per_page"
            min="5"
            max="200"
            value={esc(String(cfg?.items_per_page ?? 30))}
          />
        </fieldset>
        <fieldset>
          <label for="settings-reading_speed">Reading speed (words/min)</label>
          <input
            type="number"
            id="settings-reading_speed"
            name="reading_speed"
            min="50"
            max="1000"
            value={esc(String(cfg?.reading_speed ?? 200))}
          />
        </fieldset>
        <fieldset>
          <label for="settings-language">Language</label>
          <input
            type="text"
            id="settings-language"
            name="language"
            value={esc(cfg?.language ?? "en")}
          />
        </fieldset>
        <fieldset>
          <label>
            <input
              type="checkbox"
              id="settings-action_mark_as_read"
              name="action_mark_as_read"
              checked={!!cfg?.action_mark_as_read}
            />
            {" "}Mark as read when opened
          </label>
        </fieldset>
        <fieldset>
          <label>
            <input
              type="checkbox"
              id="settings-list_mode"
              name="list_mode"
              checked={!!cfg?.list_mode}
            />
            {" "}Compact list mode
          </label>
        </fieldset>
        <fieldset>
          <label>
            <input
              type="checkbox"
              id="settings-display_thumbnails"
              name="display_thumbnails"
              checked={cfg?.display_thumbnails !== 0 && cfg != null ? true : cfg == null ? true : false}
            />
            {" "}Show thumbnails
          </label>
        </fieldset>
        <button type="submit">Save preferences</button>
      </form>

      <h2>Feed token</h2>
      <p class="text-muted">
        Use a feed token to subscribe to your reading list in any RSS/Atom reader
        (no OAuth needed). The URLs are private while the token is valid.
      </p>
      <div id="feed-section">
        <form action="/ui/feed/token/rotate" method="post" style="display:inline">
          <button type="submit">Rotate token</button>
        </form>
        {" "}
        <form action="/ui/feed/token/revoke" method="post" style="display:inline">
          <button type="submit" class="btn-danger">Revoke token</button>
        </form>
        <feed-token-actions
          data-token={token.feed_token ?? ""}
          data-atom-url={token.atom_url ?? ""}
          data-rss-url={token.rss_url ?? ""}
          data-rotate-action="/ui/feed/token/rotate"
          data-revoke-action="/ui/feed/token/revoke"
        />
      </div>
    </SiteShell>
  );
};
