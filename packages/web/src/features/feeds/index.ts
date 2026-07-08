import { Hono } from "hono";
import { D1Client, randomHex } from "@openbag/core";
import { escapeHtml } from "../../templates/layout";

const db = (env: any) => new D1Client(env.DB);

type SessionUser = { id: number; username: string };
type FeedTokenRow = { feed_token: string | null; username: string };

/** Reads the user's feed token + username, for rendering the Settings section. */
export async function getFeedTokenState(env: any, userId: number): Promise<FeedTokenRow | null> {
  return db(env).one<FeedTokenRow>(
    "SELECT feed_token, username FROM users WHERE id = ?",
    [userId],
  );
}

/**
 * POST handlers for create/rotate + revoke. Mounted under the Settings page
 * (e.g. /settings/feeds/token and /settings/feeds/token/revoke) so all feed
 * management surfaces from the Settings view itself.
 */
export function feedsTokenHandlers() {
  const app = new Hono();

  // Generate (first time) or rotate (replace) the feed token. Same handler —
  // "create" vs "rotate" is just a UI distinction; both upsert a fresh secret.
  app.post("/token", async (c) => {
    const user = c.get("user") as SessionUser;
    const existing = await db(c.env).one<{ feed_token: string | null }>(
      "SELECT feed_token FROM users WHERE id = ?",
      [user.id],
    );
    const token = randomHex(32); // 256-bit opaque secret
    await db(c.env).run(
      "UPDATE users SET feed_token = ?, updated_at = datetime('now') WHERE id = ?",
      [token, user.id],
    );
    return c.redirect(`/settings?${existing?.feed_token ? "feeds_rotated=1" : "feeds_created=1"}#feeds`, 302);
  });

  app.post("/token/revoke", async (c) => {
    const user = c.get("user") as SessionUser;
    await db(c.env).run(
      "UPDATE users SET feed_token = NULL, updated_at = datetime('now') WHERE id = ?",
      [user.id],
    );
    return c.redirect("/settings?feeds_revoked=1#feeds", 302);
  });

  return app;
}

/**
 * Inline flash banner for feed-token actions, rendered at the section header.
 * Returns "" when no feeds_* flash is present.
 */
export function feedsFlash(query: Record<string, string | undefined>): string {
  if (query.feeds_created) {
    return `        <div class="alert alert-success" role="status">
          <strong>Feed token created.</strong> Copy a URL below into your feed reader. Treat the token like a password — anyone with it can read your reading list.
        </div>`;
  }
  if (query.feeds_rotated) {
    return `        <div class="alert alert-success" role="status">
          <strong>Feed token rotated.</strong> The previous token no longer works. Update any readers using the old URLs.
        </div>`;
  }
  if (query.feeds_revoked) {
    return `        <div class="alert alert-success" role="status">
          <strong>Feed token revoked.</strong> All feed URLs for your account are now disabled.
        </div>`;
  }
  return "";
}

/**
 * The "RSS / Atom Feeds" section, embedded in the Settings page. Renders either
 * a "Generate token" CTA or, if a token exists, copy-paste URLs + rotate/revoke
 * actions. All forms POST to the handlers in `feedsTokenHandlers()`.
 */
export function renderFeedsSection(opts: {
  origin: string;
  state: FeedTokenRow | null;
}): string {
  const { origin, state } = opts;
  if (!state || !state.feed_token) {
    return renderWithoutToken();
  }
  return renderWithToken({
    origin,
    username: state.username,
    token: state.feed_token,
  });
}

function renderWithoutToken(): string {
  return `      <section id="feeds" class="settings-section">
        <h2>RSS / Atom Feeds</h2>
        <p class="text-muted">Subscribe to your reading list from any feed reader (Reeder, Feedly, Miniflux, NetNewsWire, etc.). A long-lived secret token is appended to the URL because feed readers can't send OAuth tokens.</p>
        <form method="post" action="/settings/feeds/token">
          <button type="submit">Generate feed token</button>
        </form>
        <div class="card">
          <h3>How it works</h3>
          <ul>
            <li><strong>Atom:</strong> <code>/api/feeds/&lt;username&gt;.atom?token=&lt;feed_token&gt;</code></li>
            <li><strong>RSS:</strong> <code>/api/feeds/&lt;username&gt;.xml?token=&lt;feed_token&gt;</code></li>
          </ul>
          <p class="text-muted">The token exposes your 50 most recent entries. You can rotate or revoke it any time.</p>
        </div>
      </section>`;
}

function renderWithToken(opts: { origin: string; username: string; token: string }): string {
  const { origin, username, token } = opts;
  const atomUrl = `${origin}/api/feeds/${encodeURIComponent(username)}.atom?token=${token}`;
  const rssUrl = `${origin}/api/feeds/${encodeURIComponent(username)}.xml?token=${token}`;

  return `      <section id="feeds" class="settings-section">
        <h2>RSS / Atom Feeds</h2>
        <p class="text-muted">Paste either URL into your feed reader. The reader will poll on its own schedule.</p>
        <article class="client-card">
          <h3>Your feed URLs</h3>
          <div class="cred-row">
            <strong>Atom</strong>
            <code>${escapeHtml(atomUrl)}</code>
            <button type="button" class="btn-sm" data-copy="${escapeHtml(atomUrl)}">Copy</button>
          </div>
          <div class="cred-row">
            <strong>RSS 2.0</strong>
            <code>${escapeHtml(rssUrl)}</code>
            <button type="button" class="btn-sm" data-copy="${escapeHtml(rssUrl)}">Copy</button>
          </div>
          <div class="cred-row">
            <strong>Token</strong>
            <code>${escapeHtml(token)}</code>
            <button type="button" class="btn-sm" data-copy="${escapeHtml(token)}">Copy</button>
          </div>
          <div class="client-actions">
            <form method="post" action="/settings/feeds/token" onsubmit="return confirm('Rotate the feed token? Existing readers will stop updating until reconfigured.')">
              <button type="submit">Rotate token</button>
            </form>
            <form method="post" action="/settings/feeds/token/revoke" onsubmit="return confirm('Revoke the feed token? All readers will immediately lose access.')">
              <button type="submit" class="btn-danger">Revoke</button>
            </form>
          </div>
        </article>
      </section>`;
}
