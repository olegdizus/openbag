// web-ui/layout.tsx — site shell + page primitives.
//
// `<SiteShell user navLinks title>` wraps page bodies in the <header>
// (brand, nav, current user, logout) and </footer>. The shell is rendered
// server-side with the resolved user — no client-side `/api/auth/me`
// round-trip (replaces the legacy `web-ui/js/app.js` boot flow).
//
// All output is statically-generated HTML; nothing here requires JS. Buttons
// that *do* need JS still render as plain anchors/forms so the no-JS path
// works (Phase 3 progressively enhances them).

import type { Child, FC } from "hono/jsx";
import { rawHTML, esc } from "./render";

export interface User {
  id: number;
  username: string;
}

export interface NavLink {
  label: string;
  href: string;
}

/** Top-level navigation — matches the existing `web-ui/js/app.js` nav order. */
export const NAV_LINKS: NavLink[] = [
  { label: "Entries", href: "/entries" },
  { label: "Tags", href: "/tags" },
  { label: "Import", href: "/import" },
  { label: "Settings", href: "/settings" },
  { label: "Developer", href: "/developer" },
];

interface PageProps {
  title: string;
  bundle?: string; // path to the page's bundled client JS, e.g. "/c/entry.js"
  /** Inline CSS overrides (rare). The shared /css/app.css is always loaded. */
  inlineStyle?: string;
  bodyClass?: string;
  /** Extra <head> children (Open Graph tags, meta refresh, etc). */
  headExtra?: Child;
  children: Child;
}

/**
 * Full HTML document shell. The body class drives narrow vs full-width pages
 * (mirrors `body.narrow` in `web-ui/public/css/app.css`).
 */
export const Html: FC<PageProps> = (props) => {
  const { title, bundle, inlineStyle, bodyClass, headExtra, children } = props;
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="stylesheet" href="/css/app.css" />
        {inlineStyle ? <style dangerouslySetInnerHTML={{ __html: inlineStyle }} /> : null}
        {headExtra}
      </head>
      <body class={bodyClass}>{children}</body>
      {bundle ? <script type="module" src={bundle} defer></script> : null}
    </html>
  );
};

interface SiteShellProps {
  user: User | null;
  title: string;
  /** Body-only fragment for `<main>`. Don't include the shell / header here. */
  children: Child;
  bundle?: string;
  bodyClass?: string;
  headExtra?: Child;
  /** When false, nav links are hidden (e.g. login page has no nav). */
  nav?: boolean;
}

/**
 * Standard authed page: <header><nav><user/></header><main>{children}</main>.
 * The logout button is a tiny form posting to `/api/auth/logout` so it works
 * with JS disabled. The `<logout-button>` WC (Phase 3) intercepts the click
 * for an instant redirect.
 */
export const SiteShell: FC<SiteShellProps> = (props) => {
  const { user, title, children, bundle, bodyClass = "app-shell", headExtra, nav = true } = props;
  const fullTitle = user
    ? `OpenBag — ${title}`
    : title;
  return (
    <Html title={fullTitle} bundle={bundle} bodyClass={bodyClass} headExtra={headExtra}>
      {user ? <SiteHeader user={user} nav={nav} /> : null}
      <main>{children}</main>
      <toast-region aria-live="polite"></toast-region>
    </Html>
  );
};

interface SiteHeaderProps {
  user: User;
  nav: boolean;
}

const SiteHeader: FC<SiteHeaderProps> = ({ user, nav }) => (
  <header class="site-header">
    <a class="site-brand" href="/entries">OpenBag</a>
    {nav ? (
      <nav class="site-nav">
        {NAV_LINKS.map((n) => <a href={n.href}>{n.label}</a>)}
      </nav>
    ) : null}
    <span class="site-user">
      {esc(user.username)}
      {" · "}
      <form action="/api/auth/logout" method="post" style="display:inline">
        <button type="submit" class="logout-btn" id="logout-btn">Log out</button>
      </form>
    </span>
  </header>
);
