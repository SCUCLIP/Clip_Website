/* The page editor, on the admin host. Ported from the "Admin (#admin)" part of prototype/clip-website.html and kept
   as close to it as possible: select, drag, handles, snapping, typing in place, multi-select, copy and paste, one
   undo history for the whole site, the phone layout, the Add panel, sections, Settings and the Site tab.

   The prototype ran as a Claude artifact and read and wrote through window.claude. Here that's the Worker's API
   (api.js), and these parts are new:
   - openAdmin() and loadDocs(): drafts and published docs load from GET /api/admin/docs, and again when the window
     gets focus (the prototype had live updates).
   - flush(): each save sends the version it started from. A 409 means someone else saved first: their version is
     loaded, and Undo brings this one back (onConflict).
   - publish() and discardAll(): every changed doc at once, all or nothing.
   - Photos upload to /api/admin/photos. shrinkImage() re-encodes JPEGs always, which drops location data.
   - The Site tab's sign-ups can also be downloaded as CSV and deleted.
   In the browser console, window.clipEditor is the editor's state. */

import {
  CLUB_EMAIL, esc, str, arr, clone, uid, clamp, r1, canon, safeHref, BLOB_RE, blobSrc, getPath, setPath, DW, MW, PAGES,
  VIEW_IDS, DOC_IDS, pageLabel, pageNum, SYMS, ARROW_PATH, BG_OPTS, LISTS, LIST_ORDER, SETTINGS_FIELDS, listFields, EL,
  fieldsOf, hasText, elName, elSnippet, normElement, norm, usableDoc,
} from "../shared/model.js";
import { ICON, MASCOT, shellHTML, pageMain, boxStyle } from "../shared/render.js";
import { fitSite, layoutAll, measure, arrangePhone, appendPhone } from "../shared/layout.js";
import { SPRITE } from "../shared/sprite.js";
import { NEW_W, SYM_W, makeElement, SEC_PRESETS, ADD_GROUPS, ADD_SPECS } from "./catalog.js";
import * as api from "./api.js";

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const reduceMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const MAX_PHOTO = 10 * 1024 * 1024;

document.body.insertAdjacentHTML("afterbegin", SPRITE);
const admEl = $("#adm");

/* ================= Published content (the prototype's LIVE) ================= */
const LIVE = { docs: {}, C: {}, canon: {}, has: false, sig: "", state: "loading" };
function applyLive(docs) {
  LIVE.docs = {};
  Object.keys(docs).forEach((id) => { if (usableDoc(id, docs[id])) LIVE.docs[id] = docs[id]; });
  DOC_IDS.forEach((id) => { LIVE.C[id] = norm(id, LIVE.docs[id] || null); LIVE.canon[id] = canon(LIVE.C[id]); });
  LIVE.has = VIEW_IDS.some((id) => !!LIVE.docs[id]);
  LIVE.sig = DOC_IDS.map((id) => LIVE.canon[id]).join("|");
}
applyLive({});

/* ================= Admin (#admin): the page editor =================
   Works like a classic site builder: click to select, drag anything anywhere, handles to resize and rotate,
   double-click to type. Desktop and phone layouts are edited separately. Phone starts as a one-column
   version of desktop and can then be rearranged on its own. */
const A = {
  started: false, ok: false, db: null, assets: null, page: "home", device: "desktop", zoom: "fit", tab: "add",
  local: {}, exists: {}, dirty: {}, saving: {}, timers: {}, remote: {}, open: new Set(), stale: new Set(),
  loaded: false, loadSlow: false, saveError: null, publishing: false, flash: null, flashTimer: null, autoRetry: 0,
  signups: null, sel: null, item: null, undo: [], redo: [], histLock: null, cvTimer: null, cvReady: false,
  editEl: null, editing: null, pendingRender: false, armed: null, armTimer: null, z: 1, lay: null, clip: null,
  toastTimer: null, hover: null, ovRaf: 0,
  ver: {}, remoteVer: {}, session: null
};
DOC_IDS.forEach((id) => { A.local[id] = norm(id, null); A.exists[id] = false; A.dirty[id] = new Set(); A.saving[id] = null; });
const adminReady = () => A.ok && A.loaded && LIVE.state === "ready";
const busy = (id) => A.dirty[id].size > 0 || !!A.saving[id];
const changedIds = () => DOC_IDS.filter((id) => canon(A.local[id]) !== LIVE.canon[id]);
const urlBad = (v) => !!str(v).trim() && !safeHref(v);
const isPhone = () => A.device === "phone";
const MK = () => (isPhone() ? "m" : "d");
const HK = () => (isPhone() ? "mh" : "h");
const LW = () => (isPhone() ? MW : DW);
const FRAME_W = () => (isPhone() ? 390 : 1324);
const secs = () => A.local[A.page].sections;
const secById = (sid) => secs().find((s) => s.id === sid);
const secIndex = (sid) => secs().findIndex((s) => s.id === sid);
function findEl(eid) { for (const s of secs()) { const e = s.elements.find((x) => x.id === eid); if (e) return { s, e }; } return null; }
const selIds = () => (A.sel && A.sel.ids ? A.sel.ids : []);
function selEls() { const s = A.sel && A.sel.ids ? secById(A.sel.sid) : null; return s ? A.sel.ids.map((id) => s.elements.find((e) => e.id === id)).filter(Boolean) : []; }
const elNode = (sid, eid) => $(`#ce-site .fsec[data-sid="${sid}"] .el[data-eid="${eid}"]`);
const secNode = (sid) => $(`#ce-site .fsec[data-sid="${sid}"]`);

/* ---------- Refs: E.<section>.<element>.<path>, S.<section>.<path>, D.<path> (shared lists), G.<path> (settings) ---------- */
function target(ref) {
  const p = ref.split(".");
  if (p[0] === "D") return { doc: "data", obj: A.local.data, path: p.slice(1).join(".") };
  if (p[0] === "G") return { doc: "settings", obj: A.local.settings, path: p.slice(1).join(".") };
  const s = secById(p[1]);
  if (!s) return null;
  if (p[0] === "S") return { doc: A.page, obj: s, path: p.slice(2).join(".") };
  if (p[0] === "E") { const e = s.elements.find((x) => x.id === p[2]); return e ? { doc: A.page, obj: e, path: p.slice(3).join(".") } : null; }
  return null;
}
const getRef = (ref) => { const t = target(ref); return t ? getPath(t.obj, t.path) : undefined; };
function setRef(ref, v) {
  const t = target(ref);
  if (!t || !t.path) return null;
  if (!setPath(t.obj, t.path, v)) return null;
  return t.doc;
}
const docKey = (doc, ref) => (VIEW_IDS.includes(doc) ? "sections" : ref.split(".")[1]);
function listDef(listRef) {
  const p = listRef.split(".");
  if (p[0] === "D") return LISTS[p[1]] ? Object.assign({ t: "list" }, LISTS[p[1]]) : null;
  if (p[0] === "E" && p[3] === "items") { const t = target(`E.${p[1]}.${p[2]}`); const e = t && t.obj; return e && e.type === "list" ? listFields(e.src).find((f) => f.k === "items") || null : null; }
  return null;
}
const listAt = (listRef) => { const v = getRef(listRef); return Array.isArray(v) ? v : null; };
const itemIndex = (ref) => { const m = ref.match(/\.(\d+)$/); return m ? +m[1] : -1; };

/* ---------- History ---------- */
const snapshot = () => JSON.stringify(A.local);
function beginChange(lockKey) {
  if (lockKey && A.histLock === lockKey) return;
  A.histLock = lockKey || null;
  A.undo.push(snapshot());
  if (A.undo.length > 80) A.undo.shift();
  A.redo = [];
  refreshHistoryButtons();
}
function validateSel() {
  const s = A.sel;
  if (!s) return;
  const sec = secById(s.sid);
  if (!sec) { A.sel = null; A.item = null; return; }
  if (s.ids) { s.ids = s.ids.filter((id) => sec.elements.some((e) => e.id === id)); if (!s.ids.length) { A.sel = { sid: s.sid, sec: true }; A.item = null; } }
}
function restore(json) {
  const next = JSON.parse(json);
  DOC_IDS.forEach((id) => {
    const n = norm(id, next[id]);
    if (canon(n) !== canon(A.local[id])) { A.local[id] = n; A.dirty[id].add(VIEW_IDS.includes(id) ? "sections" : "*"); scheduleSave(id); }
  });
  validateSel();
  renderCanvas();
  renderInsp();
  renderLeft();
  refreshChrome();
}
function undo() { stopEditing(); if (!A.undo.length) return; A.redo.push(snapshot()); A.histLock = null; restore(A.undo.pop()); toast("Undone"); }
function redo() { stopEditing(); if (!A.redo.length) return; A.undo.push(snapshot()); A.histLock = null; restore(A.redo.pop()); toast("Redone"); }
function refreshHistoryButtons() {
  const u = $('[data-act="undo"]', admEl), r = $('[data-act="redo"]', admEl);
  if (u) u.disabled = !A.undo.length;
  if (r) r.disabled = !A.redo.length;
}

/* ---------- Shell ---------- */
function gateHTML(title, body, link) {
  return `<header class="ce-bar"><a class="adm-brand" href="${esc(siteUrl())}"><span class="adm-logo"><img src="/assets/clip-mark.png" alt="" width="41" height="30"></span><span class="adm-brand-text">Admin</span><span class="sr-only">, back to the public site</span></a><span class="adm-domain">admin.scuclip.com</span></header>
<div class="adm-gate"><div class="adm-gate-card"><svg width="48" height="54" aria-hidden="true"><use href="#flask-mini"/></svg><h1 class="adm-h1">${esc(title)}</h1><p>${esc(body)}</p>${link ? `<a class="adm-btn adm-btn-line" href="${esc(siteUrl())}">View the site</a>` : ""}</div></div>`;
}
function buildAdmin() {
  A.device = window.innerWidth <= 760 ? "phone" : "desktop";
  admEl.innerHTML = `<header class="ce-bar">
  <a class="adm-brand" href="${esc(siteUrl())}"><span class="adm-logo"><img src="/assets/clip-mark.png" alt="" width="41" height="30"></span><span class="adm-brand-text">Admin</span><span class="sr-only">, back to the public site</span></a>
  <span class="adm-domain" title="Where this editor will live once the site has its own domain">admin.scuclip.com</span>
  <div class="ce-pagepick"><label class="sr-only" for="ce-page">Page to edit</label><select id="ce-page">${PAGES.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}</select></div>
  <div class="ce-seg" role="group" aria-label="Layout to edit"><button type="button" data-device="desktop" aria-pressed="${A.device === "desktop"}">Desktop</button><button type="button" data-device="phone" aria-pressed="${A.device === "phone"}">${ICON.phone}Phone</button></div>
  <div class="ce-seg ce-zoomseg" role="group" aria-label="Zoom"><button type="button" data-zoom="fit" aria-pressed="true">Fit</button><button type="button" data-zoom="full" aria-pressed="false">100%</button></div>
  <div class="ce-seg" role="group" aria-label="Undo and redo"><button type="button" data-act="undo" disabled title="Undo (Ctrl+Z)">${ICON.undo}<span class="sr-only">Undo</span></button><button type="button" data-act="redo" disabled title="Redo (Ctrl+Shift+Z)">${ICON.redo}<span class="sr-only">Redo</span></button></div>
  <p class="adm-status" id="adm-status">Loading drafts...</p>
  <button class="adm-btn adm-btn-bar small" id="adm-retry" type="button" data-act="retry" hidden>Try again</button>
  <div class="adm-bar-actions">
    <button class="adm-btn adm-btn-bar ce-insp-toggle" type="button" data-act="insp-open">Settings</button>
    <button class="adm-btn adm-btn-bar" type="button" id="ce-discard" data-act="discard-all" disabled>Discard</button>
    <a class="adm-btn adm-btn-bar" href="${esc(siteUrl())}" target="_blank" rel="noopener">View site</a>
    <button class="adm-btn adm-btn-publish" id="adm-publish" type="button" data-act="publish" disabled>Publish</button>
  </div>
</header>
<p class="ce-mobile-note">The editor works best on a laptop. On a phone you can still change text and photos.</p>
<p class="sr-only" id="adm-announce" role="status" aria-live="polite"></p>
<div class="ce-body">
  <aside class="ce-left" aria-label="Add things, pages and site settings">
    <div class="ce-tabs" role="tablist">${[["add", "Add"], ["pages", "Pages"], ["site", "Site"]].map(([k, l]) => `<button type="button" role="tab" id="ce-tab-${k}" aria-controls="ce-panel" data-tab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join("")}</div>
    <div class="ce-tabpanel" id="ce-panel" role="tabpanel" aria-labelledby="ce-tab-${A.tab}"></div>
  </aside>
  <div class="ce-canvas" id="ce-canvas" aria-label="Page canvas"><div class="ce-sizer" id="ce-sizer"><div class="ce-frame" id="ce-frame"><div class="site is-edit" id="ce-site"></div><div class="ce-ov" id="ce-ov"></div></div></div><div class="ce-drop-line" id="ce-drop" hidden></div></div>
  <aside class="ce-insp" id="ce-insp" aria-label="Settings"></aside>
