// The brain index, schema version 1 (PLAN-BRAIN B2). The home server's indexer runs these
// statements in order on a new file; readers check `PRAGMA user_version` against SCHEMA_VERSION.
export const SCHEMA_VERSION = 1;

export const DDL = Object.freeze([
  "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE passages (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, trust TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, locator TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL, at TEXT, entity INTEGER)",
  "CREATE VIRTUAL TABLE fts USING fts5(title, text, tokenize='porter unicode61 remove_diacritics 2')",
  "CREATE TABLE entities (id INTEGER PRIMARY KEY, type TEXT NOT NULL, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL)",
  "CREATE TABLE aliases (entity INTEGER NOT NULL, alias TEXT NOT NULL)",
  "CREATE TABLE links (src INTEGER NOT NULL, dst INTEGER NOT NULL, type TEXT NOT NULL, PRIMARY KEY (src, dst, type))",
  "CREATE TABLE mentions (passage INTEGER NOT NULL, entity INTEGER NOT NULL, PRIMARY KEY (passage, entity))",
  "CREATE INDEX passages_entity ON passages (entity)",
  "CREATE INDEX passages_source ON passages (source)",
  "PRAGMA user_version = 1",
]);
