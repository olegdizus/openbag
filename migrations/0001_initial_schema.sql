-- 0001_initial_schema.sql
-- Core tables for Wallabag CF Worker

-- Users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User config
CREATE TABLE user_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'baggy',
  items_per_page INTEGER DEFAULT 30,
  reading_speed INTEGER DEFAULT 200,
  language TEXT DEFAULT 'en',
  action_mark_as_read INTEGER DEFAULT 0,
  list_mode INTEGER DEFAULT 0,
  display_thumbnails INTEGER DEFAULT 1,
  UNIQUE(user_id)
);

-- OAuth2 clients
CREATE TABLE oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  random_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT DEFAULT '[]',
  allowed_grant_types TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_clients_user ON oauth_clients(user_id);
CREATE INDEX idx_oauth_clients_lookup ON oauth_clients(id, random_id);

-- OAuth2 access tokens
CREATE TABLE oauth_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_access_token ON oauth_access_tokens(token);
CREATE INDEX idx_oauth_access_token_expiry ON oauth_access_tokens(expires_at);

-- OAuth2 refresh tokens
CREATE TABLE oauth_refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_refresh_token ON oauth_refresh_tokens(token);

-- OAuth2 auth codes
CREATE TABLE oauth_auth_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  redirect_uri TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oauth_auth_code ON oauth_auth_codes(token);

-- Entries
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  origin_url TEXT,
  title TEXT NOT NULL,
  content TEXT,
  content_raw TEXT,
  domain_name TEXT,
  preview_picture TEXT,
  language TEXT,
  mimetype TEXT DEFAULT 'text/html',
  authors TEXT,
  reading_time INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  is_not_parsed INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 0,
  public_uuid TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_user ON entries(user_id);
CREATE INDEX idx_entries_user_archived ON entries(user_id, is_archived);
CREATE INDEX idx_entries_user_starred ON entries(user_id, is_starred);
CREATE INDEX idx_entries_user_created ON entries(user_id, created_at DESC);
CREATE INDEX idx_entries_user_updated ON entries(user_id, updated_at DESC);
CREATE INDEX idx_entries_url_hash ON entries(user_id, url_hash);
CREATE INDEX idx_entries_domain ON entries(user_id, domain_name);
CREATE INDEX idx_entries_public ON entries(public_uuid) WHERE is_public = 1;

-- Tags
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);
CREATE INDEX idx_tags_user ON tags(user_id);

-- Entry-Tags junction
CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX idx_entry_tags_tag ON entry_tags(tag_id);

-- Annotations
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  quote TEXT,
  ranges TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_annotations_entry ON annotations(entry_id);

-- Tagging rules
CREATE TABLE tagging_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tagging_rules_user ON tagging_rules(user_id);
