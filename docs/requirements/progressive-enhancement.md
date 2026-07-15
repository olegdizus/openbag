# Progressive enhancement requirements

The contract every interactive surface must satisfy: the page is fully
functional with JavaScript disabled; JS only enhances UX. See
[ADR-0010](../decisions/0010-progressive-enhancement-as-hard-requirement.md).

The single documented carveout is the WYSIWYG *editor* on `/entry` — see
[UI-PE-008](#ui-pe-008--the-editor-is-the-only-js-required-surface) and
[ADR-0015](../decisions/0015-custom-contenteditable-editor-not-tiptap.md). Every
other surface, including the entry *reader* (without "Edit content"), works
without JS.

## Stories

### UI-PE-001 — Login works without JS

**As a** user with JS disabled,
**I want** to log in by submitting the form,

**so that** I can use the app.

**Acceptance criteria:**

- **Given** JS is disabled in the browser,
- **When** I submit the login form,
- **Then** the browser POSTs the form fields natively to
  `/api/auth/login`, the server sets the `session` cookie, and the next
  response (status `200`) redirects to `/entries` (or the `next` URL).
- **And** no `fetch` call is involved.

### UI-PE-002 — Signup gating is server-side

**As a** user on a deployment where registration is disabled,
**I want** the signup form to be unavailable even without JS,

**so that** there is no client-only gating that an attacker can bypass.

**Acceptance criteria:**

- **Given** `ALLOWED_REGISTRATION` is not `true`,
- **When** `GET /login` with JS disabled,
- **Then** the response HTML contains no `<form action="/api/auth/signup">`.
- **And** the server also enforces the check on signup POSTs.

### UI-PE-003 — Filtering and pagination are real links

**As a** reader with JS disabled,
**I want** filter links (All, Unread, Archived, Starred) and pagination
links to work,

**so that** I can navigate the entries list.

**Acceptance criteria:**

- **Given** `/entries` rendered with JS disabled,
- **When** I click `Archived`,
- **Then** the browser navigates to `/entries?archive=1`, and the server
  returns the filtered list.

Backed by [ADR-0010](../decisions/0010-progressive-enhancement-as-hard-requirement.md).

### UI-PE-004 — Archiving, starring, deleting via real forms

**As a** reader with JS disabled,
**I want** to archive, star, and delete entries via real form submits,

**so that** these core actions work regardless of JS state.

**Acceptance criteria:**

- **Given** `/entry?id=42` rendered with JS disabled,
- **When** I click the archive button,
- **Then** the browser POSTs a form to `/ui/entries/42/archive` (or
  similar `/ui/*` route), the server mutates via the shared helper, and
  the response is `303 See Other` back to `/entry?id=42` with the archive
  state flipped.

Backed by [ADR-0014](../decisions/0014-ui-mutation-routes-under-ui-namespace.md).

### UI-PE-005 — Tag delete, OAuth client delete, feed-token rotate/revoke all work without JS

**As a** user with JS disabled,
**I want** tag deletes, OAuth client deletes, and feed-token rotations to
work via real form POSTs,

**so that** no administrative action is JS-only.

**Acceptance criteria:**

- **Given** `/tags`, `/developer`, `/settings` rendered with JS disabled,
- **When** I submit any delete/rotate/revoke form,
- **Then** the browser POSTs to the corresponding `/ui/*` route and the
  response is `303 See Other` back to the page with the mutation applied.

### UI-PE-006 — Import (single and bulk) works without JS

**As a** reader with JS disabled,
**I want** to add URLs via the import form,

**so that** I can save articles even from restrictive clients.

**Acceptance criteria:**

- **Given** `/import` with JS disabled,
- **When** I submit the single-URL form,
- **Then** the browser POSTs to `/ui/import/single`; on success the
  response is `303 See Other` to `/entry?id={createdId}`.
- **When** I submit the bulk form,
- **Then** the browser POSTs to `/ui/import/bulk`; the response is `303
  See Other` to `/import?imported=N`.

### UI-PE-007 — With JS enabled, optimistic updates and pushState take over

**As a** reader with JS enabled,
**I want** archive/star/delete to be optimistic and filters to update the
URL without a full reload,

**so that** the UX is fast and modern.

**Acceptance criteria:**

- **Given** the Web Component bundles have loaded on the page,
- **When** I click an archive button,
- **Then** the UI flips state immediately, the WC dispatches a `PATCH
  /api/entries/{id}` JSON request, and rolls back on error.
- **When** I click a filter link,
- **Then** the WC intercepts the click, calls `history.pushState`, re-fetches
  via `GET /api/entries?…`, and swaps the table body without a full reload.

### UI-PE-008 — The editor is the only JS-required surface

**As a** reader with JS disabled,
**I want** every feature except the WYSIWYG editor to work,

**so that** the one carveout does not bleed into other surfaces.

**Acceptance criteria:**

- **Given** `/entry?id=42` with JS disabled,
- **When** I open the page,
- **Then** the article, tags, metadata, archive/star/delete buttons all
  render and work via forms.
- **And** the "Edit content" action is visibly documented as requiring JS
  (a `<noscript>` block explains this and links to `/entry/42/edit` if
  that no-JS path is later provided — see
  [ADR-0015](../decisions/0015-custom-contenteditable-editor-not-tiptap.md)).

Backed by [ADR-0010](../decisions/0010-progressive-enhancement-as-hard-requirement.md)
and [ADR-0015](../decisions/0015-custom-contenteditable-editor-not-tiptap.md).

### UI-PE-009 — Islands never overwrite user data without confirmation

**As a** reader,
**I want** optimistic updates to roll back on server errors,

**so that** a failed PATCH does not leave the UI in a wrong state.

**Acceptance criteria:**

- **Given** a WC has applied an optimistic state change,
- **When** the server responds non-2xx,
- **Then** the WC reverts the UI to the prior state and dispatches a
  toast event.

Backed by [ADR-0009](../decisions/0009-ui-tech-stack-hono-jsx-wc-not-preact-or-htmx.md).

### UI-PE-010 — `<noscript>` messaging on every page

**As a** reader,
**I want** to see clear messaging on every page if my JS is disabled and
some enhancement did not apply,

**so that** I understand the state of the UI.

**Acceptance criteria:**

- **Given** any authenticated page rendered with JS disabled,
- **When** inspected,
- **Then** a `<noscript>` block is present explaining that the page is
  fully functional without JS but with reduced polish.

## Out of scope for this file

- Pure SSR rendering concerns without a JS dimension are in
  [`ui-ssr.md`](ui-ssr.md).
- Security properties of the mutation routes are in [`security.md`](security.md).
