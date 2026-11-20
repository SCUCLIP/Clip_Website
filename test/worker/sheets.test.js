/* Newsletter sign-ups to the Google Sheet (src/sheets.js): sent in the background after each sign-up, retried by the
   cron trigger and the editor's "Send to the Sheet now", and taken off the Sheet when the board deletes them. */
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/index.js";
import { call, fromEditor, stubNetwork, LOCAL_ADMIN, LOCAL_PUBLIC, LOCAL_ENV, SHEETS_ENV } from "./helpers.js";

let ip = 1;
const signup = (email, list = "weekly", envOver = { ...LOCAL_ENV, ...SHEETS_ENV }) => call(LOCAL_PUBLIC + "/api/signup", {
  method: "POST", body: JSON.stringify({ email, list }),
  headers: { "Content-Type": "application/json", Origin: LOCAL_PUBLIC, "CF-Connecting-IP": "10.7.0." + ip++ },
}, envOver);
const api = (path, method = "GET", body, envOver = { ...LOCAL_ENV, ...SHEETS_ENV }) => call(LOCAL_ADMIN + path, fromEditor(method, body), envOver);
const rows = async () => (await env.DB.prepare("SELECT email, list, sheet_synced_at IS NOT NULL AS synced FROM signups ORDER BY id").all()).results;
const ok = (body) => Response.json({ ok: true, added: (body.rows || []).length });
const cron = async (envOver) => {
  const ctx = createExecutionContext();
  await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: Date.now() }, { ...env, ...envOver }, ctx);
  await waitOnExecutionContext(ctx);
};

describe("Google Sheet", () => {
  it("gets each new sign-up, with the shared secret, and the row is marked as sent", async () => {
    const seen = [];
    await stubNetwork({ sheets: (body) => { seen.push(body); return ok(body); } });
    const res = await signup("Student@SCU.edu", "biohackathon");
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual([{ secret: SHEETS_ENV.SHEETS_SECRET, action: "add", rows: [{ list: "biohackathon", email: "student@scu.edu", at: expect.any(String) }] }]);
    expect(await rows()).toEqual([{ email: "student@scu.edu", list: "biohackathon", synced: 1 }]);
    const list = await (await api("/api/admin/signups")).json();
    expect(list.sheet).toEqual({ connected: true, waiting: 0 });
    expect(list.signups[0].inSheet).toBe(true);
  });

  it("doesn't send a repeat sign-up again", async () => {
    const seen = [];
    await stubNetwork({ sheets: (body) => { seen.push(body); return ok(body); } });
    await signup("a@scu.edu");
    await signup("a@scu.edu");
    expect(seen).toHaveLength(1);
  });

  it("keeps a sign-up that couldn't reach the Sheet, and the cron trigger sends it later", async () => {
    await stubNetwork({ sheets: () => new Response("down", { status: 500 }) });
    const res = await signup("later@scu.edu");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows()).toEqual([{ email: "later@scu.edu", list: "weekly", synced: 0 }]);
    await stubNetwork({ sheets: () => Response.json({ ok: false, error: "forbidden" }) });
    await cron(SHEETS_ENV);
    expect((await rows())[0].synced).toBe(0);
    const seen = [];
    await stubNetwork({ sheets: (body) => { seen.push(body); return ok(body); } });
    await cron(SHEETS_ENV);
    expect(seen[0].rows.map((r) => r.email)).toEqual(["later@scu.edu"]);
    expect((await rows())[0].synced).toBe(1);
  });

  it("sends what's waiting when the editor asks", async () => {
    await stubNetwork({ sheets: () => new Response("down", { status: 503 }) });
    await signup("a@scu.edu");
    await signup("b@scu.edu", "biohackathon");
    expect((await (await api("/api/admin/signups")).json()).sheet).toEqual({ connected: true, waiting: 2 });
    expect((await api("/api/admin/signups/sync", "POST", {})).status).toBe(502);
    await stubNetwork({ sheets: ok });
    const out = await api("/api/admin/signups/sync", "POST", {});
    expect(await out.json()).toEqual({ sent: 2, waiting: 0 });
    expect((await call(LOCAL_PUBLIC + "/api/admin/signups/sync", fromEditor("POST", {}, LOCAL_PUBLIC), { ...LOCAL_ENV, ...SHEETS_ENV })).status).toBe(404);
  });

  it("takes a deleted sign-up off the Sheet", async () => {
    const seen = [];
    await stubNetwork({ sheets: (body) => { seen.push(body); return ok(body); } });
    await signup("gone@scu.edu");
    const { signups } = await (await api("/api/admin/signups")).json();
    const res = await api("/api/admin/signups/" + signups[0].id, "DELETE");
    expect(await res.json()).toEqual({ ok: true, sheet: "removed" });
    expect(seen[1]).toEqual({ secret: SHEETS_ENV.SHEETS_SECRET, action: "remove", list: "weekly", email: "gone@scu.edu" });
  });

  it("says so when the Sheet couldn't take a deleted sign-up off", async () => {
    await stubNetwork({ sheets: (body) => (body.action === "add" ? ok(body) : new Response("down", { status: 500 })) });
    await signup("gone@scu.edu");
    const { signups } = await (await api("/api/admin/signups")).json();
    expect(await (await api("/api/admin/signups/" + signups[0].id, "DELETE")).json()).toEqual({ ok: true, sheet: "failed" });
    expect(await rows()).toEqual([]);
  });

  it("sends nothing until both secrets are set, and only to an Apps Script address", async () => {
    await stubNetwork();
    const configs = [{}, { SHEETS_URL: SHEETS_ENV.SHEETS_URL }, { SHEETS_SECRET: SHEETS_ENV.SHEETS_SECRET },
      { ...SHEETS_ENV, SHEETS_URL: "https://evil.example/macros/s/AKfycbTestScriptId0123456789/exec" },
      { ...SHEETS_ENV, SHEETS_URL: "http://script.google.com/macros/s/AKfycbTestScriptId0123456789/exec" },
      { ...SHEETS_ENV, SHEETS_SECRET: "short" }];
    for (const [i, cfg] of configs.entries()) {
      expect((await signup(`n${i}@scu.edu`, "weekly", { ...LOCAL_ENV, SHEETS_URL: "", SHEETS_SECRET: "", ...cfg })).status, String(i)).toBe(200);
    }
    expect((await rows()).every((r) => r.synced === 0)).toBe(true);
    const list = await (await api("/api/admin/signups", "GET", undefined, LOCAL_ENV)).json();
    expect(list.sheet).toEqual({ connected: false, waiting: configs.length });
    expect((await api("/api/admin/signups/sync", "POST", {}, LOCAL_ENV)).status).toBe(503);
    await cron({});
  });
});