</div>
<div class="ce-toast" id="ce-toast" role="status" hidden></div>`;
  if (window.ResizeObserver) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { sizeCanvas(); drawOverlay(); }); }).observe($("#ce-canvas"));
  } else window.addEventListener("resize", () => { sizeCanvas(); drawOverlay(); });
  bindAdmin();
}

const siteUrl = (p) => (A.session ? A.session.publicOrigin : "") + (p || "/");
const docLabel = (id) => (VIEW_IDS.includes(id) ? "the " + pageLabel(id) + " page" : id === "data" ? "the shared lists" : "the site settings");
async function openAdmin() {
  if (A.ok) { refreshChrome(); relayoutCanvas(); return; }
  if (A.started) return;
  A.started = true;
  admEl.innerHTML = gateHTML("Checking your access", "One moment while the editor opens.", false);
  let session = null, problem = "";
  try { session = await api.session(); } catch (e) { problem = (e && e.message) || ""; }
  if (!session) { admEl.innerHTML = gateHTML("The editor can't open", problem || "The editor's server didn't answer. Reload the page to try again.", true); A.started = false; return; }
  A.session = session;
  A.assets = true;
  A.ok = true;
  buildAdmin();
  renderLeft();
  renderCanvas();
  renderInsp();
  refreshChrome();
  const slow = setTimeout(() => { if (!adminReady()) { A.loadSlow = true; refreshChrome(); renderCanvas(); } }, 10000);
  await loadDocs();
  if (adminReady()) { clearTimeout(slow); A.loadSlow = false; refreshChrome(); }
  loadSignups();
}
/* The prototype's live snapshots, as a load: the published docs become LIVE, and each draft goes through
   onRemoteDraft(), which adopts it unless that doc has changes that aren't saved yet. */
async function loadDocs() {
  let docs;
  try { docs = (await api.docs()).docs; }
  catch (_) { if (!A.loaded) setFlash("The drafts couldn't load. Reload the page to try again.", true); return false; }
  const pub = {};
  DOC_IDS.forEach((id) => { if (docs[id] && docs[id].published) pub[id] = docs[id].published; });
  applyLive(pub);
  LIVE.state = "ready";
  DOC_IDS.forEach((id) => { const d = docs[id]; A.remoteVer[id] = d ? d.version : 0; onRemoteDraft(id, d ? d.draft : null); });
  const wasReady = adminReady();
  A.loaded = true;
  if (A.loaded) DOC_IDS.forEach((id) => { if (!usableDoc(id, A.remote[id]) && !busy(id)) adopt(id); });
  afterRemote(!wasReady);
  return true;
}
async function loadSignups() {
  try {
    const { signups, sheet } = await api.signups();
    const rows = { weekly: [], biohackathon: [] };
    signups.forEach((r) => { if (rows[r.list]) rows[r.list].push({ id: r.id, email: r.email, at: str(r.createdAt), inSheet: !!r.inSheet }); });
    A.signups = rows;
    A.sheet = sheet || { connected: false, waiting: 0 };
  } catch (_) { A.signups = "error"; }
  if (A.tab === "site") renderLeft();
}
function onRemoteDraft(id, data) { A.remote[id] = data || null; if (!busy(id)) adopt(id); }
/* A draft saved by an older version of the editor is ignored, and the published page is used instead */
function adopt(id) {
  const data = A.remote[id];
  A.exists[id] = !!data;
  if (A.remoteVer[id]) A.ver[id] = A.remoteVer[id];
  const next = norm(id, usableDoc(id, data) ? data : LIVE.docs[id] || null);
  if (canon(next) !== canon(A.local[id])) { A.local[id] = next; A.stale.add(id); }
}
function remoteHolds(doc, keys) {
  const r = A.remote[doc];
  if (!r) return false;
  const rn = norm(doc, r);
  if (keys.includes("*") || keys.includes("sections")) return canon(rn) === canon(A.local[doc]);
  return keys.every((k) => canon(rn[k]) === canon(A.local[doc][k]));
}
function adminOnLive() {
  if (!A.ok) return;
  if (A.loaded) DOC_IDS.forEach((id) => { if (!usableDoc(id, A.remote[id]) && !busy(id)) adopt(id); });
  afterRemote(false);
}
function afterRemote(first) {
  if (!A.ok) return;
  const ready = adminReady();
  const touched = first || (ready && !A.cvReady) || A.stale.has(A.page) || A.stale.has("data") || A.stale.has("settings");
  if (touched) { validateSel(); if (A.editEl || D) A.pendingRender = true; else { renderCanvas(); renderInsp(); } }
  if (first || A.stale.size || (ready && !A.cvReady)) renderLeft();
  A.stale.clear();
  refreshChrome();
}

/* ---------- Canvas ---------- */
function editX() { return { C: A.local, edit: true, idp: "cv-", editor: false, animate: false }; }
/* opts.bake: after a change, store the drawn positions, so anything that moved down because text grew stays put */
function renderCanvas(opts) {
  clearTimeout(A.cvTimer);
  A.cvTimer = null;
  const site = $("#ce-site");
  if (!site) return;
  if (A.editEl) { A.pendingRender = true; return; }
  A.cvReady = adminReady();
  if (!A.cvReady) {
    site.innerHTML = shellHTML({ C: A.local, edit: false, idp: "cv-", editor: false }, A.page, `<main class="view"><div class="wrap"><div class="loading">${MASCOT("")}<p class="note-pen">${A.loadSlow ? "the drafts are taking a while..." : "opening the drafts..."}</p></div></div></main>`);
    relayoutCanvas();
    return;
  }
  const X = editX();
  site.innerHTML = shellHTML(X, A.page, pageMain(X, A.page));
  markSelection();
  relayoutCanvas();
  if (opts && opts.bake && bakeAll()) { syncVars(); relayoutCanvas(); markChanged(A.page, "sections"); }
}
function scheduleCanvas() { clearTimeout(A.cvTimer); A.cvTimer = setTimeout(() => { if (A.editEl || D) A.pendingRender = true; else renderCanvas({ bake: true }); }, 160); }
function relayoutCanvas() {
  const site = $("#ce-site"), frame = $("#ce-frame");
  if (!site || !frame) return;
  frame.style.width = FRAME_W() + "px";
  if (A.cvReady) A.lay = layoutAll(site, A.local, A.page, MK());
  else { fitSite(site, MK()); A.lay = null; }
  sizeCanvas();
  drawOverlay();
}
function sizeCanvas() {
  const canvas = $("#ce-canvas"), sizer = $("#ce-sizer"), frame = $("#ce-frame");
  if (!canvas || !frame) return;
  const w = FRAME_W();
  const avail = canvas.clientWidth - 48;
  const z = A.zoom === "full" ? 1 : avail > 0 ? clamp(avail / w, 0.3, 1) : 1;
  A.z = z;
  frame.style.transform = `scale(${z})`;
  frame.style.setProperty("--inv", String(Math.min(3, 1 / z)));
  sizer.style.width = Math.round(w * z) + "px";
  sizer.style.height = Math.ceil(frame.offsetHeight * z) + "px";
}
/* Writes the stored boxes back onto the drawn elements without rebuilding them (keeps the text caret) */
function syncVars() {
  secs().forEach((s) => {
    const secEl = secNode(s.id);
    if (!secEl) return;
    secEl.style.setProperty("--h", s.h);
    secEl.style.setProperty("--mh", s.mh);
    s.elements.forEach((e, i) => {
      const el = secEl.querySelector(`.el[data-eid="${e.id}"]`);
      if (!el) return;
      el.style.cssText = boxStyle(e, i + 1);
      el.classList.toggle("m-auto", !e.m);
    });
  });
}
/* Store what is drawn: positions after any push-down, measured heights, and the section height */
function bakeSec(s) {
  const lay = A.lay && A.lay.secs[s.id];
  if (!lay || lay.mode !== MK()) return false;
  const k = MK(), hk = HK();
  let changed = false;
  s.elements.forEach((e) => {
    const b = lay.boxes.get(e.id);
    if (!b) return;
    const cur = e[k];
    const content = ["k", "auto"].includes(EL[e.type].size);
    const typing = !!(cur && A.editEl && A.editEl.closest(".el") && A.editEl.closest(".el").dataset.eid === e.id);
    const nb = { x: cur ? cur.x : r1(b.x), y: r1(b.y), w: cur && !content ? cur.w : r1(b.w), h: typing ? Math.max(cur.h, r1(b.h)) : r1(b.h) };
    if (!cur || cur.x !== nb.x || cur.y !== nb.y || cur.w !== nb.w || cur.h !== nb.h) { e[k] = nb; changed = true; }
  });
  const rh = r1(lay.rh);
  if (s[hk] !== rh) { s[hk] = rh; changed = true; }
  return changed;
}
function bakeAll() { let ch = false; secs().forEach((s) => { if (bakeSec(s)) ch = true; }); return ch; }
/* A section grows when something ends up below its bottom edge */
function growToFit(s, k) {
  const hk = k === "m" ? "mh" : "h";
  let bottom = 0;
  s.elements.forEach((e) => { const b = e[k]; if (b && !(k === "m" && e.mHide)) bottom = Math.max(bottom, b.y + b.h); });
  if (bottom + 16 > s[hk]) s[hk] = r1(bottom + 32);
}

/* ---------- Overlay: selection boxes, handles, toolbars and guides, drawn over the page ---------- */
function secGeo(sid) {
  const secEl = secNode(sid), frame = $("#ce-frame");
  if (!secEl || !frame) return null;
  const fr = frame.getBoundingClientRect(), z = A.z || 1;
  const sr = secEl.getBoundingClientRect(), ir = secEl.firstElementChild.getBoundingClientRect();
  return { top: (sr.top - fr.top) / z, h: sr.height / z, ox: (ir.left - fr.left) / z, oy: (ir.top - fr.top) / z };
}
function elBox(sid, eid, g) {
  g = g || secGeo(sid);
  const lay = A.lay && A.lay.secs[sid];
  if (!g || !lay) return null;
  let b = lay.boxes.get(eid);
  if (!b) return null;
  let r = (findEl(eid) || { e: { r: 0 } }).e.r;
  if (D && D.live) {
    if (D.kind === "move" && D.sid === sid) { const st = D.start.find((x) => x.id === eid); if (st) b = { x: st.x + D.fdx, y: st.y + D.fdy, w: st.w, h: st.h }; }
    if (D.kind === "resize" && D.e.id === eid && D.nb) b = D.nb;
    if (D.kind === "rotate" && D.e.id === eid) r = D.nr;
  }
  const sc = (A.lay && A.lay.s) || 1;
  return { left: g.ox + b.x * sc, top: g.oy + b.y * sc, w: b.w * sc, h: b.h * sc, r };
}
const boxDiv = (b, cls, inner) => `<div class="ce-box ${cls}" style="left:${b.left}px;top:${b.top}px;width:${b.w}px;height:${b.h}px${b.r ? `;transform:rotate(${b.r}deg)` : ""}">${inner || ""}</div>`;
function handlesHTML(e) {
  const size = EL[e.type].size;
  const hs = size === "w" ? ["w", "e"] : size === "img" ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : size === "ar" || size === "k" ? ["nw", "ne", "sw", "se"] : [];
  let h = hs.map((d) => `<span class="ce-hd" data-h="${d}"></span>`).join("");
  if (EL[e.type].rot) h += '<span class="ce-hd ce-rot" data-h="rot" title="Drag to rotate. Hold Shift for 15 degree steps."></span>';
  return h;
}
const tbtn = (act, icon, label, extra) => `<button type="button" data-act="${act}" title="${esc(label)}" aria-label="${esc(label)}"${extra || ""}>${icon}</button>`;
function elTools(sid, ids, g) {
  const s = secById(sid);
  const els = ids.map((id) => s.elements.find((e) => e.id === id)).filter(Boolean);
  let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
  els.forEach((e) => { const b = elBox(sid, e.id, g); if (b) { x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); y1 = Math.max(y1, b.top + b.h); } });
  if (!isFinite(x0)) return "";
  const one = els.length === 1 ? els[0] : null;
  let h = `<span class="ce-tname">${esc(one ? elName(one) : els.length + " selected")}</span>`;
  if (one && hasText(one)) h += tbtn("el-edit", ICON.pen, "Edit text (double-click)");
  if (one && one.type === "image") h += tbtn("el-photo", ICON.photo, "Change photo");
  if (one && one.type === "list") h += tbtn("el-additem", ICON.plus, `Add ${LISTS[one.src].item.toLowerCase()}`);
  if (one) h += tbtn("el-settings", ICON.gear, "Settings");
  if (!isPhone()) h += tbtn("el-dup", ICON.dup, "Duplicate (Ctrl+D)");
  if (one) h += tbtn("el-front", ICON.front, "Bring forward") + tbtn("el-back", ICON.back, "Send backward");
  if (isPhone()) h += tbtn("el-mhide", ICON.phoneOff, "Hide on phones");
  else { const hidden = els.every((e) => e.mHide); h += tbtn("el-mhide", hidden ? ICON.phone : ICON.phoneOff, hidden ? "Show on phones" : "Hide on phones", hidden ? ' aria-pressed="true"' : ""); }
  if (!isPhone()) h += tbtn("el-del", ICON.trash, "Delete");
  return `<div class="ce-etools" role="toolbar" aria-label="Selected item" style="left:${x0}px;top:${y0}px" data-x="${x0}" data-y="${y0}" data-b="${y1}">${h}</div>`;
}
function secTools(sid, g) {
  const i = secIndex(sid), n = secs().length, ph = isPhone();
  let h = `<span class="ce-tname">Section ${i + 1} of ${n}</span>`;
  if (!ph) h += tbtn("sec-up", ICON.up, "Move section up", i === 0 ? " disabled" : "") + tbtn("sec-down", ICON.down, "Move section down", i === n - 1 ? " disabled" : "") + tbtn("sec-dup", ICON.dup, "Duplicate section") + tbtn("sec-del", ICON.trash, "Delete section");
  else {
    const nh = secById(sid).elements.filter((e) => e.mHide).length;
    h += '<button type="button" class="ce-textbtn" data-act="sec-arrange">Re-arrange for phone</button>';
    if (nh) h += `<button type="button" class="ce-textbtn" data-act="sec-hidden" title="Things in this section that phones don't show">${nh} hidden</button>`;
  }
  h += tbtn("sec-settings", ICON.gear, "Section settings");
  if (!ph) h += `<button type="button" class="ce-textbtn" data-act="sec-add">${ICON.plus}Section below</button>`;
  return `<div class="ce-stools" role="toolbar" aria-label="Selected section" style="top:${g.top}px">${h}</div>`;
}
function requestOverlay() { if (A.ovRaf) return; A.ovRaf = requestAnimationFrame(() => { A.ovRaf = 0; drawOverlay(); }); }
function drawOverlay() {
  const ov = $("#ce-ov");
  if (!ov) return;
  if (!A.cvReady || !A.lay) { ov.innerHTML = ""; return; }
  const W = FRAME_W(), out = [];
  const sel = A.sel, ids = selIds(), hov = A.hover;
  const dragging = !!(D && D.live);
  const ssid = sel && secById(sel.sid) ? sel.sid : null;
  if (hov && hov.sid && hov.sid !== ssid && (!dragging || D.kind === "new")) {
    const g = secGeo(hov.sid);
    if (g) out.push(`<div class="ce-secbox ${dragging ? "is-target" : "is-hover"}" style="top:${g.top}px;height:${g.h}px;width:${W}px"><span class="ce-seclabel">${dragging ? "Drop in s" : "S"}ection ${secIndex(hov.sid) + 1}</span></div>`);
  }
  if (ssid) {
    const g = secGeo(ssid);
    if (g) {
      const active = !!sel.sec;
      out.push(`<div class="ce-secbox ${active ? "is-sel" : "is-ctx"}" style="top:${g.top}px;height:${g.h}px;width:${W}px"></div>`);
      if (active && !dragging) out.push(secTools(ssid, g));
      if (active) out.push(`<button type="button" class="ce-shandle" data-h="sec" style="top:${g.top + g.h}px;left:${W / 2}px" title="Drag to change the section height" aria-label="Section height">${ICON.up}${ICON.down}</button>`);
    }
  }
  if (hov && hov.eid && !ids.includes(hov.eid) && !dragging) { const b = elBox(hov.sid, hov.eid); if (b) out.push(boxDiv(b, "is-hover")); }
  if (ids.length && ssid) {
    const g = secGeo(ssid);
    const one = ids.length === 1 ? findEl(ids[0]) : null;
    const showHandles = one && !A.editEl && !(dragging && D.kind === "move");
    ids.forEach((eid) => { const b = elBox(ssid, eid, g); if (b) out.push(boxDiv(b, ids.length > 1 ? "is-multi" : A.editEl ? "is-editing" : "is-sel", showHandles ? handlesHTML(one.e) : "")); });
    if (!dragging && !A.editEl) out.push(elTools(ssid, ids, g));
  }
  if (dragging && D.guides) {
    const G = D.guides, g = secGeo(G.sid), sc = A.lay.s || 1;
    if (g && G.gx != null) out.push(`<div class="ce-guide is-v" style="left:${g.ox + G.gx * sc}px;top:${g.top}px;height:${g.h}px"></div>`);
    if (g && G.gy != null) out.push(`<div class="ce-guide is-h" style="top:${g.oy + G.gy * sc}px;left:0;width:${W}px"></div>`);
  }
  ov.innerHTML = out.join("");
  const tb = $(".ce-etools", ov);
  if (tb) {
    const z = A.z || 1, r = tb.getBoundingClientRect();
    const wF = r.width / z, hF = r.height / z;
    let x = clamp(+tb.dataset.x, 0, Math.max(0, W - wF)), y = +tb.dataset.y - 10 / z;
    if (y - hF < 2) y = +tb.dataset.b + 10 / z + hF;
    tb.style.left = x + "px";
    tb.style.top = y + "px";
  }
}

/* ---------- Selection ---------- */
function markSelection() {
  const site = $("#ce-site");
  if (!site) return;
  $$(".el.is-sel, .ce-item-sel", site).forEach((el) => el.classList.remove("is-sel", "ce-item-sel"));
  if (A.sel && A.sel.ids) A.sel.ids.forEach((id) => { const el = elNode(A.sel.sid, id); if (el) el.classList.add("is-sel"); });
  if (A.item) { const it = site.querySelector(`[data-item="${A.item}"]`); if (it) it.classList.add("ce-item-sel"); }
}
function select(sel, opts) {
  const same = canon(sel) === canon(A.sel);
  A.sel = sel;
  if (!same) A.item = null;
  markSelection();
  drawOverlay();
  if (!same || (opts && opts.force)) { renderInsp(opts && opts.focusRef); if (A.tab === "pages") renderLeft(); }
  if (opts && opts.openInsp) admEl.classList.add("insp-open");
}
function toggleSel(sid, eid) {
  const cur = A.sel && A.sel.ids && A.sel.sid === sid ? A.sel.ids.slice() : [];
  const i = cur.indexOf(eid);
  if (i >= 0) cur.splice(i, 1); else cur.push(eid);
  select(cur.length ? { sid, ids: cur } : { sid, sec: true });
}

/* ---------- Making and changing elements ---------- */
function measureD(s, e) {
  const m = measure(A.local, A.page, s, [{ e, w: e.d.w }], "d").get(e.id);
  if (!m) return;
  e.d.h = r1(m.h);
  if (["k", "auto"].includes(EL[e.type].size)) e.d.w = r1(m.w);
}
function commit(msg) { markChanged(A.page, "sections"); renderCanvas({ bake: true }); renderInsp(); if (A.tab === "pages") renderLeft(); if (msg) announce(msg); }
function visibleY(sid) {
  const g = secGeo(sid), canvas = $("#ce-canvas"), frame = $("#ce-frame");
  if (!g || !canvas || !frame) return 80;
  const cr = canvas.getBoundingClientRect(), fr = frame.getBoundingClientRect();
  const mid = ((cr.top + cr.bottom) / 2 - fr.top) / A.z;
  return clamp(mid - g.oy, 60, Math.max(60, g.h - 60));
}
function visibleSection() {
  const canvas = $("#ce-canvas");
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect(), mid = (cr.top + cr.bottom) / 2;
  const list = $$("#ce-site .fsec[data-sid]");
  const hit = list.find((x) => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; }) || list.find((x) => { const r = x.getBoundingClientRect(); return r.bottom > cr.top + 60 && r.top < cr.bottom - 60; });
  return hit ? hit.dataset.sid : (secs()[0] && secs()[0].id) || null;
}
function clickTargetSection() {
  const canvas = $("#ce-canvas"), node = A.sel && secById(A.sel.sid) ? secNode(A.sel.sid) : null;
  if (node && canvas) { const r = node.getBoundingClientRect(), cr = canvas.getBoundingClientRect(); if (r.bottom > cr.top + 40 && r.top < cr.bottom - 40) return A.sel.sid; }
  return visibleSection();
}
function addElement(spec, sid, at) {
  if (isPhone()) { toast("Switch to Desktop to add things. New things show up at the bottom of the phone layout too."); return; }
  const s = sid && secById(sid);
  if (!s) { toast("Add a section first, from the Sections group."); return; }
  stopEditing();
  beginChange();
  bakeSec(s);
  const e = makeElement(spec);
  if (!e) return;
  measureD(s, e);
  const cx = at ? at.cx : DW / 2, cy = at ? at.cy : visibleY(s.id);
  e.d.x = r1(clamp(cx - e.d.w / 2, 0, Math.max(0, DW - e.d.w)));
  e.d.y = r1(Math.max(0, cy - e.d.h / 2));
  /* clicking the same tile twice shouldn't stack copies exactly on top of each other */
  for (let i = 0; !at && i < 12 && s.elements.some((o) => Math.abs(o.d.x - e.d.x) < 6 && Math.abs(o.d.y - e.d.y) < 6); i++) {
    e.d.x = r1(Math.min(e.d.x + 24, Math.max(0, DW - e.d.w)));
    e.d.y = r1(e.d.y + 24);
  }
  s.elements.push(e);
  if (!e.mHide) appendPhone(A.local, A.page, s, [e]);
  growToFit(s, "d");
  A.sel = { sid: s.id, ids: [e.id] };
  A.item = null;
  commit(`Added ${elName(e).toLowerCase()}.`);
  toast(`Added ${elName(e).toLowerCase()}. Drag it into place${hasText(e) ? ", and double-click to type" : ""}.`);
}
function deleteSel() {
  const els = selEls();
  if (!els.length) return;
  const s = secById(A.sel.sid);
  stopEditing();
  beginChange();
  bakeSec(s);
  if (isPhone()) {
    els.forEach((e) => { e.mHide = true; });
    A.sel = { sid: s.id, sec: true };
    commit();
    toast("Hidden on phones. The desktop layout keeps it. The section's hidden list can show it again.", true);
    return;
  }
  s.elements = s.elements.filter((e) => !els.includes(e));
  A.sel = { sid: s.id, sec: true };
  A.item = null;
  commit();
  toast(`Deleted ${els.length === 1 ? elName(els[0]).toLowerCase() : els.length + " things"}.`, true);
}
function placeCopies(s, src) {
  const copies = src.map((e) => {
    const c = clone(e);
    c.id = uid("e");
    c.d.x = r1(Math.min(c.d.x + 24, DW - 24));
    c.d.y = r1(c.d.y + 24);
    c.m = null;
    return c;
  });
  s.elements.push(...copies);
  appendPhone(A.local, A.page, s, copies.filter((c) => !c.mHide));
  growToFit(s, "d");
  return copies;
}
function dupSel() {
  if (isPhone()) { toast("Switch to Desktop to duplicate. The copy also shows up on phones."); return; }
  const els = selEls();
  if (!els.length) return;
  const s = secById(A.sel.sid);
  stopEditing();
  beginChange();
  bakeSec(s);
  const copies = placeCopies(s, els);
  A.sel = { sid: s.id, ids: copies.map((c) => c.id) };
  commit("Duplicated.");
}
function copySel() {
  const els = selEls();
  if (!els.length) return false;
  A.clip = clone(els);
  toast(`Copied ${els.length === 1 ? elName(els[0]).toLowerCase() : els.length + " things"}. Ctrl+V pastes.`);
  return true;
}
function paste() {
  if (!A.clip || !A.clip.length) return;
  if (isPhone()) { toast("Switch to Desktop to paste."); return; }
  const s = secById(clickTargetSection());
  if (!s) return;
  stopEditing();
  beginChange();
  bakeSec(s);
  const copies = placeCopies(s, A.clip);
  A.sel = { sid: s.id, ids: copies.map((c) => c.id) };
  commit("Pasted.");
}
function zOrder(dir) {
  const els = selEls();
  if (els.length !== 1) return;
  const s = secById(A.sel.sid), i = s.elements.indexOf(els[0]), j = i + dir;
  if (j < 0 || j >= s.elements.length) { toast(dir > 0 ? "It's already in front." : "It's already at the back."); return; }
  beginChange();
  bakeSec(s);
  [s.elements[i], s.elements[j]] = [s.elements[j], s.elements[i]];
  commit(dir > 0 ? "Brought forward." : "Sent backward.");
}
function phoneToggle() {
  const els = selEls();
  if (!els.length) return;
  if (isPhone()) { deleteSel(); return; }
  const s = secById(A.sel.sid), show = els.every((e) => e.mHide);
  beginChange();
  bakeSec(s);
  els.forEach((e) => { e.mHide = !show; });
  if (show) appendPhone(A.local, A.page, s, els.filter((e) => !e.m));
  commit();
  toast(show ? "Shows on phones again." : "Hidden on phones. It stays on desktop.", true);
}
function showOnPhone(eid) {
  const f = findEl(eid);
  if (!f) return;
  beginChange();
  bakeSec(f.s);
  f.e.mHide = false;
  if (!f.e.m) appendPhone(A.local, A.page, f.s, [f.e]);
  growToFit(f.s, "m");
  A.sel = { sid: f.s.id, ids: [eid] };
  commit("Shows on phones again.");
}
function nudge(dx, dy) {
  const els = selEls();
  if (!els.length) return;
  const s = secById(A.sel.sid), k = MK();
  beginChange("nudge:" + els.map((e) => e.id).join(","));
  bakeSec(s);
  els.forEach((e) => { const b = e[k]; if (b) e[k] = Object.assign({}, b, { x: r1(b.x + dx), y: r1(Math.max(0, b.y + dy)) }); });
  growToFit(s, k);
  markChanged(A.page, "sections");
  syncVars();
  relayoutCanvas();
}
function alignSel(how) {
  const els = selEls();
  if (els.length < 2) return;
  const s = secById(A.sel.sid), k = MK();
  beginChange();
  bakeSec(s);
  const bs = els.map((e) => e[k]).filter(Boolean);
  const x0 = Math.min(...bs.map((b) => b.x)), x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y0 = Math.min(...bs.map((b) => b.y)), y1 = Math.max(...bs.map((b) => b.y + b.h));
  bs.forEach((b) => {
    if (how === "left") b.x = x0;
    if (how === "center") b.x = r1((x0 + x1) / 2 - b.w / 2);
    if (how === "right") b.x = r1(x1 - b.w);
    if (how === "top") b.y = y0;
    if (how === "middle") b.y = r1((y0 + y1) / 2 - b.h / 2);
    if (how === "bottom") b.y = r1(y1 - b.h);
  });
  commit("Lined up.");
}

/* ---------- Sections ---------- */
function buildSection(key) {
  const P = SEC_PRESETS[key];
  const s = { id: uid("s"), h: 360, mh: 280, bg: "none", elements: [] };
  let bottom = 0;
  P.cols.forEach((col) => {
    let y = 64;
    col.els.forEach((spec, i) => {
      const e = makeElement(Object.assign({ w: spec.w || col.w }, spec));
      if (!e) return;
      e.d.x = col.x;
      measureD(s, e);
      if (i) y += 24;
      e.d.y = r1(y);
      y += e.d.h;
      s.elements.push(e);
    });
    bottom = Math.max(bottom, y);
  });
  if (bottom) s.h = r1(bottom + 72);
  arrangePhone(A.local, A.page, s);
  return s;
}
function addSection(key, at) {
  if (isPhone()) { toast("Switch to Desktop to add sections."); return; }
  if (!SEC_PRESETS[key]) return;
  stopEditing();
  beginChange();
  const s = buildSection(key);
  const list = secs();
  list.splice(at == null ? list.length : clamp(at, 0, list.length), 0, s);
  A.sel = { sid: s.id, sec: true };
  commit(`Added a ${SEC_PRESETS[key].label.toLowerCase()} section.`);
  requestAnimationFrame(() => scrollToSec(s.id));
  toast(`Added a ${SEC_PRESETS[key].label.toLowerCase()} section.`);
}
function moveSection(sid, to) {
  const list = secs(), from = secIndex(sid);
  if (from < 0 || to < 0 || to > list.length - 1 || to === from) return;
  stopEditing();
  beginChange();
  const [s] = list.splice(from, 1);
  list.splice(to, 0, s);
  A.sel = { sid, sec: true };
  commit(`Moved the section to position ${to + 1}.`);
  requestAnimationFrame(() => scrollToSec(sid));
}
function dupSection(sid) {
  const i = secIndex(sid);
  if (i < 0) return;
  stopEditing();
  beginChange();
  const copy = clone(secs()[i]);
  copy.id = uid("s");
  copy.elements.forEach((e) => { e.id = uid("e"); });
  secs().splice(i + 1, 0, copy);
  A.sel = { sid: copy.id, sec: true };
  commit("Section duplicated.");
  requestAnimationFrame(() => scrollToSec(copy.id));
}
function delSection(sid) {
  const i = secIndex(sid);
  if (i < 0) return;
  stopEditing();
  beginChange();
  secs().splice(i, 1);
  A.sel = null;
  A.item = null;
  commit();
  toast("Section deleted.", true);
}
function arrangeSection(sid) {
  const s = secById(sid);
  if (!s) return;
  stopEditing();
  beginChange();
  arrangePhone(A.local, A.page, s);
  A.sel = { sid, sec: true };
  commit();
  toast("Phone layout rebuilt from the desktop layout.", true);
}
function scrollIntoCanvas(node) {
  const canvas = $("#ce-canvas");
  if (!node || !canvas) return;
  const r = node.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  if (r.top < cr.top + 40 || r.top > cr.bottom - 80) canvas.scrollBy({ top: r.top - cr.top - 80, behavior: reduceMotion() ? "auto" : "smooth" });
}
const scrollToSec = (sid) => scrollIntoCanvas(secNode(sid));

/* ---------- List items ---------- */
function newItem(listRef) { const def = listDef(listRef); return def && def.make ? def.make() : {}; }
function listChanged(listRef) { const doc = listRef[0] === "D" ? "data" : A.page; markChanged(doc, docKey(doc, listRef)); renderCanvas({ bake: true }); renderInsp(); }
function addListItem(listRef) {
  const list = listAt(listRef), def = listDef(listRef);
  if (!list || !def) return;
  if (list.length >= (def.max || 40)) { toast("This list is full."); return; }
  stopEditing();
  beginChange();
  list.push(newItem(listRef));
  const ref = `${listRef}.${list.length - 1}`;
  A.item = ref;
  A.open.add(ref);
  listChanged(listRef);
  const site = $("#ce-site");
  const f = site.querySelector(`[data-f="${ref}.${def.title}"]`) || site.querySelector(`[data-item="${ref}"] [data-f]`);
  if (f) startEditing(f, null, null, true);
  else toast("Added. This list shows only the first few here, so fill it in under Settings.");
}
function dupListItem(ref) {
  const listRef = ref.replace(/\.\d+$/, ""), list = listAt(listRef), i = itemIndex(ref), def = listDef(listRef);
  if (!list || i < 0 || !def) return;
  if (list.length >= (def.max || 40)) { toast("This list is full."); return; }
  stopEditing();
  beginChange();
  list.splice(i + 1, 0, clone(list[i]));
  A.item = `${listRef}.${i + 1}`;
  listChanged(listRef);
}
function delListItem(ref) {
  const listRef = ref.replace(/\.\d+$/, ""), list = listAt(listRef), i = itemIndex(ref);
  if (!list || i < 0) return;
  stopEditing();
  beginChange();
  list.splice(i, 1);
  A.item = null;
  listChanged(listRef);
  toast("Deleted.", true);
}
function moveListItem(listRef, from, to) {
  const list = listAt(listRef);
  if (!list || from === to || to < 0 || to >= list.length) return;
  stopEditing();
  beginChange();
  const [it] = list.splice(from, 1);
  list.splice(to, 0, it);
  A.item = `${listRef}.${to}`;
  listChanged(listRef);
}
/* The list a selected list element shows */
function elListRef(sid, e) { return LISTS[e.src].shared ? `D.${e.src}` : `E.${sid}.${e.id}.items`; }

/* ---------- Typing on the page ---------- */
/* The typed text exactly as entered. innerText would apply CSS text-transform and save labels in capitals. */
function readText(el) {
  let out = "";
  const walk = (n) => n.childNodes.forEach((c) => {
    if (c.nodeType === 3) out += c.data;
    else if (c.nodeName === "BR") out += "\n";
    else if (c.nodeType === 1 && c.getAttribute("contenteditable") !== "false") {
      if (/^(DIV|P|LI)$/.test(c.nodeName) && out && !out.endsWith("\n")) out += "\n";
      walk(c);
    }
  });
  walk(el);
  return out;
}
function selectAllIn(el) {
  try { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (_) {}
}
function caretAt(f, x, y) {
  let r = null;
  try {
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); } }
  } catch (_) { r = null; }
  const sel = window.getSelection();
  if (r && f.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); return; }
  try { const rr = document.createRange(); rr.selectNodeContents(f); rr.collapse(false); sel.removeAllRanges(); sel.addRange(rr); } catch (_) {}
}
function startEditing(f, x, y, all) {
  if (!f || !adminReady()) return;
  stopEditing();
  A.editEl = f;
  A.editing = f.dataset.f;
  f.setAttribute("contenteditable", "true");
  f.setAttribute("spellcheck", "true");
  const elx = f.closest(".el");
  if (elx) elx.classList.add("is-editing");
  const item = f.closest("[data-item]");
  if (item) { A.item = item.dataset.item; A.open.add(A.item); markSelection(); renderInsp(); }
  f.focus({ preventScroll: true });
  if (all) selectAllIn(f); else caretAt(f, x, y);
  drawOverlay();
}
function stopEditing() {
  const f = A.editEl;
  if (!f) return;
  A.editEl = null;
  A.editing = null;
  A.histLock = null;
  f.removeAttribute("contenteditable");
  f.removeAttribute("spellcheck");
  const elx = f.closest(".el");
  if (elx) elx.classList.remove("is-editing");
  if (document.activeElement === f) f.blur();
  const dirty = !!f.dataset.dirty;
  delete f.dataset.dirty;
  if (A.pendingRender || dirty) { A.pendingRender = false; renderCanvas(); renderInsp(); if (A.tab === "pages" || A.tab === "site") renderLeft(); }
  else drawOverlay();
}
/* While typing: measure again, move anything below down if the text grew, and store the result */
function liveRelayout() {
  const site = $("#ce-site");
  A.lay = layoutAll(site, A.local, A.page, MK());
  if (bakeAll()) { syncVars(); A.lay = layoutAll(site, A.local, A.page, MK()); markChanged(A.page, "sections"); }
  sizeCanvas();
  drawOverlay();
}
function nearestField(elx, x, y) {
  let best = null, bd = Infinity;
  $$("[data-f]", elx).forEach((f) => {
    const r = f.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < bd) { bd = d; best = f; }
  });
  return best;
}

/* ---------- Drag engine (pointer events, mouse and touch) ---------- */
let D = null;
function listen() {
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd);
  window.addEventListener("pointercancel", cancelDrag);
}
function ghost(text) { const g = document.createElement("div"); g.className = "ce-ghost"; g.textContent = text; document.body.appendChild(g); return g; }
function goLive() {
  D.live = true;
  document.documentElement.classList.add("ce-dragging");
  if (D.tile) D.tile._dragged = true;
  if (D.kind === "new") D.ghost = ghost("Add: " + D.label);
  if (D.kind === "newsec") D.ghost = ghost("Add section: " + SEC_PRESETS[D.key].label);
  if (window.getSelection) window.getSelection().removeAllRanges();
  D.raf = requestAnimationFrame(scrollTick);
}
function onDragMove(ev) {
  if (!D || ev.pointerId !== D.pid) return;
  if (!D.live) { if (Math.hypot(ev.clientX - D.x0, ev.clientY - D.y0) < 4) return; goLive(); }
  ev.preventDefault();
  D.last = { clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey, altKey: ev.altKey };
  dragTick();
}
function dragTick() {
  const ev = D.last;
  if (!ev) return;
  if (D.ghost) D.ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
  if (D.kind === "move") moveTick(ev);
  else if (D.kind === "resize") resizeTick(ev);
  else if (D.kind === "rotate") rotateTick(ev);
  else if (D.kind === "sech") secTick(ev);
  else if (D.kind === "new") newTick(ev);
  else if (D.kind === "newsec") D.slot = sectionSlot(ev);
}
/* Keeps scrolling while the pointer rests near the top or bottom of the canvas */
function scrollTick() {
  if (!D || !D.live) return;
  const canvas = $("#ce-canvas"), r = canvas.getBoundingClientRect(), ev = D.last;
  if (ev && D.kind !== "rotate" && ev.clientX >= r.left && ev.clientX <= r.right) {
    let dy = 0;
    if (ev.clientY < r.top + 60) dy = -Math.ceil((r.top + 60 - ev.clientY) / 3);
    else if (ev.clientY > r.bottom - 60) dy = Math.ceil((ev.clientY - (r.bottom - 60)) / 3);
    if (dy) { const before = canvas.scrollTop; canvas.scrollTop += clamp(dy, -28, 28); if (canvas.scrollTop !== before) dragTick(); }
  }
  D.raf = requestAnimationFrame(scrollTick);
}
function endDrag(d) {
  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", onDragEnd);
  window.removeEventListener("pointercancel", cancelDrag);
  document.documentElement.classList.remove("ce-dragging");
  if (d.raf) cancelAnimationFrame(d.raf);
  if (d.ghost) d.ghost.remove();
  if (d.tile) setTimeout(() => { d.tile._dragged = false; }, 0);
  const line = $("#ce-drop");
  if (line) line.hidden = true;
}
function cancelDrag() {
  const d = D;
  if (!d) return;
  endDrag(d);
  D = null;
  if (d.kind === "new") A.hover = null;
  if (d.live && d.kind !== "new" && d.kind !== "newsec") renderCanvas(); else drawOverlay();
}
function onDragEnd(ev) {
  if (!D || ev.pointerId !== D.pid) return;
  const d = D;
  endDrag(d);
  D = null;
  if (!d.live) { if (d.onClick) d.onClick(); drawOverlay(); return; }
  if (d.kind === "move") commitMove(d);
  else if (d.kind === "resize") commitResize(d);
  else if (d.kind === "rotate") commitRotate(d);
  else if (d.kind === "sech") commitSecH(d);
  else if (d.kind === "new") { A.hover = null; commitNew(d, ev); }
  else if (d.kind === "newsec") { if (d.slot != null) addSection(d.key, d.slot); else drawOverlay(); }
  if (A.pendingRender && !A.editEl) { A.pendingRender = false; renderCanvas(); renderInsp(); }
}
const canvasDY = (ev) => (ev.clientY - D.y0 + $("#ce-canvas").scrollTop - D.st0) / A.z;
function secAtClientY(y) {
  const list = $$("#ce-site .fsec[data-sid]");
  if (!list.length) return null;
  for (const el of list) { const r = el.getBoundingClientRect(); if (y >= r.top && y < r.bottom) return el; }
  return y < list[0].getBoundingClientRect().top ? list[0] : list[list.length - 1];
}
/* Snap lines in a section: other elements' edges and centers, the middle and the sides of the layout */
function linesFor(sid, exclude) {
  const lay = A.lay && A.lay.secs[sid], W = LW();
  const xs = [0, W / 2, W], ys = [];
  if (lay) {
    lay.boxes.forEach((b, id) => { if (exclude.includes(id)) return; xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); });
    ys.push(lay.rh / 2);
  }
  return { xs, ys };
}
function snapVal(v, list, thr) {
  let best = null;
  list.forEach((t) => { const d = t - v; if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; });
  return best;
}
function snapBox(b, L, thr) {
  let bx = null, by = null;
  [b.x, b.x + b.w / 2, b.x + b.w].forEach((v) => { const s = snapVal(v, L.xs, thr); if (s && (!bx || Math.abs(s.d) < Math.abs(bx.d))) bx = s; });
  [b.y, b.y + b.h / 2, b.y + b.h].forEach((v) => { const s = snapVal(v, L.ys, thr); if (s && (!by || Math.abs(s.d) < Math.abs(by.d))) by = s; });
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, gx: bx ? bx.at : null, gy: by ? by.at : null };
}

function startMove(ev, itemRef) {
  const sid = A.sel.sid, lay = A.lay && A.lay.secs[sid];
  if (!lay) return;
  const start = selIds().map((id) => { const b = lay.boxes.get(id); return b ? { id, x: b.x, y: b.y, w: b.w, h: b.h } : null; }).filter(Boolean);
  if (!start.length) return;
  const x0 = Math.min(...start.map((s) => s.x)), y0 = Math.min(...start.map((s) => s.y));
  const u = { x: x0, y: y0, w: Math.max(...start.map((s) => s.x + s.w)) - x0, h: Math.max(...start.map((s) => s.y + s.h)) - y0 };
  D = {
    kind: "move", x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, live: false, st0: $("#ce-canvas").scrollTop,
    sid, start, u, ids: start.map((s) => s.id), g0: secGeo(sid), fdx: 0, fdy: 0, tsid: sid,
    onClick: () => { if (itemRef) { A.item = itemRef; A.open.add(itemRef); markSelection(); renderInsp(); } }
  };
  listen();
}
function moveTick(ev) {
  const z = A.z, dx = (ev.clientX - D.x0) / z, dy = canvasDY(ev);
  let tsid = D.sid;
  if (!isPhone()) { const se = secAtClientY(ev.clientY); if (se) tsid = se.dataset.sid; }
  const gt = tsid === D.sid ? D.g0 : secGeo(tsid);
  const off = D.g0.oy - gt.oy;
  let sn = { dx: 0, dy: 0, gx: null, gy: null };
  if (!ev.altKey) sn = snapBox({ x: D.u.x + dx, y: D.u.y + dy + off, w: D.u.w, h: D.u.h }, linesFor(tsid, D.ids), 7 / z);
  D.fdx = dx + sn.dx;
  D.fdy = dy + sn.dy;
  D.tsid = tsid;
  D.guides = sn.gx != null || sn.gy != null ? { sid: tsid, gx: sn.gx, gy: sn.gy } : null;
  const ph = isPhone();
  D.start.forEach((st) => {
    const el = elNode(D.sid, st.id);
    if (!el) return;
    el.style.setProperty("--py", "0px");
    el.style.setProperty(ph ? "--mx" : "--x", r1(st.x + D.fdx));
    el.style.setProperty(ph ? "--my" : "--y", r1(st.y + D.fdy));
  });
  drawOverlay();
}
function commitMove(d) {
  const src = secById(d.sid), tgt = secById(d.tsid) || src, k = MK(), W = LW();
  if (!src) return;
  beginChange();
  bakeSec(src);
  if (tgt !== src) bakeSec(tgt);
  const off = tgt === src ? 0 : d.g0.oy - secGeo(tgt.id).oy;
  const moved = [];
  d.start.forEach((st) => {
    const e = src.elements.find((x) => x.id === st.id);
    if (!e) return;
    const b = e[k] || { w: st.w, h: st.h };
    e[k] = { x: r1(clamp(st.x + d.fdx, 24 - st.w, W - 24)), y: r1(Math.max(0, st.y + d.fdy + off)), w: b.w, h: b.h };
    moved.push(e);
  });
  if (tgt !== src) {
    src.elements = src.elements.filter((e) => !moved.includes(e));
    moved.forEach((e) => { tgt.elements.push(e); e.m = null; });
    appendPhone(A.local, A.page, tgt, moved.filter((e) => !e.mHide));
  }
  growToFit(tgt, k);
  A.sel = { sid: tgt.id, ids: moved.map((e) => e.id) };
  commit(tgt === src ? "Moved." : `Moved to section ${secIndex(tgt.id) + 1}.`);
}

const imgPadX = (e) => (e.frame === "card" ? 60 : e.frame === "polaroid" ? 28 : 0);
function startResize(ev, h) {
  const ids = selIds();
  if (ids.length !== 1) return;
  const f = findEl(ids[0]), lay = f && A.lay && A.lay.secs[f.s.id];
  const b = lay && lay.boxes.get(f.e.id), el = f && elNode(f.s.id, f.e.id);
  if (!b || !el) return;
  const base = { x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, live: false, st0: $("#ce-canvas").scrollTop, sid: f.s.id, e: f.e, el, b0: Object.assign({}, b) };
  if (h === "rot") {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    D = Object.assign(base, { kind: "rotate", cx, cy, a0: Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI, r0: f.e.r, nr: f.e.r });
  } else {
    const padX = imgPadX(f.e), ph0 = Math.max(10, (b.w - padX) / (f.e.ar || 1.5));
    D = Object.assign(base, { kind: "resize", h, padX, ph0, k0: isPhone() && f.e.mk != null ? f.e.mk : f.e.k });
  }
  listen();
}
function resizeTick(ev) {
  const z = A.z, dx = (ev.clientX - D.x0) / z, dy = canvasDY(ev);
  const e = D.e, b0 = D.b0, h = D.h, size = EL[e.type].size, el = D.el, ph = isPhone();
  const E_ = h.includes("e"), W_ = h.includes("w"), N_ = h.includes("n"), S_ = h.includes("s");
  const minW = EL[e.type].minW || 20, thr = 7 / z;
  const L = ev.altKey ? null : linesFor(D.sid, [e.id]);
  const setV = (name, v) => el.style.setProperty((ph ? "--m" : "--") + name, r1(v));
  let x = b0.x, y = b0.y, w = b0.w;
  D.guides = null;
  el.style.setProperty("--py", "0px");
  if (size === "w" || (size === "img" && (h === "e" || h === "w"))) {
    if (E_) { let edge = b0.x + b0.w + dx; const s = L && snapVal(edge, L.xs, thr); if (s) { edge = s.at; D.guides = { sid: D.sid, gx: s.at }; } w = Math.max(minW, edge - b0.x); }
    if (W_) { let edge = b0.x + dx; const s = L && snapVal(edge, L.xs, thr); if (s) { edge = s.at; D.guides = { sid: D.sid, gx: s.at }; } w = Math.max(minW, b0.x + b0.w - edge); x = b0.x + b0.w - w; }
    if (size === "img") { D.ar = clamp((w - D.padX) / D.ph0, 0.25, 4); el.style.setProperty("--ar", D.ar); }
    setV("w", w);
    setV("x", x);
  } else if (size === "img" && (h === "n" || h === "s")) {
    const p = Math.max(24, D.ph0 + (S_ ? dy : -dy));
    D.ar = clamp((b0.w - D.padX) / p, 0.25, 4);
    el.style.setProperty("--ar", D.ar);
  } else if (size === "ar" || size === "img") {
    const f = Math.max((b0.w + (E_ ? dx : -dx)) / b0.w, (b0.h + (S_ ? dy : -dy)) / Math.max(1, b0.h));
    w = Math.max(minW, b0.w * f);
    if (W_) x = b0.x + b0.w - w;
    setV("w", w);
    setV("x", x);
  } else if (size === "k") {
    const f = Math.max(0.1, Math.max((b0.w + (E_ ? dx : -dx)) / b0.w, (b0.h + (S_ ? dy : -dy)) / Math.max(1, b0.h)));
    D.kk = Math.round(clamp((D.k0 || 1) * f, 0.2, 5) * 100) / 100;
    el.style.setProperty(ph ? "--mk" : "--k", D.kk);
  }
  const ah = el.offsetHeight, aw = el.offsetWidth;
  if (size === "k" && W_) { x = b0.x + b0.w - aw; setV("x", x); }
  if (N_) { y = b0.y + b0.h - ah; setV("y", y); }
  D.nb = { x, y, w: aw, h: ah };
  D.nw = w;
  drawOverlay();
}
function commitResize(d) {
  const s = secById(d.sid), e = d.e, k = MK(), size = EL[e.type].size;
  if (!s || !d.nb) { renderCanvas(); return; }
  beginChange();
  bakeSec(s);
  const content = size === "k" || size === "auto";
  /* Text and lists keep their old height here, so the redraw sees the growth and moves what's below them down */
  const keepH = size === "w" && !d.h.includes("n");
  e[k] = { x: r1(d.nb.x), y: r1(Math.max(0, d.nb.y)), w: r1(content ? d.nb.w : d.nw), h: r1(keepH ? d.b0.h : d.nb.h) };
  if (d.ar != null) e.ar = Math.round(d.ar * 10000) / 10000;
  if (d.kk != null) { if (k === "m") e.mk = d.kk; else e.k = d.kk; }
  growToFit(s, k);
  commit("Resized.");
}
function rotateTick(ev) {
  let a = D.r0 + Math.atan2(ev.clientY - D.cy, ev.clientX - D.cx) * 180 / Math.PI - D.a0;
  a = ((a + 540) % 360) - 180;
  if (ev.shiftKey) a = Math.round(a / 15) * 15;
  else if (Math.abs(a) < 3) a = 0;
  D.nr = Math.round(a * 10) / 10;
  D.el.style.setProperty("--r", D.nr);
  drawOverlay();
}
function commitRotate(d) {
  const s = secById(d.sid);
  if (!s) return;
  beginChange();
  bakeSec(s);
  d.e.r = d.nr;
  commit(`Rotated to ${Math.round(d.nr)} degrees.`);
}
function startSecResize(ev) {
  const sid = A.sel && A.sel.sid, lay = sid && A.lay && A.lay.secs[sid];
  if (!lay) return;
  let minH = 40;
  lay.boxes.forEach((b) => { minH = Math.max(minH, b.y + b.h + 8); });
  D = { kind: "sech", x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, live: false, st0: $("#ce-canvas").scrollTop, sid, h0: lay.rh, minH, el: secNode(sid) };
  listen();
}
function secTick(ev) {
  D.nh = r1(clamp(D.h0 + canvasDY(ev), D.minH, 20000));
  D.el.style.setProperty("--rh", D.nh);
  sizeCanvas();
  drawOverlay();
}
function commitSecH(d) {
  const s = secById(d.sid);
  if (!s || d.nh == null) { renderCanvas(); return; }
  beginChange();
  bakeSec(s);
  s[HK()] = d.nh;
  commit("Section height changed.");
}
function newTick(ev) {
  const cr = $("#ce-canvas").getBoundingClientRect();
  const inside = ev.clientX >= cr.left && ev.clientX <= cr.right && ev.clientY >= cr.top && ev.clientY <= cr.bottom;
  const se = inside ? secAtClientY(ev.clientY) : null;
  const over = se ? se.dataset.sid : null;
  if (over !== D.over) { D.over = over; A.hover = over ? { sid: over } : null; drawOverlay(); }
}
function commitNew(d, ev) {
  if (!d.over) { drawOverlay(); return; }
  const g = secGeo(d.over), fr = $("#ce-frame").getBoundingClientRect(), sc = (A.lay && A.lay.s) || 1;
  addElement(d.spec, d.over, { cx: ((ev.clientX - fr.left) / A.z - g.ox) / sc, cy: ((ev.clientY - fr.top) / A.z - g.oy) / sc });
}
function sectionSlot(ev) {
  const list = $$("#ce-site .fsec[data-sid]");
  const canvas = $("#ce-canvas"), cr = canvas.getBoundingClientRect(), line = $("#ce-drop");
  if (ev.clientX < cr.left || ev.clientX > cr.right) { line.hidden = true; return null; }
  const y = clamp(ev.clientY, cr.top + 1, cr.bottom - 1);
  let idx = list.length;
  for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; break; } }
  const sizer = $("#ce-sizer").getBoundingClientRect();
  const ly = !list.length ? sizer.top + 120 * A.z : idx < list.length ? list[idx].getBoundingClientRect().top : list[list.length - 1].getBoundingClientRect().bottom;
  line.hidden = false;
  line.style.top = (ly - cr.top + canvas.scrollTop) + "px";
  line.style.left = (sizer.left - cr.left + canvas.scrollLeft) + "px";
  line.style.width = sizer.width + "px";
  return idx;
}

/* ---------- Canvas events ---------- */
function bindCanvas() {
  const canvas = $("#ce-canvas"), site = $("#ce-site");
  canvas.addEventListener("pointerdown", (ev) => {
    if (!adminReady() || ev.button > 0 || D) return;
    const t = ev.target;
    if (t.closest(".ce-etools, .ce-stools, .ce-itools, .ce-photo-btn")) return;
    const hd = t.closest("[data-h]");
    if (hd) { ev.preventDefault(); stopEditing(); if (hd.dataset.h === "sec") startSecResize(ev); else startResize(ev, hd.dataset.h); return; }
    if (A.editEl && A.editEl.contains(t)) return;
    if (!site.contains(t)) { if (!t.closest("#ce-ov")) { stopEditing(); select(null); } return; }
    const ae = document.activeElement;
    if (ae && ae !== document.body && !site.contains(ae) && ae.blur) ae.blur();
    const secEl = t.closest(".fsec");
    if (!secEl) { stopEditing(); select(null); return; }
    ev.preventDefault();
    stopEditing();
    const sid = secEl.dataset.sid, elx = t.closest(".el");
    if (!elx) { select({ sid, sec: true }); return; }
    const eid = elx.dataset.eid;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { toggleSel(sid, eid); return; }
    const was = A.sel && A.sel.sid === sid && selIds().includes(eid);
    if (!was) select({ sid, ids: [eid] });
    const item = t.closest("[data-item]");
    startMove(ev, was && item ? item.dataset.item : null);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (D || ev.pointerType === "touch") return;
    const t = ev.target;
    const secEl = t.closest && t.closest("#ce-site .fsec"), elx = secEl && t.closest(".el");
    const hov = elx ? { sid: secEl.dataset.sid, eid: elx.dataset.eid } : secEl ? { sid: secEl.dataset.sid } : null;
    if (canon(hov) !== canon(A.hover)) { A.hover = hov; requestOverlay(); }
  });
  canvas.addEventListener("pointerleave", () => { if (!D && A.hover) { A.hover = null; requestOverlay(); } });
  canvas.addEventListener("dblclick", (ev) => {
    if (!adminReady()) return;
    const t = ev.target;
    if (A.editEl && A.editEl.contains(t)) return;
    if (!site.contains(t)) return;
    const elx = t.closest(".el");
    let f = t.closest("[data-f]");
    if (!elx) { if (f && f.closest(".site-footer")) startEditing(f, ev.clientX, ev.clientY); return; }
    if (!f) f = nearestField(elx, ev.clientX, ev.clientY);
    if (f) startEditing(f, ev.clientX, ev.clientY);
    else select({ sid: elx.closest(".fsec").dataset.sid, ids: [elx.dataset.eid] }, { openInsp: true, force: true });
  });
  site.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest("a")) ev.preventDefault();
    if (!adminReady()) return;
    const btn = t.closest("[data-act]");
    if (!btn) return;
    ev.preventDefault();
    const act = btn.dataset.act, item = btn.closest("[data-item]");
    if (act === "item-dup" && item) dupListItem(item.dataset.item);
    else if (act === "item-del" && item) delListItem(item.dataset.item);
    else if ((act === "item-prev" || act === "item-next") && item) { const ref = item.dataset.item, i = itemIndex(ref); moveListItem(ref.replace(/\.\d+$/, ""), i, i + (act === "item-prev" ? -1 : 1)); }
    else if (act === "photo") pickPhoto(btn.dataset.ref);
  });
  site.addEventListener("submit", (ev) => ev.preventDefault());
  site.addEventListener("input", (ev) => {
    const f = ev.target.closest && ev.target.closest("[data-f]");
    if (!f || f !== A.editEl || !adminReady()) return;
    const ref = f.dataset.f;
    let v = readText(f).replace(/ /g, " ");
    v = f.dataset.multi ? v.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "") : v.replace(/\s*\n\s*/g, " ");
    beginChange("f:" + ref);
    const doc = setRef(ref, v.slice(0, 4000));
    if (!doc) return;
    f.dataset.dirty = "1";
    markChanged(doc, docKey(doc, ref));
    const mirror = document.getElementById(fid(ref));
    if (mirror && mirror !== document.activeElement) mirror.value = v;
    syncItemTitle(ref, v);
    liveRelayout();
  });
  site.addEventListener("keydown", (ev) => {
    const f = ev.target.closest && ev.target.closest("[data-f]");
    if (!f || f !== A.editEl) return;
    if ((ev.key === "Enter" && !f.dataset.multi) || ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); stopEditing(); }
  });
  site.addEventListener("paste", (ev) => {
    const f = ev.target.closest && ev.target.closest("[data-f]");
    if (!f || f !== A.editEl) return;
    ev.preventDefault();
    let text = (ev.clipboardData && ev.clipboardData.getData("text/plain")) || "";
    if (!f.dataset.multi) text = text.replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text.slice(0, 4000));
  });
  site.addEventListener("focusout", (ev) => {
    const f = A.editEl;
    if (!f || ev.target !== f) return;
    setTimeout(() => { if (A.editEl === f && document.activeElement !== f) stopEditing(); }, 0);
  });
  site.addEventListener("dragstart", (ev) => ev.preventDefault());
}

/* ---------- Left panel ---------- */
function setTab(tab) {
  A.tab = tab;
  $$(".ce-tabs [data-tab]", admEl).forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false"));
  $("#ce-panel").setAttribute("aria-labelledby", "ce-tab-" + tab);
  renderLeft();
}
function addPanelHTML() {
  if (isPhone()) return '<p class="ce-note" style="margin-top:0">You\'re editing the phone layout. To add things, switch to Desktop. New things also go at the bottom of the phone layout.</p><button class="adm-btn adm-btn-line small" type="button" data-device="desktop">Switch to Desktop</button>';
  let h = '<p class="ce-note" style="margin-top:0">Click to add to the section in view, or drag onto the page.</p>';
  ADD_GROUPS.forEach((g) => {
    h += `<p class="ce-label">${esc(g.label)}</p>`;
    if (g.doodles) h += `<div class="ce-stiles">${Object.keys(SYMS).map((k) => { const d = SYMS[k]; return `<button type="button" class="ce-stile" data-add="d-${k}"><svg viewBox="0 0 ${d.vb[0]} ${d.vb[1]}" aria-hidden="true">${k === "arrow" ? ARROW_PATH : `<use href="#${k}" width="${d.vb[0]}" height="${d.vb[1]}"/>`}</svg><span>${esc(d.label)}</span></button>`; }).join("")}</div>`;
    else h += `<div class="ce-tiles">${g.tiles.map((t) => `<button type="button" class="ce-tile" data-add="${t[0]}"><b>${esc(t[1])}</b><span>${esc(t[2])}</span></button>`).join("")}</div>`;
  });
  h += `<p class="ce-label">Sections</p><div class="ce-tiles">${Object.keys(SEC_PRESETS).map((k) => `<button type="button" class="ce-tile" data-addsec="${k}"><b>${esc(SEC_PRESETS[k].label)}</b><span>${esc(SEC_PRESETS[k].desc)}</span></button>`).join("")}</div>`;
  h += '<p class="ce-note">Events, Speakers, Board members, Past events and Highlights are shared lists, so a change shows everywhere that list appears.</p>';
  return h;
}
function pagesPanelHTML() {
  const ready = adminReady(), ch = ready ? changedIds() : [];
  let h = `<p class="ce-label">Pages</p><ul class="ce-pages">${PAGES.map((p) => `<li><button class="adm-side-item" type="button" data-page="${p.id}"${p.id === A.page ? ' aria-current="page"' : ""}><span class="adm-side-num">${pageNum(p.id)}</span><span>${p.label}</span><span class="adm-dot"${ch.includes(p.id) ? "" : " hidden"}></span>${ch.includes(p.id) ? '<span class="sr-only">, has unpublished changes</span>' : ""}</button></li>`).join("")}</ul><p class="ce-label">Sections on ${esc(pageLabel(A.page))}</p>`;
  if (!ready) return h + '<p class="ce-note">Loading...</p>';
  const list = secs(), ids = selIds(), ph = isPhone();
  h += `<ol class="ce-layers">${list.map((s, i) => {
      const open = !!(A.sel && A.sel.sid === s.id);
      const rows = open ? `<ul class="ce-els">${s.elements.slice().reverse().map((e) => `<li><button type="button" class="ce-el-row${ids.includes(e.id) ? " is-sel" : ""}" data-sel-el="${e.id}" data-sid="${s.id}"><span>${esc(elName(e))}</span>${elSnippet(e) ? `<small>${esc(elSnippet(e))}</small>` : ""}${e.mHide ? "<em>not on phones</em>" : ""}</button></li>`).join("")}</ul>` : "";
      return `<li class="ce-layer${open ? " is-sel" : ""}"><div class="ce-layer-row"><button class="ce-layer-name" type="button" data-sel-sec="${s.id}">Section ${i + 1}<small>${s.elements.length} ${s.elements.length === 1 ? "thing" : "things"}</small></button>${ph ? "" : `<button class="adm-icon-btn" type="button" data-act="layer-up" data-sid="${s.id}" aria-label="Move section ${i + 1} up"${i === 0 ? " disabled" : ""}>${ICON.up}</button><button class="adm-icon-btn" type="button" data-act="layer-down" data-sid="${s.id}" aria-label="Move section ${i + 1} down"${i === list.length - 1 ? " disabled" : ""}>${ICON.down}</button>`}</div>${rows}</li>`;
    }).join("")}</ol>`;
  return h + '<p class="ce-note">Click anything on the page to select it. Drag to move it, pull the handles to resize or rotate, and double-click text to type. Shift-click selects several things.</p>';
}
function signupsHTML() {
  const rows = A.signups;
  if (rows === null) return '<p class="ce-note">Loading sign-ups...</p>';
  if (rows === "error") return '<p class="adm-help err">The sign-up list couldn\'t load. Reload the page to try again.</p>';
  const del = (r) => `<button class="adm-icon-btn danger${A.armed === "su:" + r.id ? " armed" : ""}" type="button" id="su-del-${r.id}" data-act="su-del" data-id="${r.id}" aria-label="${A.armed === "su:" + r.id ? "Press again to delete" : "Delete"} ${esc(r.email)}">${A.armed === "su:" + r.id ? "Delete?" : ICON.trash}</button>`;
  const card = (k, label) => `<section class="adm-card" style="margin-bottom:10px"><div class="adm-card-head"><h3 class="adm-card-title">${label} · ${rows[k].length}</h3><button class="copy-btn" type="button" data-copy="${esc(rows[k].map((r) => r.email).join("\n"))}" data-copy-target="adm-list-${k}">Copy all</button>${rows[k].length ? `<button class="copy-btn" type="button" data-act="su-csv" data-list="${k}">CSV</button>` : ""}</div>${rows[k].length ? `<ol class="ce-signups" id="adm-list-${k}">${rows[k].map((r) => `<li><span>${esc(r.email)}</span>${del(r)}</li>`).join("")}</ol>` : '<p class="adm-help">No sign-ups yet.</p>'}</section>`;
  return sheetHTML() + card("weekly", "Weekly email") + card("biohackathon", "Biohackathon") + '<p class="ce-note">Only board editors can see these. Delete takes someone off a list (and off the Google Sheet) when they ask.</p>';
}
/* Where sign-ups go: the board's Google Sheet, through the Worker (docs/NEWSLETTER.md). */
function sheetHTML() {
  const sh = A.sheet || { connected: false, waiting: 0 };
  if (sh.demo) return '<p class="ce-note">In the real site, sign-ups also go to the board\'s Google Sheet. The demo keeps them in this browser.</p>';
  if (!sh.connected) return '<p class="adm-help">The Google Sheet isn\'t connected yet, so sign-ups are kept here only. docs/NEWSLETTER.md says how to connect it.</p>';
  if (!sh.waiting) return '<p class="ce-note">Every sign-up is in the Google Sheet.</p>';
  return `<p class="adm-help">${sh.waiting} ${sh.waiting === 1 ? "sign-up isn't" : "sign-ups aren't"} in the Google Sheet yet. They're sent again every 15 minutes.</p><button class="adm-btn adm-btn-line small" type="button" data-act="su-sync" style="margin-bottom:10px">Send to the Sheet now</button>`;
}
async function syncSheet() {
  try {
    const out = await api.syncSignups();
    toast(out.sent ? `Sent ${out.sent} to the Google Sheet.` : "Nothing was waiting.");
  } catch (e) { setFlash((e && e.message) || "The Google Sheet didn't take the sign-ups. Try again in a few minutes.", true); }
  await loadSignups();
}
/* A spreadsheet of one list, made by the server (which records the download in the audit log). */
async function downloadCsv(list) {
  let csv;
  try { csv = await api.signupsCsv(list); } catch (_) { setFlash("The list couldn't download. Try again.", true); return; }
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "clip-" + list + "-signups.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/* Two clicks, like Discard: the first one arms the button. */
async function deleteSignup(id) {
  if (A.armed !== "su:" + id) {
    A.armed = "su:" + id;
    clearTimeout(A.armTimer);
    A.armTimer = setTimeout(() => { A.armed = null; if (A.tab === "site") renderLeft(); refreshChrome(); }, 4000);
    renderLeft();
    refreshChrome();
    return;
  }
  A.armed = null;
  clearTimeout(A.armTimer);
  try {
    const out = await api.deleteSignup(id);
    if (out.sheet === "failed") setFlash("Deleted here, but it couldn't be taken off the Google Sheet. Delete that row in the Sheet by hand.", true);
    else toast(out.sheet === "removed" ? "Deleted the sign-up, here and in the Google Sheet." : "Deleted the sign-up.");
  } catch (_) { setFlash("That sign-up couldn't be deleted. Try again.", true); }
  await loadSignups();
}
function renderLeft() {
  const panel = $("#ce-panel");
  if (!panel) return;
  const top = panel.scrollTop, ae = document.activeElement;
  const keep = ae && panel.contains(ae) && ae.id ? ae.id : null;
  if (A.tab === "add") panel.innerHTML = addPanelHTML();
  else if (A.tab === "pages") panel.innerHTML = pagesPanelHTML();
  else panel.innerHTML = `<p class="ce-label">Contact and footer</p>${SETTINGS_FIELDS.map((f) => fieldHTML(f, "G." + f.k, A.local.settings[f.k])).join("")}<p class="ce-label">Sign-ups</p>${signupsHTML()}`;
  panel.scrollTop = top;
  if (keep) { const el = document.getElementById(keep); if (el) el.focus({ preventScroll: true }); }
}
let leftTimer = null;
function renderLeftSoon() { clearTimeout(leftTimer); leftTimer = setTimeout(renderLeft, 300); }

/* ---------- Inspector (settings for the selection, and the keyboard path to every field) ---------- */
const fid = (ref) => "fi-" + ref.replace(/\./g, "-");
function fieldHTML(f, ref, value) {
  const id = fid(ref);
  if (f.t === "list") return listEditorHTML(f, ref, arr(value));
  if (f.t === "image") {
    const logo = value === "logo", src = logo ? "clip-logo.png" : blobSrc(value);
    const acts = (A.assets ? `<button class="adm-btn adm-btn-line small" type="button" id="${id}" data-act="photo" data-ref="${ref}">${src && !logo ? "Replace photo" : "Upload photo"}</button>` : "") + (f.logo && !logo ? `<button class="adm-btn adm-btn-line small" type="button" data-act="photo-logo" data-ref="${ref}">Use the logo</button>` : "") + (src ? `<button class="adm-btn adm-btn-line small" type="button" data-act="photo-clear" data-ref="${ref}">Remove</button>` : "");
    return `<div class="adm-field"><span class="adm-label">${esc(f.label)}</span><div class="adm-image"><div class="adm-thumb">${src ? `<img src="${src}" alt="">` : "No photo"}</div><div class="adm-image-actions">${acts}</div></div>${A.assets ? (f.help ? `<p class="adm-help">${esc(f.help)}</p>` : "") : '<p class="adm-help">Photo uploads open once the editor finishes loading. If they never appear, this view can\'t upload files.</p>'}</div>`;
  }
  if (f.t === "check") return `<label class="adm-check"><input type="checkbox" id="${id}" data-ref="${ref}" data-type="check"${value ? " checked" : ""}> ${esc(f.label)}</label>`;
  const help = f.help ? `<p class="adm-help" id="${id}__h">${esc(f.help)}</p>` : "";
  const da = f.help || f.t === "url" ? ` aria-describedby="${[f.help ? id + "__h" : "", f.t === "url" ? id + "__e" : ""].filter(Boolean).join(" ")}"` : "";
  let c;
  if (f.t === "textarea") c = `<textarea class="adm-input" id="${id}" rows="${f.rows || 3}" data-ref="${ref}"${da}>${esc(value)}</textarea>`;
  else if (f.t === "num") c = `<input class="adm-input" id="${id}" type="number" inputmode="decimal" step="${f.step || 1}" data-ref="${ref}" data-type="num" value="${esc(value)}"${da}>`;
  else if (f.t === "select" || f.t === "page" || f.t === "pg" || f.t === "ratio") {
    let opts = f.t === "page" ? [{ v: "", l: "No link" }].concat(PAGES.map((p) => ({ v: p.id, l: p.label })))
      : f.t === "pg" ? [{ v: "", l: "Nothing" }, { v: "this", l: "This page's number" }].concat(PAGES.map((p) => ({ v: p.id, l: `Link to ${p.label} (p. ${pageNum(p.id)})` })))
      : f.options;
    const same = (o) => (f.t === "ratio" ? Math.abs(o.v - value) < 0.001 : o.v === value);
    if (f.t === "ratio" && !opts.some(same)) opts = opts.concat([{ v: value, l: `Custom (${Math.round(value * 100) / 100} to 1)` }]);
    c = `<select class="adm-input" id="${id}" data-ref="${ref}"${f.t === "ratio" ? ' data-type="ratio"' : ""}${da}>${opts.map((o) => `<option value="${esc(o.v)}"${same(o) ? " selected" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  } else c = `<input class="adm-input" id="${id}" type="text" autocomplete="off" data-ref="${ref}"${f.t === "url" ? ' data-type="url" inputmode="url" spellcheck="false"' + (urlBad(value) ? ' aria-invalid="true"' : "") : ""} value="${esc(value)}"${da}>`;
  return `<div class="adm-field" id="${id}__w"><label class="adm-label" for="${id}">${esc(f.label)}</label>${c}${help}${f.t === "url" ? `<p class="adm-help err" id="${id}__e"${urlBad(value) ? "" : " hidden"}>That link won't work yet. Start it with https:// or use a page here like #events.</p>` : ""}</div>`;
}
function listEditorHTML(f, ref, items) {
  const n = items.length;
  const rows = items.map((it, i) => {
    const ir = `${ref}.${i}`, open = A.open.has(ir);
    const title = str(it && it[f.title]).trim() || `${f.item} ${i + 1}`;
    return `<div class="adm-item${open ? " is-open" : ""}" id="${fid(ir)}__w"><div class="adm-item-head"><button class="adm-item-toggle" type="button" data-act="ins-toggle" data-ref="${ir}" aria-expanded="${open}" aria-controls="${fid(ir)}__b">${ICON.chev}<span class="adm-item-title" data-item-title="${ir}">${esc(title)}</span></button><div class="adm-item-actions"><button class="adm-icon-btn" type="button" data-act="ins-up" data-ref="${ir}" aria-label="Move ${esc(title)} up"${i === 0 ? " disabled" : ""}>${ICON.up}</button><button class="adm-icon-btn" type="button" data-act="ins-down" data-ref="${ir}" aria-label="Move ${esc(title)} down"${i === n - 1 ? " disabled" : ""}>${ICON.down}</button><button class="adm-icon-btn danger" type="button" data-act="ins-del" data-ref="${ir}" aria-label="Delete ${esc(title)}">${ICON.trash}</button></div></div><div class="adm-item-body" id="${fid(ir)}__b"${open ? "" : " hidden"}>${f.fields.map((sf) => fieldHTML(sf, `${ir}.${sf.k}`, it[sf.k])).join("")}</div></div>`;
  }).join("");
  return `<div class="adm-list"><div class="adm-list-head"><span class="adm-label">${esc(f.label)}</span><span class="adm-count">${n}</span></div>${rows}<button class="adm-add" type="button" data-act="ins-add" data-ref="${ref}"${n >= (f.max || 40) ? " disabled" : ""}>+ Add ${esc(f.item.toLowerCase())}</button></div>`;
}
const closeBtn = '<button class="adm-btn adm-btn-line small ce-insp-close" type="button" data-act="insp-close">Close</button>';
const ibtn = (act, label, extra) => `<button class="adm-btn adm-btn-line small" type="button" data-act="${act}"${extra || ""}>${esc(label)}</button>`;
function inspElement(s, e) {
  const r = `E.${s.id}.${e.id}`, k = MK(), b = e[k], size = EL[e.type].size, ph = isPhone();
  const acts = (hasText(e) ? ibtn("el-edit", "Edit text on the page") : "") + (ph ? "" : ibtn("el-dup", "Duplicate")) + ibtn("el-front", "Forward") + ibtn("el-back", "Backward") + ibtn("el-mhide", ph || !e.mHide ? "Hide on phones" : "Show on phones") + (ph ? "" : ibtn("el-del", "Delete"));
  const L = e.type === "list" ? LISTS[e.src] : null;
  const shared = L && L.shared ? `<h3 class="adm-group">Shared list: ${esc(L.label)}</h3><p class="adm-group-help">One list feeds every ${esc(L.label.toLowerCase())} list, on any page.</p>${listEditorHTML(Object.assign({ t: "list" }, L), "D." + e.src, A.local.data[e.src])}` : "";
  const nums = [];
  if (b) {
    nums.push(fieldHTML({ t: "num", label: "From the left" }, `${r}.${k}.x`, b.x), fieldHTML({ t: "num", label: "From the top" }, `${r}.${k}.y`, b.y));
    if (size === "w" || size === "img" || size === "ar") nums.push(fieldHTML({ t: "num", label: "Width" }, `${r}.${k}.w`, b.w));
  }
  if (size === "k") nums.push(fieldHTML({ t: "num", label: "Scale", step: 0.05 }, `${r}.${ph ? "mk" : "k"}`, ph && e.mk != null ? e.mk : e.k));
  if (EL[e.type].rot) nums.push(fieldHTML({ t: "num", label: "Rotation (degrees)" }, `${r}.r`, e.r));
  const pos = `<h3 class="adm-group">${ph ? "Phone" : "Desktop"} position</h3>${ph && e.mHide ? '<p class="adm-group-help">Hidden on phones.</p>' : `<div class="ce-nums">${nums.join("")}</div><p class="adm-group-help">${ph ? "These change the phone layout only." : "These change the desktop layout only. Rotation applies to phones too."}</p>`}`;
  return `<div class="ce-insp-head"><div><p class="adm-kicker">Section ${secIndex(s.id) + 1} · ${esc(pageLabel(A.page))}</p><h2 class="adm-h1">${esc(elName(e))}</h2></div>${closeBtn}</div><div class="ce-insp-actions">${acts}</div>${fieldsOf(e).map((f) => fieldHTML(f, `${r}.${f.k}`, e[f.k])).join("")}${shared}${pos}`;
}
function inspMulti(s, els) {
  const al = (how, label) => `<button class="adm-btn adm-btn-line small" type="button" data-act="align" data-how="${how}">${label}</button>`;
  const ph = isPhone(), hidden = els.every((e) => e.mHide);
  return `<div class="ce-insp-head"><div><p class="adm-kicker">Section ${secIndex(s.id) + 1}</p><h2 class="adm-h1">${els.length} selected</h2></div>${closeBtn}</div>
<p class="adm-group-help">Drag any of them to move them together. Shift-click adds or removes one.</p>
<h3 class="adm-group">Line them up</h3><div class="ce-insp-actions">${al("left", "Left edges")}${al("center", "Centers")}${al("right", "Right edges")}${al("top", "Tops")}${al("middle", "Middles")}${al("bottom", "Bottoms")}</div>
<h3 class="adm-group">All of them</h3><div class="ce-insp-actions">${ph ? "" : ibtn("el-dup", "Duplicate")}${ibtn("el-mhide", ph || !hidden ? "Hide on phones" : "Show on phones")}${ph ? "" : ibtn("el-del", "Delete")}</div>`;
}
function inspSection(s) {
  const i = secIndex(s.id), n = secs().length, ph = isPhone(), hk = HK();
  const acts = ph ? ibtn("sec-arrange", "Re-arrange for phone") : ibtn("sec-up", "Move up", i === 0 ? " disabled" : "") + ibtn("sec-down", "Move down", i === n - 1 ? " disabled" : "") + ibtn("sec-dup", "Duplicate") + ibtn("sec-del", "Delete") + ibtn("sec-add", "Add a section below");
  const hidden = s.elements.filter((e) => e.mHide);
  const hid = ph ? `<h3 class="adm-group">Hidden on phones</h3>${hidden.length ? `<ul class="ce-hidden">${hidden.map((e) => `<li><span>${esc(elName(e))}${elSnippet(e) ? ` · ${esc(elSnippet(e))}` : ""}</span><button class="adm-btn adm-btn-line small" type="button" data-act="show-phone" data-eid="${e.id}">Show</button></li>`).join("")}</ul>` : '<p class="adm-group-help">Nothing. Everything in this section shows on phones.</p>'}` : "";
  return `<div class="ce-insp-head"><div><p class="adm-kicker">${esc(pageLabel(A.page))}</p><h2 class="adm-h1">Section ${i + 1} of ${n}</h2></div>${closeBtn}</div>
<div class="ce-insp-actions">${acts}</div>
${fieldHTML({ t: "select", label: "Background", options: BG_OPTS }, `S.${s.id}.bg`, s.bg)}
${fieldHTML({ t: "num", label: ph ? "Height on phones" : "Height on desktop", help: "Or drag the handle at the bottom edge of the section." }, `S.${s.id}.${hk}`, s[hk])}
<p class="adm-group-help">${ph ? "The phone layout is separate from desktop. Re-arrange rebuilds it from the desktop layout, top to bottom." : "Phones get their own layout of this section. Switch to Phone at the top to adjust it."}</p>${hid}`;
}
function inspPage() {
  const ch = changedIds();
  return `<div class="ce-insp-head"><div><p class="adm-kicker">Page ${pageNum(A.page)}</p><h2 class="adm-h1">${esc(pageLabel(A.page))}</h2></div>${closeBtn}</div>
<div class="adm-tip">Click anything on the page to select it. Drag it anywhere, pull the handles to resize or rotate, and double-click text to type.</div>
<p class="adm-group-help">${isPhone() ? "You're editing the phone layout. Changes here don't touch desktop." : "Desktop and phones have separate layouts. Things you add also go at the bottom of the phone layout."}</p>
<p class="adm-group-help">Keys: arrows nudge (Shift for bigger steps), Delete removes, Ctrl+D duplicates, Ctrl+C and Ctrl+V copy and paste, Ctrl+Z undoes. Hold Alt while dragging to skip the guides.</p>
<p class="adm-group-help">${ch.length ? `${ch.length} unpublished ${ch.length === 1 ? "change" : "changes"} across the site. Visitors see them after you press Publish.` : "Everything is published."}</p>`;
}
function renderInsp(focusRef) {
  const el = $("#ce-insp");
  if (!el) return;
  const ae = document.activeElement;
  const keep = ae && el.contains(ae) && ae.id ? ae.id : null;
  const caret = keep && typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null;
  const top = el.scrollTop;
  if (!adminReady()) { el.innerHTML = `<div class="ce-insp-head"><div><p class="adm-kicker">Settings</p><h2 class="adm-h1">Loading</h2></div>${closeBtn}</div>`; return; }
  validateSel();
  const sel = A.sel, s = sel && secById(sel.sid);
  let html;
  if (s && sel.ids && sel.ids.length === 1) { if (A.item) A.open.add(A.item); html = inspElement(s, s.elements.find((x) => x.id === sel.ids[0])); }
  else if (s && sel.ids) html = inspMulti(s, selEls());
  else if (s) html = inspSection(s);
  else html = inspPage();
  el.innerHTML = html;
  el.scrollTop = top;
  const want = focusRef ? document.getElementById(fid(focusRef)) : keep ? document.getElementById(keep) : null;
  if (want) { want.focus({ preventScroll: !focusRef }); if (caret && !focusRef) { try { want.setSelectionRange(caret[0], caret[1]); } catch (_) {} } }
  if (A.item && !keep) { const w = document.getElementById(fid(A.item) + "__w"); if (w) w.scrollIntoView({ block: "nearest" }); }
}
function onInspInput(ev) {
  const el = ev.target, ref = el.dataset && el.dataset.ref;
  if (!ref || !adminReady()) return;
  const ty = el.dataset.type;
  let v = el.value;
  if (ty === "check") v = !!el.checked;
  if (ty === "num") { if (!str(el.value).trim() || !Number.isFinite(Number(el.value))) return; v = Number(el.value); }
  if (ty === "ratio") v = Number(v);
  beginChange("i:" + ref);
  const doc = setRef(ref, v);
  if (!doc) return;
  if (ty === "url") { const bad = urlBad(el.value); el.setAttribute("aria-invalid", bad ? "true" : "false"); const e = document.getElementById(el.id + "__e"); if (e) e.hidden = !bad; }
  if (typeof v === "string") syncItemTitle(ref, v);
  markChanged(doc, docKey(doc, ref));
  if (el.tagName === "SELECT" || ty === "check") { renderCanvas({ bake: true }); renderInsp(); renderLeftSoon(); }
  else scheduleCanvas();
}
/* Keep a list row's header in the settings panel in step with the field that names it */
function syncItemTitle(ref, v) {
  const m = ref.match(/^(.*)\.(\d+)\.([^.]+)$/);
  if (!m) return;
  const def = listDef(m[1]);
  if (!def || def.title !== m[3]) return;
  const t = $(`[data-item-title="${m[1]}.${m[2]}"]`, admEl);
  if (t) t.textContent = str(v).trim() || `${def.item} ${+m[2] + 1}`;
}

/* ---------- Photos ---------- */
const fileEl = $("#adm-file");
let uploadRef = null;
function pickPhoto(ref) {
  if (!A.assets) { setFlash("Photo uploads aren't available in this view.", true); return; }
  uploadRef = { ref, page: A.page };
  fileEl.value = "";
  fileEl.click();
}
async function shrinkImage(file) {
  const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!ok.includes(file.type)) throw { code: "unsupported_type" };
  if (!window.createImageBitmap) return { blob: file, w: 0, h: 0 };
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (_) { return { blob: file, w: 0, h: 0 }; }
  const W = bmp.width, H = bmp.height;
  const k = Math.min(1, 1600 / Math.max(W, H));
  if (file.type === "image/gif" || (k === 1 && file.size < 1500000 && file.type !== "image/jpeg")) { if (bmp.close) bmp.close(); return { blob: file, w: W, h: H }; }
  const cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(H * k));
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = ch;
  const g = cv.getContext("2d");
  const png = file.type === "image/png";
  if (!png) { g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, cw, ch); }
  g.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const out = await new Promise((res) => cv.toBlob(res, png ? "image/png" : "image/jpeg", 0.86));
  return { blob: out || file, w: W, h: H };
}
function uploadErrorText(code) {
  if (code === "too_large") return "That photo is too big. Try one under 10 MB.";
  if (code === "unsupported_type") return "Use a JPG, PNG, WebP or GIF photo.";
  if (code === "quota_or_state") return "The site's photo storage is full.";
  if (code === "rate_limited") return "Too many uploads at once. Wait a moment and try again.";
  if (["not_granted", "capability_disabled", "capability_removed"].includes(code)) return "Photo uploads aren't available in this view.";
  return "The photo didn't upload. Try again.";
}
fileEl.addEventListener("change", async () => {
  const file = fileEl.files && fileEl.files[0], tgt = uploadRef;
  uploadRef = null;
  if (!file || !tgt || tgt.page !== A.page) return;
  setFlash("Uploading the photo...", false);
  try {
    const out = await shrinkImage(file);
    if (out.blob.size > MAX_PHOTO) throw { code: "too_large" };
    const res = await api.uploadPhoto(out.blob);
    stopEditing();
    beginChange();
    const had = str(getRef(tgt.ref));
    const doc = setRef(tgt.ref, res.id);
    const m = tgt.ref.match(/^E\.([^.]+)\.([^.]+)\.src$/);
    if (m && !had && out.w && out.h) { const t = target(`E.${m[1]}.${m[2]}`); if (t && t.obj.type === "image") t.obj.ar = Math.round(clamp(out.w / out.h, 0.25, 4) * 10000) / 10000; }
    if (doc) markChanged(doc, docKey(doc, tgt.ref));
    renderCanvas({ bake: true });
    renderInsp();
    setFlash("Photo added to the draft. Publish to show it on the site.", false);
  } catch (e) { setFlash(uploadErrorText(e && e.code), true); }
});

