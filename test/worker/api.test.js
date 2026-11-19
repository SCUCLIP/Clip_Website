/* Every API route, and every refusal in CLAUDE.md security rule 13. */
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { call, fromEditor, stubNetwork, LOCAL_ADMIN, LOCAL_PUBLIC, PROD_PUBLIC, LOCAL_ENV, PROD_ENV } from "./helpers.js";

const api = (path, method = "GET", body, headers) => call(LOCAL_ADMIN + path, fromEditor(method, body, LOCAL_ADMIN, headers), LOCAL_ENV);
const loadDraft = async (id) => (await (await api("/api/admin/drafts/" + id)).json());
const published = async (id) => JSON.parse((await env.DB.prepare("SELECT body FROM published WHERE id = ?").bind(id).first()).body);

/* A 1x1 PNG. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const upload = (bytes, type) => call(LOCAL_ADMIN + "/api/admin/photos", fromEditor("POST", bytes, LOCAL_ADMIN, { "Content-Type": type }), LOCAL_ENV);

const DOC_IDS = ["about", "biohackathon", "board", "data", "events", "faq", "home", "resources", "settings", "speakers"];
const el = (doc, id) => doc.sections.flatMap((s) => s.elements).find((e) => e.id === id);

describe("GET /api/admin/docs and /drafts/:id", () => {
  it("returns every doc with its draft, version and published copy", async () => {
    const res = await api("/api/admin/docs");
    expect(res.status).toBe(200);
    const { docs } = await res.json();
    expect(Object.keys(docs).sort()).toEqual(DOC_IDS);
    expect(docs.home).toMatchObject({ version: 1, draftUpdatedBy: "seed", publishedBy: "seed" });
    expect(docs.home.draft).toEqual(docs.home.published);
    expect(docs.home.draft.v).toBe(5);
    expect(docs.settings.draft.contactEmail).toBe("connectingleaders@scu.edu");
  });

  it("returns one doc, and 404 for anything else", async () => {
    expect((await loadDraft("faq")).draft.v).toBe(5);
    expect((await loadDraft("data")).draft.members.length).toBe(5);
    for (const id of ["admin", "site", "_meta", "%E0%A4%A"]) expect((await api("/api/admin/drafts/" + id)).status, id).toBe(404);
  });
});

describe("PUT /api/admin/drafts/:id", () => {
  it("saves what norm() returns and bumps the version", async () => {
    const { draft, version } = await loadDraft("about");
    el(draft, "ephab01ttl").text = "About CLIP";
    draft.junk = "dropped";
    el(draft, "ephab01ttl").onclick = "dropped";
    const res = await api("/api/admin/drafts/about", "PUT", { version, doc: draft });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version).toBe(version + 1);
    expect(el(out.doc, "ephab01ttl").text).toBe("About CLIP");
    expect(out.doc.junk).toBeUndefined();
    expect(el(out.doc, "ephab01ttl").onclick).toBeUndefined();
    const row = await env.DB.prepare("SELECT body, version, updated_by FROM drafts WHERE id = 'about'").first();
    expect({ version: row.version, updated_by: row.updated_by }).toEqual({ version: 2, updated_by: "local" });
    expect(JSON.parse(row.body)).toEqual(out.doc);
    expect(el(await published("about"), "ephab01ttl").text).not.toBe("About CLIP");
  });

  it("gives a normalized doc back unchanged", async () => {
    for (const id of DOC_IDS) {
      const { draft, version } = await loadDraft(id);
      const out = await (await api("/api/admin/drafts/" + id, "PUT", { version, doc: draft })).json();
      expect(out.doc, id).toEqual(draft);
    }
  });

  it("repairs what it can, like the prototype's norm()", async () => {
    const { draft, version } = await loadDraft("home");
    el(draft, "ehero01btn1").url = "javascript:alert(document.cookie)";
    el(draft, "ehero01ttl").kind = "gigantic";
    el(draft, "ehero01logo").src = "../../secrets";
    draft.sections[0].elements.push({ id: "bad1", type: "iframe", src: "https://evil.example" });
    const out = await (await api("/api/admin/drafts/home", "PUT", { version, doc: draft })).json();
    expect(el(out.doc, "ehero01btn1").url).toBe("javascript:alert(document.cookie)");
    expect(el(out.doc, "ehero01ttl").kind).toBe("hero");
    expect(el(out.doc, "ehero01logo").src).toBe("");
    expect(el(out.doc, "bad1")).toBeUndefined();
    /* The stored link is never rendered as a link. */
    await api("/api/admin/publish", "POST", { versions: { home: out.version } });
    const page = await (await call(LOCAL_PUBLIC + "/", {}, LOCAL_ENV)).text();
    expect(page).not.toContain("javascript:");
  });

  it("refuses a stale version, so two tabs can't overwrite each other", async () => {
    const tabA = await loadDraft("home"), tabB = await loadDraft("home");
    el(tabA.draft, "ehero01ttl").text = "From tab A";
    expect((await api("/api/admin/drafts/home", "PUT", { version: tabA.version, doc: tabA.draft })).status).toBe(200);
    el(tabB.draft, "ehero01ttl").text = "From tab B";
    const res = await api("/api/admin/drafts/home", "PUT", { version: tabB.version, doc: tabB.draft });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Someone else changed this page.", version: 2 });
    expect(el((await loadDraft("home")).draft, "ehero01ttl").text).toBe("From tab A");
  });

  it("refuses a page that isn't v5, and settings or data that aren't objects", async () => {
    const { draft, version } = await loadDraft("about");
    for (const doc of [{ ...draft, v: 4 }, { id: "about", title: "x", sections: [] }, [], "x", null]) {
      const res = await api("/api/admin/drafts/about", "PUT", { version, doc });
      expect(res.status, JSON.stringify(doc).slice(0, 40)).toBe(400);
    }
    for (const doc of [[], "x", null, 5]) expect((await api("/api/admin/drafts/settings", "PUT", { version: 1, doc })).status).toBe(400);
    expect((await loadDraft("about")).version).toBe(1);
  });

  it("refuses bad requests", async () => {
    const { draft, version } = await loadDraft("faq");
    expect((await api("/api/admin/drafts/nope", "PUT", { version, doc: draft })).status).toBe(404);
    expect((await api("/api/admin/drafts/faq", "PUT", { doc: draft })).status).toBe(400);
    expect((await api("/api/admin/drafts/faq", "PUT", { version: "1", doc: draft })).status).toBe(400);
    const notJson = await call(LOCAL_ADMIN + "/api/admin/drafts/faq", { ...fromEditor("PUT"), body: "{nope", headers: { ...fromEditor("PUT").headers, "Content-Type": "application/json" } }, LOCAL_ENV);
    expect(notJson.status).toBe(400);
    const wrongType = await call(LOCAL_ADMIN + "/api/admin/drafts/faq", { ...fromEditor("PUT"), body: JSON.stringify({ version, doc: draft }), headers: { ...fromEditor("PUT").headers, "Content-Type": "text/plain" } }, LOCAL_ENV);
    expect(wrongType.status).toBe(415);
    const huge = await api("/api/admin/drafts/faq", "PUT", { version, doc: { ...draft, pad: "x".repeat(260 * 1024) } });
    expect(huge.status).toBe(413);
    expect((await api("/api/admin/drafts/faq", "POST", { version, doc: draft })).status).toBe(405);
  });

  it("refuses a save from another Origin, and on the public host", async () => {
    const { draft, version } = await loadDraft("faq");
    const evil = await call(LOCAL_ADMIN + "/api/admin/drafts/faq", {
      method: "PUT", body: JSON.stringify({ version, doc: draft }), headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    }, LOCAL_ENV);
    expect(evil.status).toBe(403);
    const pub = await call(LOCAL_PUBLIC + "/api/admin/drafts/faq", fromEditor("PUT", { version, doc: draft }, LOCAL_PUBLIC), LOCAL_ENV);
    expect(pub.status).toBe(404);
    expect((await loadDraft("faq")).version).toBe(1);
  });
});

