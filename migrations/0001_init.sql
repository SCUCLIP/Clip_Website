-- CLIP website schema.
-- Content docs are JSON (see docs/CONTENT-FORMAT.md). Each doc has a published row (what the site shows) and a
-- draft row (what the editor edits). Publish copies a draft to published; Discard copies published back.

CREATE TABLE published (
  id TEXT PRIMARY KEY,                 -- "site" or a page id ("home", "about", ...)
  body TEXT NOT NULL,                  -- the doc, as JSON
  updated_at TEXT NOT NULL,            -- ISO 8601
  updated_by TEXT NOT NULL             -- editor email, "local" in local mode, "seed" for the seed
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  -- Goes up by one on every save. A save must send the version it loaded; if the row has moved on, the save is
  -- refused (409), so two tabs saving the same page can't silently overwrite each other.
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

-- Sign-ups from the public forms. Email, list and time only.
CREATE TABLE signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                 -- lowercased
  list TEXT NOT NULL,                  -- the form's data-list, e.g. "weekly" or "biohackathon"
  created_at TEXT NOT NULL,
  UNIQUE (email, list)
);
CREATE INDEX signups_by_list ON signups (list, created_at);

-- Photos uploaded in the editor. The bytes are in R2 under photos/<id>.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,                 -- 32 random hex characters
  content_type TEXT NOT NULL,          -- image/png, image/jpeg, image/webp or image/gif
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- Publish runs as one batch. Each draft's version check inserts a row here; a stale version inserts 0, the CHECK
-- fails, and D1 rolls back the whole batch, so a publish is all or nothing. The table is always empty afterwards.
CREATE TABLE publish_guard (ok INTEGER NOT NULL CHECK (ok = 1));
