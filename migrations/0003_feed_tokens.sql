-- 0003_feed_tokens.sql
-- Per-user opaque tokens for RSS/Atom feed access.
--
-- Feed readers (Reeder, Feedly, Miniflux, etc.) can't easily send an OAuth2
-- Bearer header, so OpenBag exposes public feed URLs authenticated by a
-- long-lived per-user secret: /api/feeds/{username}.atom?token=<feed_token>.
--
-- The token is a 32-byte CSPRNG hex string (256 bits); lookup is by exact
-- match. Users manage it via POST/DELETE /api/feed/token.

ALTER TABLE users ADD COLUMN feed_token TEXT;
CREATE INDEX idx_users_feed_token ON users(feed_token);
