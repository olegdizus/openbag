import { SiteShell, type User } from "../layout";
import { esc } from "../render";
import type { FC } from "hono/jsx";

interface ImportPageProps {
  user: User;
  /** ?imported=N after a successful bulk import. */
  imported?: number;
  /** ?error=... after a single-import failure. */
  error?: string;
}

/**
 * Two REAL <form> elements posting to `/ui/import/single` and
 * `/ui/import/bulk`. Without JS they submit natively and redirect to the
 * created entry / a status line. With JS, the `<import-form>` WC wires
 * dynamic URL counting + per-URL status.
 */
export const ImportPage: FC<ImportPageProps> = ({ user, imported, error }) => {
  return (
    <SiteShell user={user} title="Import" bundle="/c/import.js">
      <h1>Import</h1>
      <div id="result">
        {imported != null ? <div class="alert alert-success">Imported {imported} entries.</div> : null}
        {error ? <div class="alert alert-error">{esc(error)}</div> : null}
      </div>

      <import-form>
        <h2>Add a single entry</h2>
        <form id="single-form" action="/ui/import/single" method="post">
          <fieldset>
            <label for="single-url">URL</label>
            <input
              type="url"
              id="single-url"
              name="url"
              placeholder="https://example.com/article"
              required
            />
          </fieldset>
          <fieldset>
            <label for="single-title">Title (optional — auto-detected if blank)</label>
            <input type="text" id="single-title" name="title" />
          </fieldset>
          <button type="submit">Save entry</button>
        </form>

        <h2>Bulk import</h2>
        <form id="bulk-form" action="/ui/import/bulk" method="post">
          <fieldset>
            <label for="bulk-urls">One URL per line</label>
            <textarea
              id="bulk-urls"
              name="urls"
              rows={8}
              placeholder="https://example.com/a&#10;https://example.com/b"
            ></textarea>
          </fieldset>
          <button type="submit">Import all</button>
        </form>
      </import-form>
    </SiteShell>
  );
};
