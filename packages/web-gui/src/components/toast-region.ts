// web-ui/components/toast-region.ts — global toast output region.
//
// Each Phase-3 island dispatches `CustomEvent("app:toast", { detail: { msg, kind } })`.
// This custom element listens once at document level and renders transient
// toasts. Styled via /css/app.css. No JS in toast markup itself.

const TOAST_EVENT = "app:toast";

interface ToastDetail {
  msg: string;
  /** "ok" → green; anything else → red. */
  kind?: "ok" | "error";
  /** ms before auto-dismiss. Default 4000. */
  duration?: number;
}

class ToastRegion extends HTMLElement {
  constructor() {
    super();
    this.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".toast");
      if (t) t.remove(); // dismiss-on-click
    });
    document.addEventListener(TOAST_EVENT, (e) => {
      const detail = (e as CustomEvent<ToastDetail>).detail || { msg: "" };
      this.show(detail.msg, detail.kind === "ok", detail.duration);
    });
  }

  show(msg: string, ok = false, duration = 4000): void {
    const el = document.createElement("div");
    el.className = `toast ${ok ? "toast-success" : "toast-error"}`;
    el.textContent = msg;
    this.appendChild(el);
    window.setTimeout(() => {
      el.classList.add("toast-leave");
      window.setTimeout(() => el.remove(), 250);
    }, duration);
  }
}

customElements.define("toast-region", ToastRegion);
