/* The editor host (admin.scuclip.com, or admin.localhost in local mode).

   Every request goes through gate() before any route runs:
   1. API calls (/api/admin/*) must come from the editor itself: a Sec-Fetch-Site header, when the browser sends
      one, must say same-origin.
   2. Anything that can change data (every method except GET and HEAD) must carry an Origin header equal to the
      editor's own origin. Other websites open in the same browser can't change anything.
   3. Sign-in: Cloudflare Access, checked by verifyAccess(). Skipped only in local mode (see hosts.js). */

import { apiError, json, text, methodNotAllowed, readText, readBytes } from "./http.js";
import { verifyAccess } from "./access.js";
import { isAssetPath, serveAsset } from "./assets.js";
import { getAllDocs, getDoc, saveDraft, publishDrafts, discardDrafts, audit } from "./db.js";
import { storePhoto, listPhotos, servePhoto, MAX_PHOTO_BYTES } from "./photos.js";
import { norm, isPageDoc, DOC_IDS, VIEW_IDS, LIST_SIGNUP } from "../public/shared/model.js";
import { signupsCsv } from "../public/shared/csv.js";
import { sheetsConfigured, syncSignups, removeFromSheet, waitingCount } from "./sheets.js";

const SAFE = new Set(["GET", "HEAD"]);
/* A draft request, and the doc stored from it, are at most 256 KB. */
export const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 16 * 1024;

/** @returns {Promise<{res: Response} | {editor: {email: string, local: boolean}}>} */
export async function gate(request, env, site, url) {
  const path = url.pathname;
  const isApi = path.startsWith("/api/");
  const deny = (status, msg) => ({ res: isApi ? apiError(status, msg) : text(msg, status) });

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (isApi && fetchSite && fetchSite !== "same-origin") return deny(403, "Editor requests must come from the editor itself.");
  if (!SAFE.has(request.method)) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== url.origin) return deny(403, "This change didn't come from the editor, so it was refused.");
  }
  if (site.local) return { editor: { email: "local", local: true } };
  const who = await verifyAccess(request, env);
  if (!who.ok) return deny(who.status, who.message);
  return { editor: { email: who.email, local: false } };
}

/* ---------- Helpers ---------- */
const isJson = (request) => /^application\/json\b/i.test(request.headers.get("Content-Type") || "");

/** Read a JSON object body. Returns {body} or {res} with the refusal. */
async function readJson(request, limit) {
  if (!isJson(request)) return { res: apiError(415, "Send JSON (Content-Type: application/json).") };
  const raw = await readText(request, limit);
  if (raw === null) return { res: apiError(413, "That request is too large.") };
  let body;
  try { body = JSON.parse(raw); } catch { return { res: apiError(400, "That request isn't valid JSON.") }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { res: apiError(400, "That request must be a JSON object.") };
  return { body };
}
const isVersion = (v) => Number.isInteger(v) && v >= 1;
const knownDoc = (id) => DOC_IDS.includes(id);
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Check a versions map ({ [docId]: version }) from a publish or discard. Returns a refusal, or null. */
function badVersions(versions, what) {
  if (!isObject(versions) || !Object.keys(versions).length) return apiError(400, `Say which pages to ${what}.`);
  for (const [id, v] of Object.entries(versions)) {
    if (!knownDoc(id)) return apiError(404, `There's no page called "${id}".`);
    if (!isVersion(v)) return apiError(400, `Send the version of each page you're going to ${what}.`);
  }
  return null;
}

/* ---------- Routes ---------- */
const ROUTES = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  ROUTES.push({ method, re, keys, handler });
}

route("GET", "/api/admin/session", (c) => json({
  email: c.editor.email,
  local: c.editor.local,
  publicOrigin: c.site.publicOrigin,
  adminOrigin: c.site.adminOrigin,
}));

route("GET", "/api/admin/docs", async (c) => json({ docs: await getAllDocs(c.env) }));

route("GET", "/api/admin/drafts/:id", async (c) => {
  const doc = knownDoc(c.params.id) ? await getDoc(c.env, c.params.id) : null;
  return doc ? json(doc) : apiError(404, "There's no such page.");
});

route("PUT", "/api/admin/drafts/:id", async (c) => {
  const { id } = c.params;
  if (!knownDoc(id)) return apiError(404, "There's no such page.");
  const r = await readJson(c.request, MAX_DRAFT_BYTES);
  if (r.res) return r.res;
  const { version, doc } = r.body;
  if (!isVersion(version)) return apiError(400, "Send the version you loaded.");
  /* Like the prototype: norm() repairs the doc, and what it returns is stored. Only a page that isn't in the
     current format (v: 5), or a data or settings doc that isn't an object, is refused. */
  if (VIEW_IDS.includes(id) ? !isPageDoc(doc) : !isObject(doc)) return apiError(400, "This page is in an old format, so it can't be saved. Reload the editor.");
  const clean = norm(id, doc);
  if (JSON.stringify(clean).length > MAX_DRAFT_BYTES) return apiError(413, "This page is too large to save.");
  const saved = await saveDraft(c.env, id, version, clean, c.editor.email);
  if (saved.ok) return json({ version: saved.version, doc: clean });
  if (saved.current === null) return apiError(404, "There's no such page.");
  return apiError(409, "Someone else changed this page.", { version: saved.current });
});

