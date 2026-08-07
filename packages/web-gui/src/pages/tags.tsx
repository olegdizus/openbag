import { SiteShell, type User } from "../layout";
import { listTags } from "@openbag/core";
import { esc } from "../render";
import type { FC } from "hono/jsx";

interface TagsPageProps {
  user: User;
  env: any;
}

/**
 * Fetches tags via `@openbag/core`'s `listTags` (D1 direct — ADR-0018).
 * Renders the tag list with per-row delete forms (POST /ui/tags/delete). The
 * `<tag-row>` WC dynamically confirms the delete and optimistically removes
 * the row when JS is on; without JS the form submit still works and the
 * trailing 303 lands the user back on /tags.
 */
export const TagsPage: FC<TagsPageProps> = async ({ user, env }) => {
  const tags = await listTags(env, user.id);
  return (
    <SiteShell user={user} title="Tags" bundle="/c/tags.js">
      <h1>Tags</h1>
      <div id="tags">
        {tags.length === 0 ? (
          <p class="text-muted">No tags yet.</p>
        ) : (
          <ul class="tags-list">
            {tags.map((t) => (
              <li>
                <tag-row data-id={t.id} data-label={esc(t.label)}>
                  <span class="tag">{esc(t.label)}</span>
                  {" "}
                  <span class="text-muted">({t.nbEntries})</span>
                  {" "}
                  <form
                    action="/ui/tags/delete"
                    method="post"
                    class="inline"
                    style="display:inline"
                  >
                    <input type="hidden" name="label" value={esc(t.label)} />
                    <button type="submit" class="btn-sm btn-danger" data-delete>Delete</button>
                  </form>
                </tag-row>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SiteShell>
  );
};
