import { api } from "../lib/api";

/**
 * `<feed-token-actions>` — JS path: GET/POST/DELETE /api/feed/token for
 * instant refresh/rotate/revoke. Server fallback: /ui/feed/token/* POSTs.
 */
class FeedTokenActions extends HTMLElement {
  connectedCallback(): void {
    this.render();
  }

  private get attrs() {
    return {
      token: this.dataset.token || "",
      atomUrl: this.dataset.atomUrl || "",
      rssUrl: this.dataset.rssUrl || "",
    };
  }

  private render(): void {
    const { token, atomUrl, rssUrl } = this.attrs;
    const out = document.createElement("pre");
    out.className = "card";
    if (token) {
      out.innerHTML =
        `<div class="cred-row"><strong>token:</strong> <code>${escapeHtml(token)}</code></div>` +
        (atomUrl ? `<div class="cred-row"><strong>Atom:</strong> <code>${escapeHtml(atomUrl)}</code></div>` : "") +
        (rssUrl ? `<div class="cred-row"><strong>RSS:</strong> <code>${escapeHtml(rssUrl)}</code></div>` : "");
    } else {
      out.textContent = "No feed token issued.";
    }

    const controls = document.createElement("p");
    controls.innerHTML =
      '<button type="button" data-action="refresh">Refresh</button> ' +
      '<button type="button" data-action="rotate">Rotate</button> ' +
      '<button type="button" class="btn-danger" data-action="revoke">Revoke</button>';

    this.innerHTML = "";
    this.appendChild(out);
    this.appendChild(controls);

    controls.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) =>
      btn.addEventListener("click", this.onClick),
    );
  }

  private onClick = async (e: Event): Promise<void> => {
    const action = (e.target as HTMLButtonElement).dataset.action;
    if (action === "rotate" && !window.confirm("Generate a new feed token? The old one will stop working.")) return;
    if (action === "revoke" && !window.confirm("Revoke the feed token?")) return;
    try {
      if (action === "refresh") {
        const data = await api<{ feed_token: string | null; atom_url: string | null; rss_url: string | null }>(
          "/api/feed/token",
          {},
        );
        this.dataset.token = data.feed_token ?? "";
        this.dataset.atomUrl = data.atom_url ?? "";
        this.dataset.rssUrl = data.rss_url ?? "";
        this.render();
        api.toast("Token refreshed", { ok: true });
      } else if (action === "rotate") {
        const data = await api<{ feed_token: string; atom_url: string; rss_url: string }>(
          "/api/feed/token",
          { method: "POST" },
        );
        this.dataset.token = data.feed_token;
        this.dataset.atomUrl = data.atom_url;
        this.dataset.rssUrl = data.rss_url;
        this.render();
        api.toast("Token rotated", { ok: true });
      } else if (action === "revoke") {
        await api("/api/feed/token", { method: "DELETE" });
        this.dataset.token = "";
        this.dataset.atomUrl = "";
        this.dataset.rssUrl = "";
        this.render();
        api.toast("Token revoked", { ok: true });
      }
    } catch { /* toast already shown */ }
  };
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}

customElements.define("feed-token-actions", FeedTokenActions);
