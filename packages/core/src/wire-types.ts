// shared/types.ts — public types crossing the worker/ ↔ web-ui/ boundary.
//
// Anything imported by both `worker/` and `web-ui/` belongs here so the two
// packages can compile independently. These types mirror the JSON wire shape
// of `/api/*` (Wallabag-compatible), not the D1 row shape — that stays in
// worker/ internal types.

/** Authenticated user; attached to Hono context and rendered into SSR shell. */
export interface User {
  id: number;
  username: string;
}

/** Partial user shape returned by `GET /api/auth/me`. */
export interface UserInfo extends User {
  email: string | null;
  name: string | null;
  created_at: string;
}

/** Tag row shape (matches `GET /api/tags` items). */
export interface Tag {
  id: number;
  label: string;
  slug: string;
}

/** Tag with usage count (`GET /api/tags` enriched shape). */
export interface TagWithCount extends Tag {
  nbEntries: number;
}

/** User preferences (`GET /api/config`). */
export interface UserConfig {
  theme: string;
  items_per_page: number;
  reading_speed: number;
  language: string;
  action_mark_as_read: number;
  list_mode: number;
  display_thumbnails: number;
}

/** Feed-token response shape (`GET /api/feed/token`). */
export interface FeedToken {
  feed_token: string | null;
  atom_url: string | null;
  rss_url: string | null;
}

/**
 * Wallabag-compatible entry shape (what `GET /api/entries/:id` returns).
 * Flags are 0/1 integers per the legacy contract — NOT booleans.
 */
export interface Entry {
  id: number;
  user_id: number;
  url: string;
  url_hash: string;
  origin_url: string | null;
  title: string;
  content: string | null;
  content_raw: string | null;
  domain_name: string | null;
  preview_picture: string | null;
  language: string | null;
  mimetype: string;
  authors: string | null;
  reading_time: number;
  is_archived: number;
  is_starred: number;
  is_not_parsed: number;
  is_public: number;
  public_uuid: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  user_name?: null;
  user_email?: null;
}

/** List-query filters (URL params for `GET /api/entries`). */
export interface ListFilters {
  page?: number;
  perPage?: number;
  archive?: 0 | 1;
  starred?: 0 | 1;
  public?: 0 | 1;
  notParsed?: 0 | 1;
  domain?: string;
  tags?: string[];
  since?: number;
  annotations?: boolean;
  sort?: "created" | "updated" | "archived";
  order?: "asc" | "desc";
  detail?: "full" | "metadata";
}

/** Wallabag HAL-style collection envelope for entry lists. */
export interface EntryList {
  _embedded: { items: Entry[] };
  _links: Record<string, { href: string }>;
  limit: number;
  page: number;
  pages: number;
  total: number;
}

/** OAuth client shape returned by `GET /api/oauth/clients`. */
export interface OAuthClient {
  id: number;
  random_id: string;
  secret: string;
  name: string;
  redirect_uris: string[] | string;
  allowed_grant_types: string[] | string;
  created_at?: string;
}

/** Successful auth-response body from `/api/auth/login|signup`. */
export interface AuthResponseBody {
  user: UserInfo;
}

/** Response body from `/api/entries/:id` POST/PATCH. */
export type EntryResponse = Entry | { error: { code: number; message: string } };