/* ---------- Saving drafts ---------- */
function markChanged(doc, k) {
  A.dirty[doc].add(k || "*");
  A.autoRetry = 0;
  A.flash = null;
  scheduleSave(doc);
  refreshChrome();
}
function scheduleSave(doc) { clearTimeout(A.timers[doc]); A.timers[doc] = setTimeout(() => flush(doc), 700); }
/* Every save sends the version it started from. If someone else saved that doc first, the Worker answers 409,
   their version is loaded, and Undo brings this editor's version back. */
function flush(doc) {
  clearTimeout(A.timers[doc]);
  A.timers[doc] = null;
  if (A.saving[doc]) return A.saving[doc];
  const keys = Array.from(A.dirty[doc]);
  if (!keys.length) return Promise.resolve();
  A.dirty[doc].clear();
  /* What gets saved is what norm() returns, so the Worker stores exactly this. A value norm() changes (a number
     typed in Settings with too many decimals, say) is put back on the page too, unless a drag or typing is on. */
  const body = norm(doc, A.local[doc]);
  if (canon(body) !== canon(A.local[doc]) && !D && !A.editEl) { A.local[doc] = clone(body); A.stale.add(doc); afterRemote(false); }
  let failed = false, conflicted = false;
  const p = (async () => {
    try {
      const res = await api.saveDraft(doc, A.ver[doc], body);
      A.ver[doc] = A.remoteVer[doc] = res.version;
      A.remote[doc] = res.doc;
      A.exists[doc] = true;
      A.saveError = null;
      A.autoRetry = 0;
    } catch (e) {
      failed = true;
      const code = (e && e.code) || "error";
      if (code === "conflict") { conflicted = true; return; }
      keys.forEach((k) => A.dirty[doc].add(k));
      A.saveError = code;
      if ((code === "unavailable" || code === "resource_exhausted") && A.autoRetry < 1) {
        A.autoRetry += 1;
        setTimeout(() => { if (A.dirty[doc].size && !A.saving[doc]) flush(doc); }, 1500 + Math.random() * 1500);
      }
      announce(saveErrorText(code));
    } finally {
      A.saving[doc] = null;
      if (!failed) {
        if (A.dirty[doc].size) scheduleSave(doc);
        else if (remoteHolds(doc, keys)) { adopt(doc); if (A.stale.size) afterRemote(false); }
      }
      refreshChrome();
    }
  })().then(() => (conflicted ? onConflict(doc) : undefined));
  A.saving[doc] = p;
  refreshChrome();
  return p;
}
async function onConflict(doc) {
  let d;
  try { d = await api.draft(doc); } catch (_) { A.saveError = "unavailable"; refreshChrome(); return; }
  stopEditing();
  beginChange();
  clearTimeout(A.timers[doc]);
  A.timers[doc] = null;
  A.dirty[doc].clear();
  A.remoteVer[doc] = d.version;
  A.remote[doc] = d.draft;
  if (d.published) { LIVE.docs[doc] = d.published; applyLive(LIVE.docs); }
  adopt(doc);
  A.stale.add(doc);
  afterRemote(false);
  renderInsp();
  setFlash(`Someone else changed ${docLabel(doc)} while you were editing, so it now shows their version. Undo brings yours back.`, true);
}
async function flushAll() {
  for (let round = 0; round < 4; round++) {
    const pending = DOC_IDS.filter((id) => busy(id));
    if (!pending.length) return;
    await Promise.all(pending.map((id) => (A.saving[id] ? A.saving[id] : flush(id))));
  }
}
function flushAllQuietly() { if (A.ok) DOC_IDS.forEach((id) => { if (A.dirty[id].size && !A.saving[id]) flush(id); }); }
function saveErrorText(code) {
  if (code === "invalid_argument") return "This draft couldn't save because it's in an old format. Reload the page.";
  if (code === "too_large") return "This page is too large to save. Remove something, then press Try again.";
  if (code === "revoked") return "Your sign-in changed. Reload the page.";
  if (code === "resource_exhausted") return "Saving too fast. Your changes will retry in a moment.";
  return "Couldn't save your last change. Check your connection, then press Try again.";
}
/* Every changed doc goes live at once, or none does. */
async function publish() {
  if (A.publishing || !adminReady()) return;
  stopEditing();
  A.publishing = true;
  A.flash = null;
  refreshChrome();
  let ok = false, count = 0, msg = "", conflict = false;
  try {
    await flushAll();
    if (DOC_IDS.some((id) => busy(id)) || A.saveError) throw { code: "save_failed" };
    const ids = changedIds();
    if (ids.length) {
      const versions = {};
      ids.forEach((id) => { versions[id] = A.ver[id]; });
      await api.publish(versions);
      ids.forEach((id) => { LIVE.docs[id] = clone(A.local[id]); });
      applyLive(LIVE.docs);
    }
    ok = true;
    count = ids.length;
  } catch (e) {
    conflict = !!(e && e.code === "conflict");
    msg = e && e.code === "save_failed" ? "Publishing stopped because a draft didn't save. Press Try again, then Publish."
      : conflict ? "Someone else changed a page you're publishing, so nothing was published. Their changes are loaded now. Check them, then press Publish again."
      : "Publishing didn't go through, so the site hasn't changed. Check your connection and press Publish again.";
  } finally { A.publishing = false; }
  if (conflict) await loadDocs();
  if (ok) { setFlash(count ? "Published. Visitors see the new version now." : "Everything was already published.", false); renderLeft(); }
  else setFlash(msg, true);
}
/* Every changed doc goes back to its published version, on the server all at once. Undo brings the changes back. */
async function discardAll() {
  const ids = changedIds();
  if (!ids.length) return;
  stopEditing();
  beginChange();
  for (const id of ids) {
    clearTimeout(A.timers[id]);
    A.timers[id] = null;
    if (A.saving[id]) { try { await A.saving[id]; } catch (_) {} }
    A.dirty[id].clear();
    A.local[id] = norm(id, LIVE.docs[id] || null);
  }
  A.sel = null;
  A.item = null;
  renderCanvas(); renderInsp(); renderLeft(); refreshChrome();
  const versions = {};
  ids.forEach((id) => { versions[id] = A.ver[id]; });
  try {
    const res = await api.discard(versions);
    ids.forEach((id) => { const d = res.docs[id]; if (d) { A.ver[id] = A.remoteVer[id] = d.version; A.remote[id] = d.draft; } });
    setFlash("Back to the published version. Undo brings your changes back.", false);
  } catch (e) {
    if (e && e.code === "conflict") { await loadDocs(); setFlash("Someone else changed one of these pages, so nothing was discarded. Their changes are loaded now.", true); }
    else { ids.forEach((id) => markChanged(id, "*")); setFlash("The drafts couldn't reset on the server yet. The editor keeps trying as it saves.", true); }
  }
}

