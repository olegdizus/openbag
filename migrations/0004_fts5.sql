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