describe("POST /api/admin/publish", () => {
  it("copies drafts to published in one go", async () => {
    const home = await loadDraft("home"), settings = await loadDraft("settings");
    el(home.draft, "ehero01ttl").text = "New home title";
    settings.draft.contactEmail = "board@scu.edu";
    const h = await (await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft })).json();
    const s = await (await api("/api/admin/drafts/settings", "PUT", { version: settings.version, doc: settings.draft })).json();
    const res = await api("/api/admin/publish", "POST", { versions: { home: h.version, settings: s.version } });
    expect(res.status).toBe(200);
    expect((await res.json()).published).toEqual(["home", "settings"]);
    expect(el(await published("home"), "ehero01ttl").text).toBe("New home title");
    expect((await published("settings")).contactEmail).toBe("board@scu.edu");
    const row = await env.DB.prepare("SELECT updated_by FROM published WHERE id = 'home'").first();
    expect(row.updated_by).toBe("local");
  });

  it("publishes nothing if any draft is stale", async () => {
    const home = await loadDraft("home"), faq = await loadDraft("faq");
    el(home.draft, "ehero01ttl").text = "Should not go live";
    const h = await (await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft })).json();
    const res = await api("/api/admin/publish", "POST", { versions: { home: h.version, faq: faq.version + 5 } });
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toEqual({ faq: 1 });
    expect(el(await published("home"), "ehero01ttl").text).not.toBe("Should not go live");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM publish_guard").first()).n).toBe(0);
  });

  it("refuses bad requests", async () => {
    expect((await api("/api/admin/publish", "POST", {})).status).toBe(400);
    expect((await api("/api/admin/publish", "POST", { versions: {} })).status).toBe(400);
    expect((await api("/api/admin/publish", "POST", { versions: { nope: 1 } })).status).toBe(404);
    expect((await api("/api/admin/publish", "POST", { versions: { home: 0 } })).status).toBe(400);
    expect((await api("/api/admin/publish", "GET")).status).toBe(405);
  });
});

