/* Layout: scale, push-down and the phone layout, for the public site and the editor's canvas (one copy).
   Ported from the "Layout" part of prototype/clip-website.html, kept as it is: fitSite, pushDown, phoneSpot,
   layoutSection, layoutAll, measure, arrangePhone and appendPhone.

   The public site's browser has the markup but not the docs, so sectionFromMarkup() rebuilds what layoutSection
   needs from the attributes the Worker writes (data-d, data-m, m-hide, --z, --h and --mh). */

import { DW, MW, PHONE_BELOW, EL, clamp, r1 } from "./model.js";
import { elHTML, xyOrder } from "./render.js";

const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ================= Layout: scale, push-down and the phone layout =================
   The design box is a fixed size, so text wraps the same way on every screen. CSS scales the box to fit.
   After each render, layoutSection measures what the browser drew: if text or a list came out taller than
   its stored height, everything below it in the same column moves down by the difference, and the section
   grows so its bottom space stays the same. */
const siteGutter = (W) => clamp(W * 0.06, 32, 72);
function fitSite(siteEl, forced) {
  const W = siteEl.clientWidth || window.innerWidth || DW;
  const mode = forced || (W < PHONE_BELOW ? "m" : "d");
  const g = siteGutter(W);
  const s = Math.max(0.2, mode === "d" ? Math.min(1, (W - 2 * g) / DW) : Math.min(1.25, (W - 2 * g) / MW));
  const was = siteEl.classList.contains("is-m") ? "m" : "d";
  siteEl.classList.toggle("is-m", mode === "m");
  siteEl.style.setProperty("--s", String(Math.round(s * 10000) / 10000));
  return { mode, s, modeChanged: was !== mode };
}
function pushDown(items) {
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  sorted.forEach((it, i) => {
    it.push = 0;
    for (let j = 0; j < i; j++) {
      const a = sorted[j];
      if (a.y + a.h > it.y + 2) continue;
      if (a.x >= it.x + it.aw - 1 || it.x >= a.x + a.aw - 1) continue;
      const grow = a.push + Math.max(0, a.ah - a.h);
      if (grow > it.push) it.push = grow;
    }
  });
}
/* Where an element sits in a one-column phone stack: its width, and whether it is centered */
function phoneSpot(e) {
  const t = e.type, sz = EL[t].size;
  if (t === "image") return { w: Math.min(e.d.w, MW), center: true };
  if (t === "doodle") return { w: Math.min(e.d.w, 120), center: true };
  if (t === "note") return { w: Math.min(e.d.w, 280), center: true };
  if (t === "button") return { w: Math.min(e.d.w, MW), center: false };
  if (sz === "k") return { w: MW, center: true, content: true };
  if (sz === "auto") return { w: MW, center: false, content: true };
  return { w: MW, center: false };
}
function layoutSection(secEl, s, mode) {
  const inner = secEl.firstElementChild;
  if (!inner) return null;
  const nodes = new Map();
  Array.from(inner.children).forEach((el) => { if (el.dataset.eid) nodes.set(el.dataset.eid, el); });
  const items = [], auto = [];
  s.elements.forEach((e) => {
    const el = nodes.get(e.id);
    if (!el) return;
    el.style.removeProperty("--py");
    if (mode === "m" && e.mHide) return;
    const b = mode === "m" ? e.m : e.d;
    if (!b) { auto.push({ e, el }); return; }
    items.push({ e, el, x: b.x, y: b.y, w: b.w, h: b.h });
  });
  items.forEach((it) => { it.ah = it.el.offsetHeight; it.aw = it.el.offsetWidth; });
  pushDown(items);
  let stored = 0, bottom = 0;
  const boxes = new Map();
  items.forEach((it) => {
    if (it.push) it.el.style.setProperty("--py", it.push + "px");
    stored = Math.max(stored, it.y + it.h);
    bottom = Math.max(bottom, it.y + it.push + it.ah);
    boxes.set(it.e.id, { x: it.x, y: it.y + it.push, w: it.aw, h: it.ah });
  });
  const H = mode === "m" ? s.mh : s.h;
  let rh = Math.max(H + Math.max(0, bottom - stored), bottom);
  if (auto.length) {
    let y = bottom ? bottom + 24 : 32;
    auto.forEach(({ e, el }) => {
      const sp = phoneSpot(e);
      el.style.setProperty("--mw", sp.w);
      el.style.setProperty("--my", y);
      const aw = el.offsetWidth, ah = el.offsetHeight;
      const x = sp.center ? Math.max(0, (MW - aw) / 2) : 0;
      el.style.setProperty("--mx", x);
      boxes.set(e.id, { x, y, w: aw, h: ah, auto: true });
      y += ah + 24;
    });
    rh = Math.max(rh, y + 16);
  }
  secEl.style.setProperty("--rh", String(r1(rh)));
  return { mode, rh, boxes };
}
function layoutAll(siteEl, Cc, page, forced) {
  const fit = fitSite(siteEl, forced);
  const out = {};
  const list = Cc[page] ? Cc[page].sections : [];
  $$(".fsec[data-sid]", siteEl).forEach((secEl) => {
    const s = list.find((x) => x.id === secEl.dataset.sid);
    if (s) out[s.id] = layoutSection(secEl, s, fit.mode);
  });
  return { mode: fit.mode, s: fit.s, secs: out };
}

