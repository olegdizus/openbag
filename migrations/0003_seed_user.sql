-- 0003_seed_user.sql
-- Seed initial admin user.
-- Replace the placeholder hash with a bcrypt hash via wrangler secret put ADMIN_PASSWORD_HASH
-- Then apply with: wrangler d1 migrations apply DB --local

INSERT INTO users (username, email, password_hash, name)
VALUES (
  'admin',
  'admin@localhost',
  '$2b$12$PLACEHOLDER_BCRYPT_HASH_REPLACE_VIA_SECRET',
  'Admin'
)
ON CONFLICT(username) DO NOTHING;

INSERT INTO user_config (user_id)
SELECT id FROM users WHERE username = 'admin'
ON CONFLICT DO NOTHING;