describe("POST /api/admin/discard", () => {
  it("resets every listed draft to its published doc", async () => {
    const events = await loadDraft("events"), data = await loadDraft("data");
    el(events.draft, "ephev01ttl").text = "Throwaway";
    data.draft.members = [];
    const e = await (await api("/api/admin/drafts/events", "PUT", { version: events.version, doc: events.draft })).json();
    const d = await (await api("/api/admin/drafts/data", "PUT", { version: data.version, doc: data.draft })).json();
    const res = await api("/api/admin/discard", "POST", { versions: { events: e.version, data: d.version } });
    expect(res.status).toBe(200);
    const { docs } = await res.json();
    expect(docs.events.version).toBe(e.version + 1);
    expect(docs.events.draft).toEqual(await published("events"));
    expect(docs.data.draft.members.length).toBe(5);
  });

  it("discards nothing if any version is stale", async () => {
    const events = await loadDraft("events");
    el(events.draft, "ephev01ttl").text = "Keep me";
    const e = await (await api("/api/admin/drafts/events", "PUT", { version: events.version, doc: events.draft })).json();
    const res = await api("/api/admin/discard", "POST", { versions: { events: e.version, faq: 9 } });
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toEqual({ faq: 1 });
    expect(el((await loadDraft("events")).draft, "ephev01ttl").text).toBe("Keep me");
  });

  it("refuses bad requests", async () => {
    expect((await api("/api/admin/discard", "POST", {})).status).toBe(400);
    expect((await api("/api/admin/discard", "POST", { versions: { nope: 1 } })).status).toBe(404);
    expect((await api("/api/admin/discard", "POST", { versions: { events: "1" } })).status).toBe(400);
    expect((await api("/api/admin/discard/events", "POST", { version: 1 })).status).toBe(404);
  });
});

describe("photos", () => {
  it("uploads a PNG and serves it on both hosts", async () => {
    const res = await upload(PNG, "image/png");
    expect(res.status).toBe(201);
    const photo = await res.json();
    expect(photo).toMatchObject({ contentType: "image/png", size: PNG.length, width: 1, height: 1 });
    expect(photo.id).toMatch(/^[a-f0-9]{32}$/);
    expect(photo.src).toBe("/photos/" + photo.id);
    for (const base of [LOCAL_PUBLIC, LOCAL_ADMIN]) {
      const got = await call(base + photo.src, {}, LOCAL_ENV);
      expect(got.status, base).toBe(200);
      expect(got.headers.get("Content-Type")).toBe("image/png");
      expect(got.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
    }
    const list = await (await api("/api/admin/photos")).json();
    expect(list.photos.map((p) => p.id)).toContain(photo.id);
  });

  it("refuses anything that isn't really a PNG, JPEG, WebP or GIF", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await upload(svg, "image/svg+xml")).status).toBe(415);
    expect((await upload(svg, "image/png")).status).toBe(415);
    expect((await upload(new TextEncoder().encode("<html><script>alert(1)</script>"), "image/gif")).status).toBe(415);
    expect((await upload(PNG, "image/jpeg")).status).toBe(415);
    expect((await upload(PNG, "text/html")).status).toBe(415);
    expect((await upload(new Uint8Array(0), "image/png")).status).toBe(400);
  });

  it("refuses photos over 10 MB", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(big, "image/png")).status).toBe(413);
  });

  it("refuses an upload from another Origin", async () => {
    const res = await call(LOCAL_ADMIN + "/api/admin/photos", { method: "POST", body: PNG, headers: { "Content-Type": "image/png", Origin: "https://evil.example" } }, LOCAL_ENV);
    expect(res.status).toBe(403);
  });

  it("404s for unknown or malformed ids", async () => {
    expect((await call(LOCAL_PUBLIC + "/photos/" + "0".repeat(32), {}, LOCAL_ENV)).status).toBe(404);
    expect((await call(LOCAL_PUBLIC + "/photos/../wrangler.jsonc", {}, LOCAL_ENV)).status).toBe(404);
    expect((await call(LOCAL_PUBLIC + "/photos/abc", {}, LOCAL_ENV)).status).toBe(404);
  });
});

