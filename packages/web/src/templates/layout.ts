export type LayoutUser = { id: number; username: string } | null;

export interface LayoutOptions {
  title: string;
  user?: LayoutUser;
  body: string;
  /** Hide the site header / nav. Use for login, signup, public share pages. */
  hideNav?: boolean;
  /** Add the `narrow` class to <body> for auth-style centered pages. */
  narrow?: boolean;
  /** Extra deferred script srcs to include after app.js (e.g. page-specific). */
  scripts?: string[];
}

function escapeHtml(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function siteHeader(user: LayoutUser): string {
  if (!user) return "";
  return `    <header class="site-header">
      <span class="site-brand">Wallabag CF</span>
      <nav class="site-nav" aria-label="Primary">
        <a href="/">Dashboard</a>
        <a href="/entries">Entries</a>
        <a href="/import">Import</a>
        <a href="/settings">Settings</a>
        <a href="/developer">Developer</a>
      </nav>
      <span class="site-user">${escapeHtml(user.username)}</span>
      <form method="post" action="/logout" class="inline">
        <button type="submit" class="logout-btn">Logout</button>
      </form>
    </header>`;
}

export function layout(opts: LayoutOptions): string {
  const bodyClass = opts.narrow ? "narrow" : "";
  const header = opts.hideNav ? "" : siteHeader(opts.user ?? null);
  const extraScripts = (opts.scripts ?? [])
    .map((src) => `    <script src="${escapeHtml(src)}" defer></script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${escapeHtml(opts.title)}</title>
    <link rel="stylesheet" href="/app.css"/>
  </head>
  <body${bodyClass ? ` class="${bodyClass}"` : ""}>
${header}
    <main>
${opts.body}
    </main>
    <script src="/app.js" defer></script>
${extraScripts}
  </body>
</html>`;
}

export { escapeHtml };