/* Offscreen measuring, for sizes in the layout that isn't on screen (the phone layout while editing desktop) */
let MEAS = null;
function measure(Cc, page, s, list, mode) {
  if (!MEAS) {
    MEAS = document.createElement("div");
    MEAS.className = "site ce-measure";
    MEAS.setAttribute("aria-hidden", "true");
    MEAS.setAttribute("inert", "");
    document.body.appendChild(MEAS);
  }
  MEAS.classList.toggle("is-m", mode === "m");
  MEAS.style.width = (mode === "m" ? 390 : 1324) + "px";
  MEAS.style.setProperty("--s", "1");
  const X = { C: Cc, edit: false, idp: "ms-" };
  MEAS.innerHTML = `<section class="fsec"><div class="fsec-inner">${list.map(({ e, w }) => {
      const c = Object.assign({}, e, { mHide: false });
      const b = { x: 0, y: 0, w, h: 0 };
      if (mode === "m") c.m = b; else c.d = b;
      return elHTML(X, s, c, 1, { page, weekly: true });
    }).join("")}</div></section>`;
  const out = new Map();
  $$(".el", MEAS).forEach((el) => out.set(el.dataset.eid, { w: el.offsetWidth, h: el.offsetHeight }));
  MEAS.innerHTML = "";
  return out;
}
/* A fresh phone layout for a section: the desktop reading order, stacked in one column.
   Doodles hide on phones. Buttons sit side by side when they fit. */
