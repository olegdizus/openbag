// web-ui/components/entry-poller.ts — `<entry-poller>` invisible island.
//
// If the entry is `is_not_parsed`, polls /api/entries/:id every 2 seconds; when
// the flag flips to 0, refreshes the page so the freshly-parsed content shows.
// Without JS, the SSR `<meta http-equiv="refresh" content="5">` (in entry.tsx)
// remains the fallback.

import { api } from "../lib/api";

class EntryPoller extends HTMLElement {
  private timer: number | null = null;

  connectedCallback(): void {
    if (this.dataset.isNotParsed !== "1") return;
    const id = parseInt(this.dataset.id || "", 10);
    if (!id) return;
    // 2s polling loop.
    this.timer = window.setInterval(async () => {
      try {
        const e = await api<{ is_not_parsed: number }>(`/api/entries/${id}`, {});
        if (!e.is_not_parsed) {
          if (this.timer != null) window.clearInterval(this.timer);
          // Soft-refresh; the new SSR page has parsed content + removes the meta-refresh.
          window.location.reload();
        }
      } catch {
        /* keep polling — the entry page may have a transient backend issue */
      }
    }, 2000);
  }

  disconnectedCallback(): void {
    if (this.timer != null) window.clearInterval(this.timer);
  }
}

customElements.define("entry-poller", EntryPoller);