/* ---------- Status ---------- */
function announce(text) { const el = $("#adm-announce"); if (!el) return; el.textContent = ""; setTimeout(() => { el.textContent = text; }, 30); }
function setFlash(text, err) {
  A.flash = { text, err };
  clearTimeout(A.flashTimer);
  if (!err) A.flashTimer = setTimeout(() => { A.flash = null; refreshChrome(); }, 6000);
  announce(text);
  refreshChrome();
}
function toast(text, withUndo) {
  const el = $("#ce-toast");
  if (!el) return;
  el.innerHTML = `<span>${esc(text)}</span>${withUndo ? '<button type="button" data-act="undo">Undo</button>' : ""}`;
  el.hidden = false;
  announce(text);
  clearTimeout(A.toastTimer);
  A.toastTimer = setTimeout(() => { el.hidden = true; }, withUndo ? 7000 : 3500);
}
function refreshChrome() {
  if (!A.ok) return;
  const ready = adminReady();
  const ch = ready ? changedIds() : [];
  const n = ch.length;
  const pub = $("#adm-publish");
  if (pub) { pub.disabled = !ready || !n || A.publishing; pub.textContent = A.publishing ? "Publishing..." : n ? "Publish" : "Published"; }
  const disc = $("#ce-discard");
  if (disc) { disc.disabled = !ready || !n || A.publishing; disc.textContent = A.armed === "discard" ? "Discard all?" : "Discard"; }
  const retry = $("#adm-retry");
  if (retry) retry.hidden = !A.saveError || A.saveError === "resource_exhausted";
  const sel = $("#ce-page");
  if (sel) { sel.value = A.page; $$("option", sel).forEach((o) => { o.textContent = pageLabel(o.value) + (ch.includes(o.value) ? " •" : ""); }); }
  $$(".ce-pages [data-page]", admEl).forEach((b) => { const dot = $(".adm-dot", b); if (dot) dot.hidden = !ch.includes(b.dataset.page); });
  $$("[data-zoom]", admEl).forEach((b) => b.setAttribute("aria-pressed", b.dataset.zoom === A.zoom ? "true" : "false"));
  refreshHistoryButtons();
  const st = $("#adm-status");
  if (!st) return;
  let text, err = false;
  if (!ready) text = A.loadSlow ? "The drafts are taking a while to load. Check your connection." : "Loading drafts...";
  else if (A.saveError) { text = saveErrorText(A.saveError); err = true; }
  else if (A.publishing) text = "Publishing...";
  else if (DOC_IDS.some((id) => busy(id))) text = "Saving draft...";
  else if (A.flash) { text = A.flash.text; err = A.flash.err; }
  else text = n ? "Draft saved. Changes go live when you press Publish." : "Everything is published.";
  if (st.textContent !== text) { st.textContent = text; st.title = text; }
  st.classList.toggle("is-error", err);
}

