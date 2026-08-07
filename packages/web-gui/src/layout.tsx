// Site shell + page primitives. Everything degrades gracefully to no-JS —
// interactive buttons render as anchors/forms first.

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

/** Order mirrors the legacy `web-ui/js/app.js` nav. */
export const NAV_LINKS: NavLink[] = [
  { label: "Entries", href: "/entries" },
  { label: "Tags", href: "/tags" },
  { label: "Import", href: "/import" },
  { label: "Settings", href: "/settings" },
  { label: "Developer", href: "/developer" },
];

interface PageProps {
  title: string;
  bundle?: string; // e.g. "/c/entry.js"
  /** Always loaded alongside the shared /css/app.css. */
  inlineStyle?: string;
  bodyClass?: string;
  /** Extra <head> children (Open Graph tags, meta refresh, etc). */
  headExtra?: Child;
  children: Child;
}

/** The `bodyClass` prop drives `body.narrow` in /css/app.css. */
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
  /** Don't include shell/header here — body-only. */
  children: Child;
  bundle?: string;
  bodyClass?: string;
  headExtra?: Child;
  /** When false, nav links are hidden (e.g. login page has no nav). */
  nav?: boolean;
}

/**
 * Standard authed page. The logout button renders as a real `method=post`
 * form for no-JS; the `<logout-button>` WC intercepts it when JS is on.
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