function arrangePhone(Cc, page, s) {
  s.elements.forEach((e) => { if (e.type === "doodle") e.mHide = true; });
  const vis = s.elements.filter((e) => !e.mHide);
  const order = xyOrder(vis);
  const spots = new Map(order.map((e) => [e.id, phoneSpot(e)]));
  const sizes = measure(Cc, page, s, order.map((e) => ({ e, w: spots.get(e.id).w })), "m");
  const top = vis.length ? Math.min(...vis.map((e) => e.d.y)) : 40;
  let y = clamp(Math.round(top * 0.6), 24, 64), prev = null, row = null;
  const inlineType = (e) => e && (e.type === "button" || e.type === "link");
  order.forEach((e) => {
    const sp = spots.get(e.id), sz = sizes.get(e.id) || { w: sp.w, h: 40 };
    const w = sp.content ? sz.w : sp.w;
    if (row && inlineType(prev) && inlineType(e) && row.x + 12 + w <= MW) {
      e.m = { x: r1(row.x + 12), y: r1(row.y), w: r1(w), h: r1(sz.h) };
      row.x += 12 + w;
      row.h = Math.max(row.h, sz.h);
      y = row.y + row.h;
    } else {
      if (prev) {
        const gap = e.d.y - (prev.d.y + prev.d.h);
        y += gap >= 0 && gap < 240 ? clamp(Math.round(gap * 0.7), 8, 40) : 28;
      }
      const x = sp.center ? Math.max(0, (MW - w) / 2) : 0;
      e.m = { x: r1(x), y: r1(y), w: r1(w), h: r1(sz.h) };
      row = { x: x + w, y, h: sz.h };
      y += sz.h;
    }
    prev = e;
  });
  const bottomD = vis.length ? Math.max(...vis.map((e) => e.d.y + e.d.h)) : 0;
  s.mh = r1(Math.max(80, y + clamp(Math.round((s.h - bottomD) * 0.6), 24, 72)));
}
/* New elements made on desktop go under everything else in the phone layout */
function appendPhone(Cc, page, s, list) {
  if (!list.length) return;
  const rest = s.elements.filter((e) => !e.mHide && e.m && !list.includes(e));
  let y = rest.length ? Math.max(...rest.map((e) => e.m.y + e.m.h)) : 16;
  const spots = new Map(list.map((e) => [e.id, phoneSpot(e)]));
  const sizes = measure(Cc, page, s, list.map((e) => ({ e, w: spots.get(e.id).w })), "m");
  list.forEach((e) => {
    const sp = spots.get(e.id), sz = sizes.get(e.id) || { w: sp.w, h: 40 };
    const w = sp.content ? sz.w : sp.w;
    y += 24;
    e.m = { x: r1(sp.center ? Math.max(0, (MW - w) / 2) : 0), y: r1(y), w: r1(w), h: r1(sz.h) };
    y += sz.h;
  });
  s.mh = r1(Math.max(s.mh, y + 40));
}

export { siteGutter, fitSite, pushDown, phoneSpot, layoutSection, layoutAll, measure, arrangePhone, appendPhone };

/* ---------- The public site ---------- */
const boxOf = (v) => {
  if (!v) return null;
  const [x, y, w, h] = v.split(",").map(Number);
  return { x, y, w, h };
};
/** A section's data, read back from its markup. */
export function sectionFromMarkup(secEl) {
  const num = (k) => parseFloat(secEl.style.getPropertyValue(k)) || 0;
  const els = $$(":scope > .fsec-inner > .el", secEl).map((el) => ({
    z: parseFloat(el.style.getPropertyValue("--z")) || 0,
    e: {
      id: el.dataset.eid,
      type: (el.className.match(/\bel-([a-z]+)\b/) || [])[1] || "text",
      d: boxOf(el.dataset.d) || { x: 0, y: 0, w: DW, h: 0 },
      m: boxOf(el.dataset.m),
      mHide: el.classList.contains("m-hide"),
    },
  }));
  els.sort((a, b) => a.z - b.z);
  return { id: secEl.dataset.sid, h: num("--h"), mh: num("--mh"), elements: els.map((x) => x.e) };
}
/** Fit the public site to the screen and lay out every section, again whenever the layout mode or the fonts change. */
export function attachLayout(siteEl) {
  const all = () => {
    const fit = fitSite(siteEl);
    $$(".fsec[data-sid]", siteEl).forEach((secEl) => layoutSection(secEl, sectionFromMarkup(secEl), fit.mode));
  };
  all();
  if (window.ResizeObserver) {
    let lastW = -1;
    new ResizeObserver(() => {
      const w = siteEl.clientWidth;
      if (w === lastW || !w) return;
      lastW = w;
      if (fitSite(siteEl).modeChanged) all();
    }).observe(siteEl);
  } else window.addEventListener("resize", () => { if (fitSite(siteEl).modeChanged) all(); });
  const toHash = () => {
    if (location.hash.length < 2) return;
    let id = location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch (_) { /* keep it as it is */ }
    const t = document.getElementById(id);
    if (t) t.scrollIntoView();
  };
  if (document.fonts) {
    document.fonts.ready.then(() => { all(); toHash(); });
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", all);
  }
  toHash();
  return all;
}