/* ---------- Shell events and keyboard ---------- */
function setDevice(d) {
  if (d === A.device) return;
  stopEditing();
  A.device = d;
  A.hover = null;
  $$("[data-device]", admEl).forEach((b) => { if (b.closest(".ce-seg")) b.setAttribute("aria-pressed", b.dataset.device === d ? "true" : "false"); });
  renderCanvas();
  renderInsp();
  renderLeft();
  const ids = selIds();
  if (ids.length) requestAnimationFrame(() => scrollIntoCanvas(elNode(A.sel.sid, ids[0])));
  else $("#ce-canvas").scrollTop = 0;
}
function onAdminClick(ev) {
  const t = ev.target;
  if (t.closest("#ce-site")) return;
  const tab = t.closest("[data-tab]");
  if (tab) { setTab(tab.dataset.tab); return; }
  const pg = t.closest("[data-page]");
  if (pg) { switchPage(pg.dataset.page); return; }
  const dev = t.closest("[data-device]");
  if (dev) { setDevice(dev.dataset.device); return; }
  const zm = t.closest("[data-zoom]");
  if (zm) { A.zoom = zm.dataset.zoom; refreshChrome(); sizeCanvas(); drawOverlay(); return; }
  const ss = t.closest("[data-sel-sec]");
  if (ss) { stopEditing(); select({ sid: ss.dataset.selSec, sec: true }, { force: true }); scrollToSec(ss.dataset.selSec); return; }
  const se = t.closest("[data-sel-el]");
  if (se) { stopEditing(); select({ sid: se.dataset.sid, ids: [se.dataset.selEl] }, { force: true }); scrollIntoCanvas(elNode(se.dataset.sid, se.dataset.selEl)); return; }
  const add = t.closest("[data-add]");
  if (add) { if (!add._dragged && ADD_SPECS[add.dataset.add]) addElement(ADD_SPECS[add.dataset.add].spec, clickTargetSection()); return; }
  const as = t.closest("[data-addsec]");
  if (as) { if (!as._dragged) addSection(as.dataset.addsec, A.sel && secById(A.sel.sid) ? secIndex(A.sel.sid) + 1 : secs().length); return; }
  const btn = t.closest("[data-act]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act, ref = btn.dataset.ref;
  if (act !== "discard-all" && act !== "su-del" && A.armed) { A.armed = null; clearTimeout(A.armTimer); refreshChrome(); }
  const one = selEls().length === 1 ? selEls()[0] : null;
  if (act === "publish") publish();
  else if (act === "undo") undo();
  else if (act === "redo") redo();
  else if (act === "retry") { A.saveError = null; A.flash = null; A.autoRetry = 0; flushAllQuietly(); refreshChrome(); }
  else if (act === "discard-all") { if (A.armed === "discard") { A.armed = null; discardAll(); } else { A.armed = "discard"; clearTimeout(A.armTimer); A.armTimer = setTimeout(() => { A.armed = null; refreshChrome(); }, 4000); refreshChrome(); } }
  else if (act === "insp-open") admEl.classList.add("insp-open");
  else if (act === "insp-close") admEl.classList.remove("insp-open");
  else if (act === "layer-up" || act === "layer-down") { const sid = btn.dataset.sid; moveSection(sid, secIndex(sid) + (act === "layer-up" ? -1 : 1)); if (A.tab === "pages") renderLeft(); const again = $(`[data-act="${act}"][data-sid="${sid}"]`, admEl); if (again && !again.disabled) again.focus(); }
  else if (act === "el-edit" && one) { const node = elNode(A.sel.sid, one.id), f = node && $("[data-f]", node); if (f) startEditing(f, null, null, true); else select(A.sel, { openInsp: true, force: true }); }
  else if (act === "el-settings") { admEl.classList.add("insp-open"); const f = $("#ce-insp .adm-input, #ce-insp input"); if (f) f.focus(); }
  else if (act === "el-photo" && one) pickPhoto(`E.${A.sel.sid}.${one.id}.src`);
  else if (act === "el-additem" && one) addListItem(elListRef(A.sel.sid, one));
  else if (act === "el-dup") dupSel();
  else if (act === "el-front") zOrder(1);
  else if (act === "el-back") zOrder(-1);
  else if (act === "el-mhide") phoneToggle();
  else if (act === "el-del") deleteSel();
  else if (act === "align") alignSel(btn.dataset.how);
  else if (act === "show-phone") showOnPhone(btn.dataset.eid);
  else if (act === "sec-up" || act === "sec-down") moveSection(A.sel.sid, secIndex(A.sel.sid) + (act === "sec-up" ? -1 : 1));
  else if (act === "sec-dup") dupSection(A.sel.sid);
  else if (act === "sec-del") delSection(A.sel.sid);
  else if (act === "sec-settings" || act === "sec-hidden") { select(A.sel, { openInsp: true, force: true }); }
  else if (act === "sec-arrange") arrangeSection(A.sel.sid);
  else if (act === "sec-add") { setTab("add"); toast("Pick a section at the bottom of the Add panel. It goes under the selected one."); const first = $("#ce-panel [data-addsec]"); if (first) first.scrollIntoView({ block: "nearest" }); }
  else if (act === "ins-toggle") { const open = !A.open.has(ref); if (open) A.open.add(ref); else A.open.delete(ref); btn.setAttribute("aria-expanded", String(open)); btn.closest(".adm-item").classList.toggle("is-open", open); const b = document.getElementById(btn.getAttribute("aria-controls")); if (b) b.hidden = !open; }
  else if (act === "ins-up" || act === "ins-down") { const lr = ref.replace(/\.\d+$/, ""), i = itemIndex(ref), j = i + (act === "ins-up" ? -1 : 1); const wasOpen = A.open.has(ref); A.open.delete(ref); if (wasOpen) A.open.add(`${lr}.${j}`); moveListItem(lr, i, j); const f = document.getElementById(fid(`${lr}.${j}`) + "__w"); if (f) { const b = f.querySelector(`[data-act="${act}"]`); if (b && !b.disabled) b.focus(); } }
  else if (act === "ins-del") delListItem(ref);
  else if (act === "ins-add") { const list = listAt(ref), def = listDef(ref); if (!list || !def || list.length >= (def.max || 40)) return; stopEditing(); beginChange(); list.push(newItem(ref)); const nr = `${ref}.${list.length - 1}`; A.open.add(nr); A.item = nr; listChanged(ref); const first = $(`#${CSS.escape(fid(nr))}__b input, #${CSS.escape(fid(nr))}__b textarea`, admEl); if (first) first.focus(); }
  else if (act === "su-csv") downloadCsv(btn.dataset.list);
  else if (act === "su-del") deleteSignup(btn.dataset.id);
  else if (act === "su-sync") syncSheet();
  else if (act === "photo") pickPhoto(ref);
  else if (act === "photo-clear" || act === "photo-logo") { stopEditing(); beginChange(); const doc = setRef(ref, act === "photo-logo" ? "logo" : ""); if (doc) markChanged(doc, docKey(doc, ref)); renderCanvas({ bake: true }); renderInsp(); }
}
function onKey(ev) {
  if (!A.ok) return;
  const t = ev.target;
  const typing = (t.closest && t.closest("[contenteditable]")) || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const mod = ev.metaKey || ev.ctrlKey;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (mod && key === "s") { ev.preventDefault(); flushAllQuietly(); return; }
  if (typing) return;
  if (mod && key === "z") { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
  if (mod && key === "y") { ev.preventDefault(); redo(); return; }
  if (D) return;
  if (key === "Escape") { if (A.sel && A.sel.ids) select({ sid: A.sel.sid, sec: true }); else select(null); admEl.classList.remove("insp-open"); return; }
  if (t.closest && t.closest("button, a, [role=tab]") && (key === "Enter" || key === " ")) return;
  if (mod && key === "d") { ev.preventDefault(); dupSel(); return; }
  if (mod && key === "c") { if (selIds().length) { ev.preventDefault(); copySel(); } return; }
  if (mod && key === "x") { if (selIds().length && !isPhone()) { ev.preventDefault(); if (copySel()) deleteSel(); } return; }
  if (mod && key === "v") { if (A.clip) { ev.preventDefault(); paste(); } return; }
  const sel = A.sel;
  if (!sel) return;
  if (key === "Delete" || key === "Backspace") { ev.preventDefault(); if (sel.ids) deleteSel(); else if (sel.sec && !isPhone()) delSection(sel.sid); return; }
  if (sel.ids && /^Arrow/.test(key)) {
    ev.preventDefault();
    const st = ev.shiftKey ? 10 : 1;
    nudge(key === "ArrowLeft" ? -st : key === "ArrowRight" ? st : 0, key === "ArrowUp" ? -st : key === "ArrowDown" ? st : 0);
    return;
  }
  if (sel.ids && sel.ids.length === 1 && key === "Enter") { const node = elNode(sel.sid, sel.ids[0]), f = node && $("[data-f]", node); if (f) { ev.preventDefault(); startEditing(f, null, null, true); } }
}
function bindAdmin() {
  bindCanvas();
  $("#ce-page").addEventListener("change", (ev) => switchPage(ev.target.value));
  admEl.addEventListener("click", onAdminClick);
  admEl.addEventListener("pointerdown", (ev) => {
    if (!adminReady() || ev.button > 0 || D || isPhone()) return;
    const add = ev.target.closest(".ce-tile[data-add], .ce-stile[data-add]");
    if (add && ADD_SPECS[add.dataset.add]) { add._dragged = false; D = { kind: "new", spec: ADD_SPECS[add.dataset.add].spec, label: ADD_SPECS[add.dataset.add].label, x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, live: false, tile: add }; listen(); return; }
    const as = ev.target.closest(".ce-tile[data-addsec]");
    if (as) { as._dragged = false; D = { kind: "newsec", key: as.dataset.addsec, x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, live: false, tile: as }; listen(); }
  });
  admEl.addEventListener("input", (ev) => { const el = ev.target; if (el.closest(".ce-insp, .ce-left") && el.type !== "checkbox" && el.tagName !== "SELECT") onInspInput(ev); });
  admEl.addEventListener("change", (ev) => { const el = ev.target; if (el.closest(".ce-insp, .ce-left") && (el.type === "checkbox" || el.tagName === "SELECT")) onInspInput(ev); });
  admEl.addEventListener("focusout", (ev) => { if (ev.target.dataset && ev.target.dataset.ref) A.histLock = null; });
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAllQuietly(); });
  window.addEventListener("pagehide", flushAllQuietly);
  window.addEventListener("focus", () => { if (A.ok && A.loaded && !D && !A.editEl) loadDocs(); });
}
function switchPage(id) {
  if (!VIEW_IDS.includes(id) || id === A.page) return;
  stopEditing();
  A.page = id;
  A.sel = null;
  A.item = null;
  A.hover = null;
  A.histLock = null;
  renderCanvas();
  $("#ce-canvas").scrollTop = 0;
  renderLeft();
  renderInsp();
  refreshChrome();
}

/* ---------- Copy buttons (the Site tab's Copy all), as on the public site ---------- */
document.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-copy]");
  if (!btn || btn.closest("#ce-site")) return;
  const text = btn.getAttribute("data-copy") || "";
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  const flash = (msg) => { btn.textContent = msg; clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = label; }, 1600); };
  const selectTarget = () => {
    const el = document.getElementById(btn.getAttribute("data-copy-target") || "");
    if (!el) return flash("Copy failed");
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    flash("Selected");
  };
  if (!text) return flash("Nothing yet");
  try { navigator.clipboard.writeText(text).then(() => flash("Copied"), selectTarget); } catch (_) { selectTarget(); }
});
/* Text wraps differently once the web fonts arrive, so lay the canvas out again. */
const onFonts = () => { if (A.ok && !D && !A.editEl) relayoutCanvas(); };
if (document.fonts) {
  document.fonts.ready.then(onFonts);
  if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", onFonts);
}
window.clipEditor = A;
openAdmin();
