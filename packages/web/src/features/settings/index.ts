import { Hono } from "hono";
import { D1Client } from "@openbag/core";
import { layout } from "../../templates/layout";
import {
  getFeedTokenState,
  renderFeedsSection,
  feedsFlash,
  feedsTokenHandlers,
} from "../feeds";

const db = (env: any) => new D1Client(env.DB);

type SessionUser = { id: number; username: string };

export function settingsRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const user = c.get("user") as SessionUser;
    const config = await db(c.env).one("SELECT * FROM user_config WHERE user_id = ?", [user.id]).catch(() => null);
    const query = c.req.query();

    // Two flashes on the same page: settings save + feed-token actions.
    // They're independent so each can trigger without masking the other.
    const savedAlert = query.saved
      ? `      <div class="alert alert-success" role="status">Settings saved.</div>\n`
      : "";

    const origin = new URL(c.req.url).origin;
    const feedState = await getFeedTokenState(c.env, user.id);
    const feedsSection = renderFeedsSection({ origin, state: feedState });
    const feedsBanner = feedsFlash(query);
    // Inject the flash right after the section's <h2>, if present.
    const feedsBlock = feedsBanner
      ? feedsSection.replace(
          '        <h2>RSS / Atom Feeds</h2>',
          `        <h2>RSS / Atom Feeds</h2>\n${feedsBanner}`,
        )
      : feedsSection;

    return c.html(layout({
      title: "Settings",
      user,
      body: `${savedAlert}      <h1>Settings</h1>
      <form method="post" action="/settings">
        <fieldset>
          <label for="cfg-theme">Theme</label>
          <select id="cfg-theme" name="theme">
            <option value="baggy"${config?.theme === "baggy" ? " selected" : ""}>Baggy</option>
            <option value="light"${config?.theme === "light" ? " selected" : ""}>Light</option>
            <option value="dark"${config?.theme === "dark" ? " selected" : ""}>Dark</option>
          </select>
        </fieldset>
        <fieldset>
          <label for="cfg-per-page">Items per page</label>
          <input id="cfg-per-page" type="number" name="items_per_page" value="${config?.items_per_page ?? 30}" min="1" max="100"/>
        </fieldset>
        <fieldset>
          <label for="cfg-lang">Language</label>
          <input id="cfg-lang" type="text" name="language" value="${config?.language ?? "en"}"/>
        </fieldset>
        <fieldset>
          <label for="cfg-speed">Reading speed (words/min)</label>
          <input id="cfg-speed" type="number" name="reading_speed" value="${config?.reading_speed ?? 200}" min="1"/>
        </fieldset>
        <fieldset>
          <label>
            <input type="checkbox" name="action_mark_as_read" value="1"${config?.action_mark_as_read ? " checked" : ""}/>
            Mark as read when opening
          </label>
        </fieldset>
        <fieldset>
          <label>
            <input type="checkbox" name="list_mode" value="1"${config?.list_mode ? " checked" : ""}/>
            List view mode
          </label>
        </fieldset>
        <fieldset>
          <label>
            <input type="checkbox" name="display_thumbnails" value="1"${config?.display_thumbnails ? " checked" : ""}/>
            Show thumbnails
          </label>
        </fieldset>
        <button type="submit">Save</button>
      </form>

${feedsBlock}`,
    }));
  });

  app.post("/", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = await c.req.parseBody();
    const theme = typeof body.theme === "string" ? body.theme : "baggy";
    const itemsPerPage = parseInt(typeof body.items_per_page === "string" ? body.items_per_page : "30");
    const language = typeof body.language === "string" ? body.language : "en";
    const readingSpeed = parseInt(typeof body.reading_speed === "string" ? body.reading_speed : "200");
    const actionMarkAsRead = body.action_mark_as_read === "1" ? 1 : 0;
    const listMode = body.list_mode === "1" ? 1 : 0;
    const displayThumbnails = body.display_thumbnails === "1" ? 1 : 0;

    await db(c.env).run(
      `UPDATE user_config SET theme = ?, items_per_page = ?, language = ?, reading_speed = ?, action_mark_as_read = ?, list_mode = ?, display_thumbnails = ? WHERE user_id = ?`,
      [theme, itemsPerPage, language, readingSpeed, actionMarkAsRead, listMode, displayThumbnails, user.id]
    );

    return c.redirect("/settings?saved=1", 302);
  });

  // Feed-token actions live under /settings/feeds/* so all feed management
  // surfaces from the Settings page itself.
  app.route("/feeds", feedsTokenHandlers());

  return app;
}