route("POST", "/api/admin/publish", async (c) => {
  const r = await readJson(c.request, MAX_JSON_BYTES);
  if (r.res) return r.res;
  const versions = r.body.versions;
  const bad = badVersions(versions, "publish");
  if (bad) return bad;
  const out = await publishDrafts(c.env, versions, c.editor.email);
  if (out.ok) return json({ published: Object.keys(versions), at: out.at });
  return apiError(409, "Someone else changed a page you're publishing, so nothing was published.", { stale: out.stale });
});

/* Discard: the listed drafts go back to their published docs, all at once or not at all. */
route("POST", "/api/admin/discard", async (c) => {
  const r = await readJson(c.request, MAX_JSON_BYTES);
  if (r.res) return r.res;
  const versions = r.body.versions;
  const bad = badVersions(versions, "discard");
  if (bad) return bad;
  const out = await discardDrafts(c.env, versions, c.editor.email);
  if (!out.ok) return apiError(409, "Someone else changed a page you're discarding, so nothing was discarded.", { stale: out.stale });
  const docs = {};
  for (const id of Object.keys(versions)) docs[id] = await getDoc(c.env, id);
  return json({ docs });
});

route("GET", "/api/admin/photos", async (c) => json({ photos: await listPhotos(c.env) }));

route("POST", "/api/admin/photos", async (c) => {
  const bytes = await readBytes(c.request, MAX_PHOTO_BYTES);
  if (bytes === null) return apiError(413, "Photos can be at most 10 MB.");
  const out = await storePhoto(c.env, bytes, c.request.headers.get("Content-Type"), c.editor.email);
  if (!out.ok) return apiError(out.status, out.message);
  await audit(c.env, c.editor.email, "photo.upload", out.photo.id);
  return json(out.photo, 201);
});

const signupRows = async (env, list) => {
  const { results } = list
    ? await env.DB.prepare("SELECT id, email, list, created_at, sheet_synced_at FROM signups WHERE list = ? ORDER BY created_at, id").bind(list).all()
    : await env.DB.prepare("SELECT id, email, list, created_at, sheet_synced_at FROM signups ORDER BY list, created_at, id").all();
  return results.map((r) => ({ id: r.id, email: r.email, list: r.list, createdAt: r.created_at, inSheet: !!r.sheet_synced_at }));
};

/* The sign-ups, and whether the Google Sheet is connected (src/sheets.js). */
route("GET", "/api/admin/signups", async (c) => json({
  signups: await signupRows(c.env),
  sheet: { connected: sheetsConfigured(c.env), waiting: await waitingCount(c.env) },
}));

/* Send the sign-ups the Google Sheet doesn't have yet, now (the cron trigger also does it every 15 minutes). */
route("POST", "/api/admin/signups/sync", async (c) => {
  if (!sheetsConfigured(c.env)) return apiError(503, "The Google Sheet isn't connected yet (docs/NEWSLETTER.md).");
  const out = await syncSignups(c.env);
  if (out.error) return apiError(502, "The Google Sheet didn't take the sign-ups. Try again in a few minutes.", { waiting: await waitingCount(c.env) });
  return json({ sent: out.sent, waiting: await waitingCount(c.env) });
});

/* One list as a spreadsheet file. Every download goes in the audit log. */
route("GET", "/api/admin/signups/:list/csv", async (c) => {
  const { list } = c.params;
  if (!LIST_SIGNUP.options.some((o) => o.v === list)) return apiError(404, "There's no such list.");
  const rows = await signupRows(c.env, list);
  await audit(c.env, c.editor.email, "signup.export", list);
  return new Response(signupsCsv(rows), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clip-${list}-signups.csv"`,
  } });
});

/* Takes someone off a list (they asked by email). The audit log records the row id, not the email. */
route("DELETE", "/api/admin/signups/:id", async (c) => {
  const id = Number(c.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return apiError(404, "There's no such sign-up.");
  const row = await c.env.DB.prepare("DELETE FROM signups WHERE id = ? RETURNING email, list, sheet_synced_at").bind(id).first();
  if (!row) return apiError(404, "There's no such sign-up.");
  await audit(c.env, c.editor.email, "signup.delete", "signup:" + id);
  /* Take it off the Google Sheet too, if it got there. */
  const sheet = row.sheet_synced_at ? await removeFromSheet(c.env, row.list, row.email) : "not there";
  return json({ ok: true, sheet });
});

export async function handleAdmin(request, env, ctx, site, url) {
  const path = url.pathname;
  const g = await gate(request, env, site, url);
  if (g.res) return g.res;
  const c = { request, env, ctx, site, url, editor: g.editor, params: {} };

  if (path === "/" || path === "/index.html") {
    if (!SAFE.has(request.method)) return methodNotAllowed("GET, HEAD");
    return serveAsset(env, request, "/editor/index.html");
  }
  if (isAssetPath(path, "admin")) {
    if (!SAFE.has(request.method)) return methodNotAllowed("GET, HEAD");
    return serveAsset(env, request, path);
  }
  if (path.startsWith("/photos/")) {
    if (!SAFE.has(request.method)) return methodNotAllowed("GET, HEAD");
    return servePhoto(env, request, path.slice(8));
  }

  const allowed = [];
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (r.method !== method) { allowed.push(r.method); continue; }
    try {
      r.keys.forEach((k, i) => { c.params[k] = decodeURIComponent(m[i + 1]); });
    } catch {
      return apiError(404, "Not found");
    }
    return r.handler(c);
  }
  if (allowed.length) return methodNotAllowed(allowed.join(", "));
  return path.startsWith("/api/") ? apiError(404, "Not found") : text("Not found", 404);
}
