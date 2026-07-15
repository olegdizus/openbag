// web-ui/components/entries-table.ts — `<entries-table>` island.
//
// Progressive enhancement: intercepts filter/pagination link clicks, pushes
// the new URL via history.pushState, re-fetches via GET /api/entries, and
// swaps the table body. Without JS the SSR links work natively.
//
// Reads data-* attrs (none today; reserved for future "compact mode").

import { api } from "../lib/api";

interface StoredEntry {
  id: number;
  url: string;
  title: string | null;
  domain_name: string | null;
  created_at: string;
  is_archived: number | boolean;
  is_starred: number | boolean;
}

function fmtDate(s: string): string {
  if (!s) return "";
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function escapeHtml(s: unknown): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

function rowsHtml(items: StoredEntry[]): string {
  return items
    .map(
      (e) =>
        `<tr>` +
        `<td><a href="/entry?id=${e.id}">${escapeHtml(e.title || "(untitled)")}</a></td>` +
        `<td>${escapeHtml(e.domain_name || "")}</td>` +
        `<td>${escapeHtml(fmtDate(e.created_at))}</td>` +
        `<td>${e.is_archived ? "✓" : ""}</td>` +
        `<td>${e.is_starred ? "★" : ""}</td>` +
        `</tr>`,
    )
    .join("");
}

class EntriesTable extends HTMLElement {
  connectedCallback(): void {
    // Only override link clicks when JS is enabled.
    this.ownerDocument.documentElement.addEventListener("click", this.onClick);
    window.addEventListener("popstate", this.onPopState);
  }
  disconnectedCallback(): void {
    this.ownerDocument.documentElement.removeEventListener("click", this.onClick);
    window.removeEventListener("popstate", this.onPopState);
  }

  private onClick = async (e: MouseEvent): Promise<void> => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    // Only intercept same-origin /entries, /entry, /tags, /import, /settings, /developer,
    // /api/entries — filter/pagination only kicks in for navigation that would
    // refresh the entries table.
    if (!href.startsWith("/entries") && !href.startsWith("/")) return;
    if (!href.startsWith("/entries")) return;
    e.preventDefault();
    const nextUrl = href;
    history.pushState({}, "", nextUrl);
    await this.swap(nextUrl);
  };

  private onPopState = async (): Promise<void> => {
    await this.swap(location.pathname + location.search);
  };

  private async swap(url: string): Promise<void> {
    try {
      const u = new URL(url, location.origin);
      const apiQ = new URLSearchParams(u.search);
      // Pull only the params the API cares about; rest are UX-only.
      const keep = ["page", "perPage", "archive", "starred", "sort", "order"];
      const cleaned = new URLSearchParams();
      for (const k of keep) {
        const v = apiQ.get(k);
        if (v != null) cleaned.set(k, v);
      }
      const data = await api<{ _embedded?: { items: StoredEntry[] }; pages: number; page: number }>(
        `/api/entries?${cleaned.toString()}`,
        {},
      );
      const body = this.querySelector("tbody");
      if (body) body.innerHTML = rowsHtml(data._embedded?.items ?? []);
      // Also update the page-shell pagination markers.
      const pager = document.querySelector(".pagination");
      if (pager) pager.scrollIntoView({ block: "nearest" });
    } catch (e) {
      /* toast already shown by api() helper */
    }
  }
}

customElements.define("entries-table", EntriesTable);
