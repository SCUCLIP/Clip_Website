/* apps-script/newsletter.gs, run against a pretend Google Sheet: it only answers with the right secret, adds each
   email once per list tab, keeps formulas as text, and takes people off. (The real Sheet is checked at setup:
   docs/NEWSLETTER.md.) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { ROOT } from "./static-html.mjs";

const SECRET = "a-long-enough-test-secret";

function fakeGoogle(secret = SECRET) {
  const tabs = new Map();
  const sheet = (name) => {
    const rows = [];
    return {
      rows,
      appendRow: (r) => rows.push(Array.from(r)),
      setFrozenRows: () => {},
      getLastRow: () => rows.length,
      getRange: (row, col, n) => ({ getValues: () => rows.slice(row - 1, row - 1 + n).map((r) => [r[col - 1]]) }),
      deleteRow: (i) => rows.splice(i - 1, 1),
      name,
    };
  };
  const ctx = {
    JSON,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => tabs.get(n) || null, insertSheet: (n) => { const s = sheet(n); tabs.set(n, s); return s; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "SECRET" ? secret : null) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "apps-script/newsletter.gs"), "utf8"), ctx);
  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, tabs, ctx };
}

test("refuses a request without the right secret", () => {
  const g = fakeGoogle();
  for (const secret of [undefined, "", "wrong", SECRET + "x", SECRET.slice(0, -1)]) {
    assert.deepEqual(g.post({ secret, action: "add", rows: [{ list: "weekly", email: "a@scu.edu" }] }), { ok: false, error: "forbidden" });
  }
  assert.equal(g.tabs.size, 0);
  assert.deepEqual(fakeGoogle("short").post({ secret: "short", action: "ping" }), { ok: false, error: "forbidden" }, "a short SECRET is refused");
  assert.deepEqual(fakeGoogle(null).post({ secret: "", action: "ping" }), { ok: false, error: "forbidden" }, "no SECRET set: refuse");
  assert.deepEqual(g.ctx.doPost({ postData: { contents: "{nope" } }), { ok: false, error: "bad request" });
});

test("adds each email once, on its list's tab, with a header row", () => {
  const g = fakeGoogle();
  const out = g.post({ secret: SECRET, action: "add", rows: [
    { list: "weekly", email: "A@scu.edu", at: "2026-11-19T10:00:00Z" },
    { list: "weekly", email: "a@scu.edu", at: "2026-11-19T10:01:00Z" },
    { list: "biohackathon", email: "a@scu.edu", at: "2026-11-19T10:02:00Z" },
    { list: "secret", email: "b@scu.edu" },
    { list: "weekly", email: "not an email" },
  ] });
  assert.deepEqual(out, { ok: true, added: 2, already: 1, skipped: 2 });
  assert.deepEqual(g.tabs.get("Weekly email").rows, [["Email", "Signed up"], ["a@scu.edu", "2026-11-19T10:00:00Z"]]);
  assert.deepEqual(g.tabs.get("Biohackathon").rows, [["Email", "Signed up"], ["a@scu.edu", "2026-11-19T10:02:00Z"]]);
  assert.equal(g.post({ secret: SECRET, action: "add", rows: [{ list: "weekly", email: "a@scu.edu" }] }).already, 1);
});

test("keeps anything that looks like a formula as text", () => {
  const g = fakeGoogle();
  g.post({ secret: SECRET, action: "add", rows: [{ list: "weekly", email: "=cmd@scu.edu", at: "=NOW()" }] });
  assert.deepEqual(g.tabs.get("Weekly email").rows[1], ["'=cmd@scu.edu", "'=NOW()"]);
  assert.equal(g.post({ secret: SECRET, action: "add", rows: [{ list: "weekly", email: "=cmd@scu.edu" }] }).already, 1);
});

test("takes someone off a list", () => {
  const g = fakeGoogle();
  g.post({ secret: SECRET, action: "add", rows: [{ list: "weekly", email: "a@scu.edu" }, { list: "weekly", email: "b@scu.edu" }] });
  assert.deepEqual(g.post({ secret: SECRET, action: "remove", list: "weekly", email: "A@SCU.EDU" }), { ok: true, removed: 1 });
  assert.deepEqual(g.tabs.get("Weekly email").rows.map((r) => r[0]), ["Email", "b@scu.edu"]);
  assert.deepEqual(g.post({ secret: SECRET, action: "remove", list: "weekly", email: "a@scu.edu" }), { ok: true, removed: 0 });
  assert.deepEqual(g.post({ secret: SECRET, action: "remove", list: "nope", email: "a@scu.edu" }), { ok: false, error: "bad request" });
});

test("refuses too many rows at once, and unknown actions", () => {
  const g = fakeGoogle();
  const rows = Array.from({ length: 501 }, (_, i) => ({ list: "weekly", email: `n${i}@scu.edu` }));
  assert.deepEqual(g.post({ secret: SECRET, action: "add", rows }), { ok: false, error: "bad rows" });
  assert.deepEqual(g.post({ secret: SECRET, action: "drop" }), { ok: false, error: "unknown action" });
  assert.deepEqual(g.post({ secret: SECRET, action: "ping" }), { ok: true });
});