describe("sign-ups", () => {
  /* Each call comes from its own IP address unless a test says otherwise, so the rate limit doesn't mix tests up. */
  let nextIp = 1;
  const signup = (body, { base = LOCAL_PUBLIC, origin = base, envOver = LOCAL_ENV, type = "application/json", ip = "10.1." + Math.floor(nextIp / 250) + "." + (nextIp++ % 250) } = {}) =>
    call(base + "/api/signup", { method: "POST", headers: { "Content-Type": type, "CF-Connecting-IP": ip, ...(origin ? { Origin: origin } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }, envOver);
  const rows = async () => (await env.DB.prepare("SELECT email, list FROM signups ORDER BY id").all()).results;

  it("stores the email (lowercased) and list in local mode, without Turnstile", async () => {
    const res = await signup({ email: "  Student@SCU.edu ", list: "weekly" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows()).toEqual([{ email: "student@scu.edu", list: "weekly" }]);
  });

  it("looks the same the second time, and stores one row", async () => {
    const a = await signup({ email: "a@scu.edu", list: "biohackathon" });
    const b = await signup({ email: "A@scu.edu", list: "biohackathon" });
    expect(await a.text()).toBe(await b.text());
    expect(await rows()).toHaveLength(1);
  });

  it("refuses bad sign-ups", async () => {
    expect((await signup({ email: "nope", list: "weekly" })).status).toBe(400);
    expect((await signup({ email: "a@scu.edu", list: "secret-list" })).status).toBe(400);
    expect((await signup({ email: "a@scu.edu" })).status).toBe(400);
    expect((await signup("{bad")).status).toBe(400);
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, { type: "text/plain" })).status).toBe(415);
    expect((await signup({ email: "a@scu.edu", list: "weekly", pad: "x".repeat(5000) })).status).toBe(413);
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, { origin: null })).status).toBe(403);
    expect((await call(LOCAL_PUBLIC + "/api/signup", {}, LOCAL_ENV)).status).toBe(405);
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, { base: LOCAL_ADMIN })).status).toBe(404);
    expect(await rows()).toEqual([]);
  });

  it("accepts only the two lists the forms offer", async () => {
    for (const list of ["weekly", "biohackathon"]) expect((await signup({ email: "a@scu.edu", list })).status, list).toBe(200);
    for (const list of ["Weekly", "newlist", "", "weekly "]) expect((await signup({ email: "b@scu.edu", list })).status, list).toBe(400);
    expect(await rows()).toHaveLength(2);
  });

  it("needs Turnstile on the real hostname, even with LOCAL_MODE set", async () => {
    const opts = { base: PROD_PUBLIC, envOver: PROD_ENV };
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, opts)).status).toBe(403);
    expect((await signup({ email: "a@scu.edu", list: "weekly", token: "t" }, { ...opts, envOver: { ...PROD_ENV, TURNSTILE_SECRET: "" } })).status).toBe(503);
    await stubNetwork({ turnstile: { success: false } });
    expect((await signup({ email: "a@scu.edu", list: "weekly", token: "t" }, { ...opts, envOver: { ...PROD_ENV, ...LOCAL_ENV } })).status).toBe(403);
    expect(await rows()).toEqual([]);
    vi.restoreAllMocks();
    await stubNetwork({ turnstile: { success: true, hostname: "scuclip.com" } });
    expect((await signup({ email: "a@scu.edu", list: "weekly", token: "t" }, opts)).status).toBe(200);
    expect(await rows()).toEqual([{ email: "a@scu.edu", list: "weekly" }]);
  });

  it("allows at most 5 sign-ups a minute from one IP address", async () => {
    const ip = "203.0.113." + (Date.now() % 200);
    for (let i = 0; i < 5; i++) expect((await signup({ email: `n${i}@scu.edu`, list: "weekly" }, { ip })).status, String(i)).toBe(200);
    const sixth = await signup({ email: "n5@scu.edu", list: "weekly" }, { ip });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBe("60");
    expect((await signup({ email: "other@scu.edu", list: "weekly" })).status).toBe(200);
    expect(await rows()).toHaveLength(6);
  });

  it("refuses sign-ups when the rate limit isn't set up", async () => {
    expect((await signup({ email: "a@scu.edu", list: "weekly" }, { envOver: { ...LOCAL_ENV, SIGNUP_LIMITER: undefined } })).status).toBe(503);
    expect(await rows()).toEqual([]);
  });

  it("downloads a list as CSV, with formulas kept as text", async () => {
    await signup({ email: "a@scu.edu", list: "weekly" });
    await signup({ email: "=cmd@scu.edu", list: "weekly" });
    await signup({ email: "b@scu.edu", list: "biohackathon" });
    const res = await api("/api/admin/signups/weekly/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="clip-weekly-signups.csv"');
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("email,signed_up");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(["a@scu.edu", "'=cmd@scu.edu"]);
    expect((await api("/api/admin/signups/secret/csv")).status).toBe(404);
    expect((await call(LOCAL_PUBLIC + "/api/admin/signups/weekly/csv", fromEditor("GET", undefined, LOCAL_PUBLIC), LOCAL_ENV)).status).toBe(404);
  });

  it("lists sign-ups in the editor and deletes them", async () => {
    await signup({ email: "a@scu.edu", list: "weekly" });
    await signup({ email: "b@scu.edu", list: "biohackathon" });
    const { signups } = await (await api("/api/admin/signups")).json();
    expect(signups.map((s) => [s.list, s.email])).toEqual([["biohackathon", "b@scu.edu"], ["weekly", "a@scu.edu"]]);
    expect((await api("/api/admin/signups/" + signups[0].id, "DELETE")).status).toBe(200);
    expect((await api("/api/admin/signups/" + signups[0].id, "DELETE")).status).toBe(404);
    expect((await api("/api/admin/signups/x", "DELETE")).status).toBe(404);
    expect(await rows()).toEqual([{ email: "a@scu.edu", list: "weekly" }]);
    expect((await call(LOCAL_PUBLIC + "/api/admin/signups", fromEditor("GET", undefined, LOCAL_PUBLIC), LOCAL_ENV)).status).toBe(404);
  });
});

