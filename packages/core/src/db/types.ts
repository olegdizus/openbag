// Schema types for all D1 tables

export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface OAuthClient {
  id: number;
  user_id: number;
  random_id: string;
  secret: string;
  name: string;
  redirect_uris: string;
  allowed_grant_types: string;
  created_at: string;
}

export interface OAuthAccessToken {
  id: number;
  client_id: number;
  user_id: number;
  token: string;
  expires_at: string;
  scope: string | null;
  created_at: string;
}

export interface OAuthRefreshToken {
  id: number;
  client_id: number;
  user_id: number;
  token: string;
  expires_at: string;
  scope: string | null;
  created_at: string;
}

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

export interface Tag {
  id: number;
  user_id: number;
  label: string;
  slug: string;
  created_at: string;
}

export interface EntryTag {
  entry_id: number;
  tag_id: number;
}

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

export interface TaggingRule {
  id: number;
  user_id: number;
  rule: string;
  tags: string;
  created_at: string;
}
