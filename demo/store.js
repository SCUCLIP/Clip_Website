/* The demo's "server": the site's drafts, published docs, sign-ups and photos, kept in this browser's localStorage.
   Each visitor starts from the seed content and sees only their own changes. Nothing is sent anywhere.
   Used by the demo editor (demo/api.js, in place of editor/api.js) and the demo pages (demo/site.js). */

import { DOC_IDS, norm, canon, isPageDoc, VIEW_IDS, LIST_SIGNUP } from "../shared/model.js";
import { SEED } from "./seed.js";

const KEY = "clip-demo-v1";
const now = () => new Date().toISOString();
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function fresh() {
  const s = { v: 1, drafts: {}, published: {}, signups: [], photos: {}, nextSignup: 1 };
  for (const id of DOC_IDS) {
    const doc = norm(id, SEED[id]);
    s.drafts[id] = { doc, version: 1, at: SEED.at, by: "seed" };
    s.published[id] = { doc, at: SEED.at, by: "seed" };
  }
  return s;
}

let state = null;
/** The demo's state, from localStorage, or the seed when there's nothing saved yet. */
export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { s = null; }
  state = s && s.v === 1 && isObject(s.drafts) && isObject(s.published) ? s : fresh();
  return state;
}
/** True once this visitor has saved anything. */
export function hasLocal() {
  try { return !!localStorage.getItem(KEY); } catch (_) { return false; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (_) { const e = new Error("This browser's storage for the demo is full. Remove a photo, or reset the demo."); e.code = "too_large"; e.status = 413; throw e; }
}
export function reset() {
  try { localStorage.removeItem(KEY); } catch (_) { /* nothing saved */ }
  state = fresh();
}

const fail = (status, code, message, body) => Object.assign(new Error(message), { status, code, body });
const row = (id) => ({ draft: state.drafts[id].doc, version: state.drafts[id].version, published: state.published[id].doc,
  draftUpdatedAt: state.drafts[id].at, draftUpdatedBy: state.drafts[id].by, publishedAt: state.published[id].at, publishedBy: state.published[id].by });

/* ---------- What the Worker's API does, on that state ---------- */
export function docs() {
  load();
  const out = {};
  for (const id of DOC_IDS) out[id] = row(id);
  return { docs: out };
}
export function draft(id) {
  load();
  if (!DOC_IDS.includes(id)) throw fail(404, "not_found", "There's no such page.");
  return row(id);
}
export function saveDraft(id, version, doc) {
  load();
  if (!DOC_IDS.includes(id)) throw fail(404, "not_found", "There's no such page.");
  if (VIEW_IDS.includes(id) ? !isPageDoc(doc) : !isObject(doc)) throw fail(400, "invalid_argument", "This page is in an old format.");
  const d = state.drafts[id];
  if (d.version !== version) throw fail(409, "conflict", "Someone else changed this page.", { version: d.version });
  const clean = norm(id, doc);
  state.drafts[id] = { doc: clean, version: version + 1, at: now(), by: "demo" };
  save();
  return { version: version + 1, doc: clean };
}
function checkVersions(versions) {
  const stale = {};
  for (const [id, v] of Object.entries(versions || {})) {
    if (!DOC_IDS.includes(id)) throw fail(404, "not_found", `There's no page called "${id}".`);
    if (state.drafts[id].version !== v) stale[id] = state.drafts[id].version;
  }
  if (Object.keys(stale).length) throw fail(409, "conflict", "Someone else changed a page.", { stale });
}
export function publish(versions) {
  load();
  checkVersions(versions);
  const at = now();
  for (const id of Object.keys(versions)) state.published[id] = { doc: state.drafts[id].doc, at, by: "demo" };
  save();
  return { published: Object.keys(versions), at };
}
export function discard(versions) {
  load();
  checkVersions(versions);
  const at = now(), out = {};
  for (const id of Object.keys(versions)) {
    state.drafts[id] = { doc: state.published[id].doc, version: state.drafts[id].version + 1, at, by: "demo" };
    out[id] = row(id);
  }
  save();
  return { docs: out };
}

/* ---------- Photos, as data: URLs (the editor has already shrunk and re-encoded them) ---------- */
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
export async function uploadPhoto(blob) {
  load();
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw fail(415, "unsupported_type", "Photos must be PNG, JPEG, WebP or GIF.");
  if (blob.size > 10 * 1024 * 1024) throw fail(413, "too_large", "Photos can be at most 10 MB.");
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(fail(400, "error", "The photo couldn't be read."));
    r.readAsDataURL(blob);
  });
  const id = randomId();
  state.photos[id] = url;
  try { save(); } catch (e) { delete state.photos[id]; throw e; }
  return { id, src: url };
}
/** The address a photo id is shown from (the shared render asks for it through globalThis.clipDemoPhoto). */
export const photoUrl = (id) => ((state || load()).photos[id] || "");
globalThis.clipDemoPhoto = photoUrl;

/* ---------- Sign-ups ---------- */
const LISTS = LIST_SIGNUP.options.map((o) => o.v);
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
export function signups() {
  load();
  return { signups: state.signups.slice().sort((a, b) => a.list.localeCompare(b.list) || a.createdAt.localeCompare(b.createdAt)) };
}
export function signup(email, list) {
  load();
  email = String(email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw fail(400, "invalid_argument", "Enter an email address like you@scu.edu.");
  if (!LISTS.includes(list)) throw fail(400, "invalid_argument", "That sign-up list doesn't exist.");
  if (!state.signups.some((s) => s.email === email && s.list === list)) {
    state.signups.push({ id: state.nextSignup++, email, list, createdAt: now() });
    save();
  }
  return { ok: true };
}
export function deleteSignup(id) {
  load();
  const i = state.signups.findIndex((s) => String(s.id) === String(id));
  if (i < 0) throw fail(404, "not_found", "There's no such sign-up.");
  state.signups.splice(i, 1);
  save();
  return { ok: true };
}

/** The published docs, normalized, for rendering the demo pages. */
export function publishedDocs() {
  load();
  const C = {};
  for (const id of DOC_IDS) C[id] = norm(id, state.published[id].doc);
  return C;
}
/** True when this visitor has published something different from the seed. */
export function publishedChanged() {
  if (!hasLocal()) return false;
  load();
  return DOC_IDS.some((id) => canon(state.published[id].doc) !== canon(norm(id, SEED[id])));
}
