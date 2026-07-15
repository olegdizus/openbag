// D1 row shapes — one interface per persisted table.
//
// These mirror the column shapes in `packages/core/schema.sql`, NOT the
// Wallabag JSON wire shape (that lives in `shared/types.ts`). The `Entry`
// and `Tag` row types may be referenced by query helpers, but most modules
// use small inline `{…}` selections; the types here exist so consumers and
// future query helpers have a single canonical name for each table.

/** `users` row. */
export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  name: string | null;
  feed_token: string | null;
  created_at: string;
  updated_at: string;
}

/** `user_config` row. Lives in its own table; exposed via `GET /api/config`. */
export interface UserConfig {
  id: number;
  user_id: number;
  theme: string;
  items_per_page: number;
  reading_speed: number;
  language: string;
  action_mark_as_read: number;
  list_mode: number;
  display_thumbnails: number;
}

/** `oauth_clients` row. */
export interface OAuthClient {
  id: number;
  user_id: number;
  random_id: string;
  secret: string;
  name: string;
  redirect_uris: string; // JSON-encoded array default '[]'
  allowed_grant_types: string; // JSON-encoded array default '[]'
  created_at: string;
}

/** `oauth_access_tokens` row. */
export interface OAuthAccessToken {
  id: number;
  client_id: number;
  user_id: number;
  token: string;
  expires_at: string;
  scope: string | null;
  created_at: string;
}

/** `oauth_refresh_tokens` row. */
export interface OAuthRefreshToken {
  id: number;
  client_id: number;
  user_id: number;
  token: string;
  expires_at: string;
  scope: string | null;
  created_at: string;
}

/** `oauth_auth_codes` row. */
export interface OAuthAuthCode {
  id: number;
  client_id: number;
  user_id: number;
  token: string;
  redirect_uri: string | null;
  expires_at: string;
  scope: string | null;
  created_at: string;
}

/** `entries` row (the wide row). */
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
}

/** `tags` row. */
export interface Tag {
  id: number;
  user_id: number;
  label: string;
  slug: string;
  created_at: string;
}

/** `entry_tags` junction row. */
export interface EntryTag {
  entry_id: number;
  tag_id: number;
}

/** `annotations` row. */
export interface Annotation {
  id: string;
  entry_id: number;
  user_id: number;
  text: string;
  quote: string | null;
  ranges: string;
  created_at: string;
  updated_at: string;
}

/** `tagging_rules` row. */
export interface TaggingRule {
  id: number;
  user_id: number;
  rule: string;
  tags: string;
  created_at: string;
}
