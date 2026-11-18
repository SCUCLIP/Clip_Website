/* Every API route, and every refusal in CLAUDE.md security rule 12. */
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { call, fromEditor, stubNetwork, LOCAL_ADMIN, LOCAL_PUBLIC, PROD_PUBLIC, LOCAL_ENV, PROD_ENV } from "./helpers.js";

const api = (path, method = "GET", body, headers) => call(LOCAL_ADMIN + path, fromEditor(method, body, LOCAL_ADMIN, headers), LOCAL_ENV);
const loadDraft = async (id) => (await (await api("/api/admin/drafts/" + id)).json());
const published = async (id) => JSON.parse((await env.DB.prepare("SELECT body FROM published WHERE id = ?").bind(id).first()).body);

/* A 1x1 PNG. */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const upload = (bytes, type) => call(LOCAL_ADMIN + "/api/admin/photos", fromEditor("POST", bytes, LOCAL_ADMIN, { "Content-Type": type }), LOCAL_ENV);

describe("GET /api/admin/docs and /drafts/:id", () => {
  it("returns every doc with its draft, version and published copy", async () => {
    const res = await api("/api/admin/docs");
    expect(res.status).toBe(200);
    const { docs } = await res.json();
    expect(Object.keys(docs).sort()).toEqual(["about", "biohackathon", "board", "events", "faq", "home", "resources", "site", "speakers"]);
    expect(docs.home).toMatchObject({ version: 1, draftUpdatedBy: "seed", publishedBy: "seed" });
    expect(docs.home.draft).toEqual(docs.home.published);
  });

  it("returns one doc, and 404 for anything else", async () => {
    expect((await loadDraft("faq")).draft.id).toBe("faq");
    expect((await api("/api/admin/drafts/admin")).status).toBe(404);
    expect((await api("/api/admin/drafts/%E0%A4%A")).status).toBe(404);
  });
});

