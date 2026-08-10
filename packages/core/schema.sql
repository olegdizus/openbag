-- worker/schema.sql — single authoritative schema for OpenBag
-- Run from scratch (drops + recreates all tables; wipes all data).
--
-- Apply via:
--   pnpm exec wrangler d1 execute openbag-db --local  --file=worker/schema.sql
--   pnpm exec wrangler d1 execute openbag-db --remote --file=worker/schema.sql
--
-- Or the convenience scripts:
--   pnpm db:init         (local)
--   pnpm db:init:remote  (remote)
--
-- Schema changes: edit this file in place, re-run `pnpm db:init`. There is no
-- forward-only migration system; data is treated as disposable.

-- ============================================================================
-- Users (+ feed_token folded in from former 0003_feed_tokens.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  name TEXT,
  feed_token TEXT,                      -- 32-byte hex; nullable
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_feed_token ON users(feed_token);

-- ============================================================================
-- User config (7 fields exposed via /api/config)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_config (
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

-- ============================================================================
-- Sessions — opaque session ids for browser cookie auth
-- (replaces the legacy forgeable session=<username> cookie)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,           -- 32-byte hex, this is the cookie value
  token_hash   TEXT NOT NULL UNIQUE,       -- sha256(id): DB-leak ≠ session forgery
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,              -- 30 days from issue
  last_used_at TEXT,                       -- updated on each auth
  user_agent   TEXT                        -- rough fingerprint for "log out everywhere"
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

-- ============================================================================
-- Login throttle — brute-force protection for /api/auth/login + password grant
-- ============================================================================
CREATE TABLE IF NOT EXISTS login_attempts (
  key           TEXT NOT NULL,           -- lowercased username
  attempted_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key_time ON login_attempts(key, attempted_at);

-- ============================================================================
-- OAuth2 — clients, access tokens, refresh tokens, auth codes
-- (Wallabag v2 compatible; see SPEC.md §6.3–6.4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS oauth_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  random_id TEXT NOT NULL,
  secret TEXT NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT DEFAULT '[]',
  allowed_grant_types TEXT DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_user   ON oauth_clients(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_clients_lookup ON oauth_clients(id, random_id);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_access_token        ON oauth_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_oauth_access_token_expiry ON oauth_access_tokens(expires_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_token ON oauth_refresh_tokens(token);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  redirect_uri TEXT,
  expires_at TEXT NOT NULL,
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_code ON oauth_auth_codes(token);

-- ============================================================================
-- Entries
-- ============================================================================
CREATE TABLE IF NOT EXISTS entries (
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
CREATE INDEX IF NOT EXISTS idx_entries_user           ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_user_archived  ON entries(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_entries_user_starred   ON entries(user_id, is_starred);
CREATE INDEX IF NOT EXISTS idx_entries_user_created   ON entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user_updated   ON entries(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_url_hash       ON entries(user_id, url_hash);
CREATE INDEX IF NOT EXISTS idx_entries_domain         ON entries(user_id, domain_name);
CREATE INDEX IF NOT EXISTS idx_entries_public         ON entries(public_uuid) WHERE is_public = 1;

-- ============================================================================
-- Tags + entry-tag junction
-- ============================================================================
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

-- ============================================================================
-- Annotations
-- ============================================================================
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  text TEXT NOT NULL,
  quote TEXT,
  ranges TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_entry ON annotations(entry_id);

-- ============================================================================
-- Tagging rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS tagging_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  tags TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tagging_rules_user ON tagging_rules(user_id);

-- ============================================================================
-- FTS5 virtual tables (full-text search) + sync triggers
-- ============================================================================
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts_trigram USING fts5(
  title, content, url,
  tokenize='trigram',
  content='entries',
  content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts_words USING fts5(
  title, content, url,
  tokenize='unicode61',
  content='entries',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts_trigram(rowid, title, content, url)
  VALUES (new.id, new.title, new.content, new.url);
  INSERT INTO entries_fts_words(rowid, title, content, url)
  VALUES (new.id, new.title, new.content, new.url);
END;

CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts_trigram(entries_fts_trigram, rowid, title, content, url)
  VALUES ('delete', old.id, old.title, old.content, old.url);
  INSERT INTO entries_fts_words(entries_fts_words, rowid, title, content, url)
  VALUES ('delete', old.id, old.title, old.content, old.url);
END;

CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts_trigram(entries_fts_trigram, rowid, title, content, url)
  VALUES ('delete', old.id, old.title, old.content, old.url);
  INSERT INTO entries_fts_words(entries_fts_words, rowid, title, content, url)
  VALUES ('delete', old.id, old.title, old.content, old.url);
  INSERT INTO entries_fts_trigram(rowid, title, content, url)
  VALUES (new.id, new.title, new.content, new.url);
  INSERT INTO entries_fts_words(rowid, title, content, url)
  VALUES (new.id, new.title, new.content, new.url);
END;
