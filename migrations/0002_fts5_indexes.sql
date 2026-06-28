-- 0002_fts5_indexes.sql
-- FTS5 virtual tables for full-text search

-- Trigram index for substring matching
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts_trigram USING fts5(
  title, content, url,
  tokenize='trigram',
  content='entries',
  content_rowid='id'
);

-- Word-level index for prefix matching
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts_words USING fts5(
  title, content, url,
  tokenize='unicode61',
  content='entries',
  content_rowid='id'
);

-- Triggers to keep FTS in sync with entries table
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