describe("PUT /api/admin/drafts/:id", () => {
  it("validates with norm(), saves and bumps the version", async () => {
    const { draft, version } = await loadDraft("about");
    draft.title = "About CLIP";
    draft.junk = "dropped";
    const res = await api("/api/admin/drafts/about", "PUT", { version, doc: draft });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version).toBe(version + 1);
    expect(out.doc.title).toBe("About CLIP");
    expect(out.doc.junk).toBeUndefined();
    const row = await env.DB.prepare("SELECT version, updated_by FROM drafts WHERE id = 'about'").first();
    expect(row).toEqual({ version: 2, updated_by: "local" });
    expect((await published("about")).title).not.toBe("About CLIP");
  });

  it("refuses a stale version, so two tabs can't overwrite each other", async () => {
    const tabA = await loadDraft("home"), tabB = await loadDraft("home");
    tabA.draft.title = "From tab A";
    expect((await api("/api/admin/drafts/home", "PUT", { version: tabA.version, doc: tabA.draft })).status).toBe(200);
    tabB.draft.title = "From tab B";
    const res = await api("/api/admin/drafts/home", "PUT", { version: tabB.version, doc: tabB.draft });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Someone else changed this page.", version: 2 });
    expect((await loadDraft("home")).draft.title).toBe("From tab A");
  });

  it("refuses content norm() rejects", async () => {
    const { draft, version } = await loadDraft("home");
    draft.sections[0].els[3].href = "javascript:alert(document.cookie)";
    const res = await api("/api/admin/drafts/home", "PUT", { version, doc: draft });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/can't be saved: sections\[0\]\.els\[3\]\.href/);
    expect((await loadDraft("home")).version).toBe(1);
  });

  it("escapes script in rich text instead of storing it", async () => {
    const { draft, version } = await loadDraft("home");
    draft.sections[0].els[1].text = 'Hi <img src=x onerror=alert(1)><b>bold</b>';
    const out = await (await api("/api/admin/drafts/home", "PUT", { version, doc: draft })).json();
    expect(out.doc.sections[0].els[1].text).toBe("Hi &lt;img src=x onerror=alert(1)&gt;<b>bold</b>");
  });

  it("refuses bad requests", async () => {
    const { draft, version } = await loadDraft("faq");
    expect((await api("/api/admin/drafts/nope", "PUT", { version, doc: draft })).status).toBe(404);
    expect((await api("/api/admin/drafts/faq", "PUT", { doc: draft })).status).toBe(400);
    expect((await api("/api/admin/drafts/faq", "PUT", { version: "1", doc: draft })).status).toBe(400);
    expect((await api("/api/admin/drafts/faq", "PUT", { version, doc: "x" })).status).toBe(400);
    const notJson = await call(LOCAL_ADMIN + "/api/admin/drafts/faq", { ...fromEditor("PUT"), body: "{nope", headers: { ...fromEditor("PUT").headers, "Content-Type": "application/json" } }, LOCAL_ENV);
    expect(notJson.status).toBe(400);
    const wrongType = await call(LOCAL_ADMIN + "/api/admin/drafts/faq", { ...fromEditor("PUT"), body: JSON.stringify({ version, doc: draft }), headers: { ...fromEditor("PUT").headers, "Content-Type": "text/plain" } }, LOCAL_ENV);
    expect(wrongType.status).toBe(415);
    const huge = await api("/api/admin/drafts/faq", "PUT", { version, doc: { ...draft, title: "x".repeat(600 * 1024) } });
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
    const home = await loadDraft("home"), site = await loadDraft("site");
    home.draft.title = "New home title";
    site.draft.email = "board@scu.edu";
    const h = await (await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft })).json();
    const s = await (await api("/api/admin/drafts/site", "PUT", { version: site.version, doc: site.draft })).json();
    const res = await api("/api/admin/publish", "POST", { versions: { home: h.version, site: s.version } });
    expect(res.status).toBe(200);
    expect((await res.json()).published).toEqual(["home", "site"]);
    expect((await published("home")).title).toBe("New home title");
    expect((await published("site")).email).toBe("board@scu.edu");
    const row = await env.DB.prepare("SELECT updated_by FROM published WHERE id = 'home'").first();
    expect(row.updated_by).toBe("local");
  });

  it("publishes nothing if any draft is stale", async () => {
    const home = await loadDraft("home"), faq = await loadDraft("faq");
    home.draft.title = "Should not go live";
    const h = await (await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft })).json();
    const res = await api("/api/admin/publish", "POST", { versions: { home: h.version, faq: faq.version + 5 } });
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toEqual({ faq: 1 });
    expect((await published("home")).title).not.toBe("Should not go live");
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

describe("POST /api/admin/discard/:id", () => {
  it("resets the draft to the published doc", async () => {
    const { draft, version } = await loadDraft("events");
    draft.title = "Throwaway";
    const saved = await (await api("/api/admin/drafts/events", "PUT", { version, doc: draft })).json();
    const res = await api("/api/admin/discard/events", "POST", { version: saved.version });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.version).toBe(saved.version + 1);
    expect(out.doc).toEqual(await published("events"));
  });

  it("refuses a stale version and unknown pages", async () => {
    expect((await api("/api/admin/discard/events", "POST", { version: 9 })).status).toBe(409);
    expect((await api("/api/admin/discard/nope", "POST", { version: 1 })).status).toBe(404);
    expect((await api("/api/admin/discard/events", "POST", {})).status).toBe(400);
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

  it("refuses photos over 5 MB", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
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
  const signup = (body, { base = LOCAL_PUBLIC, origin = base, envOver = LOCAL_ENV, type = "application/json" } = {}) =>
    call(base + "/api/signup", { method: "POST", headers: { "Content-Type": type, ...(origin ? { Origin: origin } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }, envOver);
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

  it("accepts only lists used in published content", async () => {
    const home = await loadDraft("home");
    home.draft.sections[4].els[0].list = "newlist";
    await api("/api/admin/drafts/home", "PUT", { version: home.version, doc: home.draft });
    expect((await signup({ email: "a@scu.edu", list: "newlist" })).status).toBe(400);
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