describe("audit log", () => {
  const log = async () => (await env.DB.prepare("SELECT actor, action, target FROM audit_log ORDER BY id").all()).results;

  it("records publish, discard, photo uploads, and sign-up deletes and downloads, without emails", async () => {
    const home = await loadDraft("home");
    home.draft.sections[0].elements[0].text = "Audited";
    const saved = await (await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft })).json();
    expect(await log()).toEqual([]);
    await api("/api/admin/publish", "POST", { versions: { home: saved.version } });
    const about = await loadDraft("about");
    about.draft.sections[0].elements[0].text = "Thrown away";
    const a = await (await api("/api/admin/drafts/about", "PUT", { version: about.version, doc: about.draft })).json();
    await api("/api/admin/discard", "POST", { versions: { about: a.version } });
    const photo = await (await upload(PNG, "image/png")).json();
    await call(LOCAL_PUBLIC + "/api/signup", { method: "POST", headers: { "Content-Type": "application/json", Origin: LOCAL_PUBLIC, "CF-Connecting-IP": "10.9.9.9" }, body: JSON.stringify({ email: "gone@scu.edu", list: "weekly" }) }, LOCAL_ENV);
    const { signups } = await (await api("/api/admin/signups")).json();
    await api("/api/admin/signups/weekly/csv");
    await api("/api/admin/signups/" + signups[0].id, "DELETE");
    expect(await log()).toEqual([
      { actor: "local", action: "publish", target: "home" },
      { actor: "local", action: "discard", target: "about" },
      { actor: "local", action: "photo.upload", target: photo.id },
      { actor: "local", action: "signup.export", target: "weekly" },
      { actor: "local", action: "signup.delete", target: "signup:" + signups[0].id },
    ]);
    expect(JSON.stringify(await log())).not.toContain("gone@scu.edu");
  });

  it("records nothing when a publish or discard is refused", async () => {
    expect((await api("/api/admin/publish", "POST", { versions: { home: 9 } })).status).toBe(409);
    expect((await api("/api/admin/discard", "POST", { versions: { home: 9 } })).status).toBe(409);
    expect(await log()).toEqual([]);
  });
});
