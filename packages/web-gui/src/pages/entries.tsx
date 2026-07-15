// web-gui/src/pages/entries.tsx — GET /entries list page.
//
// Server-side data fetch via `@openbag/core`'s `getEntries` (D1 direct, no HTTP
// round-trip — ADR-0018). Renders a static table + filter links + pagination.
// The `<entries-table>` WC intercepts filter/pagination link clicks for
// pushState-based navigation, but the page is fully usable without JS.

import { SiteShell, type User } from "../layout";
import { getEntries } from "@openbag/core";
import type { ListFilters } from "@openbag/core/wire";
import { esc, fmtDateTime, withQuery } from "../render";
import type { FC } from "hono/jsx";

interface EntriesPageProps {
  user: User;
  /** Workers env (the page calls @openbag/core with this — ADR-0018). */
  env: any;
  query: string; // raw search string, for pagination link construction
}

const parseListFilters = (search: string, userPrefs: { items_per_page?: number }): ListFilters => {
  const sp = new URLSearchParams(search);
  const ipp = parseInt(sp.get("perPage") || "", 10);
  const archive = sp.get("archive");
  const starred = sp.get("starred");
  const sort = sp.get("sort");
  return {
    page: parseInt(sp.get("page") || "1", 10) || 1,
    perPage: ipp || userPrefs.items_per_page || 30,
    archive: archive === "0" ? 0 : archive === "1" ? 1 : undefined,
    starred: starred === "0" ? 0 : starred === "1" ? 1 : undefined,
    sort: sort === "updated" ? "updated" : sort === "archived" ? "archived" : "created",
    order: sp.get("order") === "asc" ? "asc" : "desc",
    detail: "metadata",
  };
};

interface FilterLinkProps {
  href: string;
  label: string;
  active: boolean;
}
const FilterLink: FC<FilterLinkProps> = ({ href, label, active }) => (
  <a href={href} className={active ? "filter-active" : ""}>{label}</a>
);

export const EntriesPage: FC<EntriesPageProps> = async ({ user, env, query }) => {
  const sp = new URLSearchParams(query);
  const filters = parseListFilters(query, {});
  const list = await getEntries(env, user.id, filters);

  const filterBase = withQuery(query, { page: undefined });

  return (
    <SiteShell user={user} title="Entries" bundle="/c/entries.js">
      <h1>Entries</h1>
      <p class="entries-filters">
        <a href="/import">+ Add entry</a>
        {" · "}
        <FilterLink href={"/entries" + filterBase} label="All" active={!sp.has("archive") && !sp.has("starred")} />
        <FilterLink href={"/entries" + withQuery(filterBase, { archive: 0 })} label="Unread" active={sp.get("archive") === "0"} />
        <FilterLink href={"/entries" + withQuery(filterBase, { archive: 1 })} label="Archived" active={sp.get("archive") === "1"} />
        <FilterLink href={"/entries" + withQuery(filterBase, { starred: 1 })} label="Starred" active={sp.get("starred") === "1"} />
      </p>
      <div id="entries-list">
        {list.items.length === 0 ? (
          <p class="text-muted">No entries yet. Add one via the import page.</p>
        ) : (
          <entries-table>
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Domain</th>
                  <th>Created</th>
                  <th>Arch</th>
                  <th>Star</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((e) => (
                  <tr>
                    <td>
                      <a href={`/entry?id=${e.id}`}>{esc(e.title || "(untitled)")}</a>
                    </td>
                    <td>{esc(e.domain_name || "")}</td>
                    <td>{esc(fmtDateTime(e.created_at))}</td>
                    <td>{e.is_archived ? "✓" : ""}</td>
                    <td>{e.is_starred ? "★" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </entries-table>
        )}
      </div>
      {list.pages > 1 ? (
        <div class="pagination">
          {"Page "}
          <strong>{list.page}</strong>
          {` of ${list.pages} · `}
          {list.page > 1 ? <a href={"/entries" + withQuery(query, { page: 1 })}>first</a> : null}{" "}
          {list.page > 1 ? <a href={"/entries" + withQuery(query, { page: list.page - 1 })}>prev</a> : null}{" "}
          {list.page < list.pages ? <a href={"/entries" + withQuery(query, { page: list.page + 1 })}>next</a> : null}{" "}
          {list.page < list.pages ? <a href={"/entries" + withQuery(query, { page: list.pages })}>last</a> : null}
        </div>
      ) : (
        <div id="pager"></div>
      )}
    </SiteShell>
  );
};
