-- Newsletter sign-ups also go to the board's Google Sheet (src/sheets.js). Empty until the Sheet has the sign-up.
ALTER TABLE signups ADD COLUMN sheet_synced_at TEXT;
CREATE INDEX signups_waiting_for_sheet ON signups (sheet_synced_at) WHERE sheet_synced_at IS NULL;
