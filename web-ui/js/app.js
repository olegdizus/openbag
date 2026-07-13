// web-ui/js/app.js — site shell + global navigation + current-user boot.
//
// Loaded on every authenticated page. Responsibilities:
//   1. Insert a consistent <header> with brand + nav + user info + logout.
//   2. On every page except /login.html, verify the session cookie via
//      GET /api/auth/me. If missing → bounce to /login.html.
//   3. Wire up the logout button → POST /api/auth/logout → /login.html.

window.app = (function () {
  /** Pages shown in the nav bar (label, href). */
  var NAV = [
    { label: "Entries", href: "/entries" },
    { label: "Tags", href: "/tags" },
    { label: "Import", href: "/import" },
    { label: "Settings", href: "/settings" },
    { label: "Developer", href: "/developer" },
  ];

  var escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return escMap[c];
    });
  }
  function fmtDateTime(stored) {
    if (!stored) return "";
    // D1 returns "2026-07-05 12:34:56" → make ISO.
    var iso = stored.includes("T") ? stored : stored.replace(" ", "T") + "Z";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return stored;
    return d.toLocaleString();
  }

  /** Build the site header into `<body data-app-shell>`. */
  function buildHeader(user) {
    var header = document.createElement("header");
    header.className = "site-header";
    header.innerHTML =
      '<a class="site-brand" href="/entries">OpenBag</a>' +
      '<nav class="site-nav">' +
      NAV.map(function (n) {
        return '<a href="' + n.href + '">' + esc(n.label) + "</a>";
      }).join("") +
      "</nav>" +
      (user
        ? '<span class="site-user">' +
          esc(user.username) +
          ' · <button type="button" id="logout-btn" class="logout-btn">Log out</button></span>'
        : "");
    document.body.prepend(header);
    var lb = document.getElementById("logout-btn");
    if (lb) lb.addEventListener("click", logout);
  }

  async function logout() {
    try {
      await window.api("/api/auth/logout", { method: "POST" });
    } catch (e) {
      /* swallow — bounced already if 401 */
    }
    window.location.href = "/login";
  }

  /**
   * Boot the shell: looks up `/api/auth/me`. On a logged-out page this is a
   * no-op; on authenticated pages a missing user bounces to /login.html.
   *
   * Returns a Promise<user|null>.
   */
  async function boot() {
    var path = location.pathname.replace(/\.html$/, "");
    var isAuthPage = path === "/login" || path === "/signup";
    if (isAuthPage || path === "/") {
      // No shell on the login/signup pages (and the index redirects to /entries).
      return null;
    }
    var user = null;
    try {
      var r = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (r.ok) user = (await r.json()).user;
    } catch (e) {}
    if (!user) {
      try {
        sessionStorage.setItem("login_next", location.pathname + location.search);
      } catch (e) {}
      window.location.href = "/login";
      return null;
    }
    buildHeader(user);
    return user;
  }

  return { boot: boot, esc: esc, fmtDateTime: fmtDateTime, logout: logout };
})();
