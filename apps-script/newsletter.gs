/* CLIP newsletter sign-ups, kept in this Google Sheet.

   The website (the Cloudflare Worker) sends each new sign-up here, and takes people off when the board deletes
   them in the editor. Paste this whole file into the Sheet's Apps Script (Extensions > Apps Script), set the
   script property SECRET, and deploy it as a web app. docs/NEWSLETTER.md has the steps.

   - Only requests with the right SECRET are accepted. The website keeps the same value as the Worker secret
     SHEETS_SECRET. Anyone else who finds this script's address gets "forbidden".
   - Each list has its own tab: "Weekly email" and "Biohackathon". Each row is an email and when it signed up.
   - An email already on a tab isn't added again.
   - Anything that looks like a spreadsheet formula is stored as plain text. */

var LISTS = { weekly: "Weekly email", biohackathon: "Biohackathon" };
var EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
var MAX_ROWS = 500;

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return reply_({ ok: false, error: "bad request" }); }
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || secret.length < 16 || !req || typeof req.secret !== "string" || !sameText_(req.secret, secret)) {
    return reply_({ ok: false, error: "forbidden" });
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (req.action === "ping") return reply_({ ok: true });
    if (req.action === "add") return reply_(add_(req.rows));
    if (req.action === "remove") return reply_(remove_(req.list, req.email));
    return reply_({ ok: false, error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}

/* Visiting the address in a browser shows this, so it's easy to check the deployment works. */
function doGet() {
  return reply_({ ok: true, what: "CLIP newsletter sign-ups. The website sends sign-ups here." });
}

function add_(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return { ok: false, error: "bad rows" };
  var added = 0, already = 0, skipped = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var email = clean_(r.email);
    if (!LISTS[r.list] || !email) { skipped++; continue; }
    var sheet = tab_(r.list);
    if (rowOf_(sheet, email) > 0) { already++; continue; }
    sheet.appendRow([asText_(email), asText_(String(r.at || new Date().toISOString()).slice(0, 40))]);
    added++;
  }
  return { ok: true, added: added, already: already, skipped: skipped };
}

function remove_(list, email) {
  email = clean_(email);
  if (!LISTS[list] || !email) return { ok: false, error: "bad request" };
  var sheet = tab_(list), removed = 0, row;
  while ((row = rowOf_(sheet, email)) > 0) { sheet.deleteRow(row); removed++; }
  return { ok: true, removed: removed };
}

/* The tab for a list, made with a header row the first time. */
function tab_(list) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(LISTS[list]);
  if (!sheet) {
    sheet = book.insertSheet(LISTS[list]);
    sheet.appendRow(["Email", "Signed up"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* The row number (1-based) of an email on a tab, or 0. */
function rowOf_(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).replace(/^'/, "").trim().toLowerCase() === email) return i + 2;
  }
  return 0;
}

function clean_(email) {
  email = String(email || "").trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : "";
}

/* A leading apostrophe makes Sheets keep the value as text (and doesn't show it), so nothing becomes a formula. */
function asText_(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/* Compares two strings in time that doesn't depend on where they differ. */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
