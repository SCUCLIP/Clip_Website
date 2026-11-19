-- Who changed what, for the board's records: publish, discard, photo uploads, and sign-up deletes and downloads.
-- Keep it free of visitor data: a sign-up is recorded by its row id, never its email.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,                    -- ISO 8601
  actor TEXT NOT NULL,                 -- editor email, "local" in local mode
  action TEXT NOT NULL,                -- publish, discard, photo.upload, signup.delete, signup.export
  target TEXT NOT NULL                 -- doc ids, a photo id, signup:<row id> or a list name
);
CREATE INDEX audit_log_at ON audit_log (at);
