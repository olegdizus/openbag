import { SiteShell, type User } from "../layout";
import { getEntry } from "@openbag/core";
import { esc, fmtDateTime } from "../render";
import type { FC } from "hono/jsx";

interface EntryPageProps {
  user: User;
  env: any;
  /** ?id= query string value parsed to int. */
  id: number;
}

/**
 * Renders <article> with title, meta, tags, sanitized content (already-sanitized
 * HTML is safe to inject via `dangerouslySetInnerHTML`). Fetches the entry via
 * `@openbag/core`'s `getEntry` (D1 direct — ADR-0018).
 */
export const EntryPage: FC<EntryPageProps> = async ({ user, env, id }) => {
  const e = await getEntry(env, user.id, id);
  if (!e) {
    return (
      <SiteShell user={user} title="Not found" bundle="/c/entry.js">
        <h1>Entry not found</h1>
        <p class="alert alert-error">Missing entry id or you don't have access to it.</p>
        <p><a href="/entries">← Back to entries</a></p>
      </SiteShell>
    );
  }

  // no-JS fallback for `is_not_parsed` entries.
  const headExtra = e.is_not_parsed ? (
    <meta http-equiv="refresh" content="5" />
  ) : null;

  return (
    <SiteShell user={user} title={e.title?.slice(0, 60) ?? "(untitled)"} bundle="/c/entry.js" headExtra={headExtra}>
      <p><a href="/entries">← Back</a></p>
      <article class="entry">
        <h1>{esc(e.title || "(untitled)")}</h1>
        <p class="entry-meta">
          {e.url ? (
            <>
              <a href={esc(e.url)} target="_blank" rel="noopener">{esc(e.url)}</a>
              {" · "}
            </>
          ) : null}
          {esc(fmtDateTime(e.created_at))}
          {" · "}
          {e.reading_time || 0} min read
        </p>

        <div class="actions" id="entry-actions">
          <entry-actions
            data-id={e.id}
            data-archived={e.is_archived ? "1" : "0"}
            data-starred={e.is_starred ? "1" : "0"}
          />
        </div>

        {e.tags && e.tags.length ? (
          <div class="entry-tags">
            {e.tags.map((t) => <span class="tag">{esc(t.label)}</span>)}
          </div>
        ) : null}

        <div class="entry-edit-controls">
          <button type="button" id="entry-edit-btn" class="btn-edit">Edit content</button>
        </div>

        {e.is_not_parsed ? (
          <p class="text-muted">
            <em>Fetching content…</em>{" "}
            This article was queued for parsing. The page will refresh automatically.
          </p>
        ) : null}

        <entry-poller
          data-id={e.id}
          data-is-not-parsed={e.is_not_parsed ? "1" : "0"}
        />

        <entry-editor
          data-id={e.id}
          data-has-raw={e.content_raw != null ? "1" : "0"}
        >
          <div
            id="entry-content"
            data-entry-id={e.id}
            data-has-raw={e.content_raw != null ? "1" : "0"}
            dangerouslySetInnerHTML={{ __html: e.content || "" }}
          />
        </entry-editor>
      </article>
    </SiteShell>
  );
};
