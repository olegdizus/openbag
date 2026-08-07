const TOAST_EVENT = "app:toast";

interface ToastDetail {
  msg: string;
  /** "ok" → green; anything else → red. */
  kind?: "ok" | "error";
  /** ms before auto-dismiss. Default 4000. */
  duration?: number;
}

/**
 * Listens for `app:toast` CustomEvents (`{ detail: { msg, kind } }`, dispatched
 * by every WC island). Auto-dismiss; styled in /css/app.css.
 */
class ToastRegion extends HTMLElement {
  constructor() {
    super();
    this.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".toast");
      if (t) t.remove();
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
