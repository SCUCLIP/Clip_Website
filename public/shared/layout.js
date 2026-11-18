/* Layout for the public site and the editor canvas (one copy, used by both).
   Every element stores a desktop box (data-d) and a phone box (data-m) as x,y,width,height in design pixels.
   Desktop boxes sit in a 1180px-wide design box, phone boxes in a 326px one. CSS scales the box by --s.
   Taken from the original export's site.js. */

import { DW, MW, PHONE_BELOW } from "./pages.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const boxOf = (v) => (v ? v.split(",").map(Number) : null);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/** The layout mode ("d" desktop or "m" phone) and scale for a container this wide. `force` picks the mode. */
export function fitScale(width, force) {
  const W = width || DW;
  const mode = force || (W < PHONE_BELOW ? "m" : "d");
  const g = clamp(W * 0.06, 32, 72);
  const s = Math.max(0.2, mode === "d" ? Math.min(1, (W - 2 * g) / DW) : Math.min(1.25, (W - 2 * g) / MW));
  return { mode, s: Math.round(s * 10000) / 10000 };
}

/** Set the mode class and --s on the .site element. Returns the mode. */
export function applyFit(site, force) {
  const { mode, s } = fitScale(site.clientWidth || window.innerWidth || DW, force);
  site.classList.toggle("is-m", mode === "m");
  site.style.setProperty("--s", String(s));
  return mode;
}

/**
 * Lay out every section under `root` for `mode`.
 * - push: move elements down when something above them renders taller than its stored box (the public site).
 *   The editor turns this off so elements sit exactly where they're stored.
 * - Elements with no phone box (and not hidden on phones) are stacked at the bottom of the section on phones.
 * - Sets --rh, the drawn height of each section.
 */
export function layoutSections(root, mode, { push = true } = {}) {
  $$(".fsec", root).forEach((sec) => {
    const H = parseFloat(sec.style.getPropertyValue(mode === "m" ? "--mh" : "--h")) || 0;
    const items = [], auto = [];
    $$(":scope > .fsec-inner > .el", sec).forEach((el) => {
      el.style.removeProperty("--py");
      if (el.classList.contains("m-auto") && !el.dataset.m) { el.style.removeProperty("--mx"); el.style.removeProperty("--my"); el.style.removeProperty("--mw"); }
      if (mode === "m" && el.classList.contains("m-hide")) return;
      const b = boxOf(mode === "m" ? el.dataset.m : el.dataset.d);
      if (!b) { auto.push(el); return; }
      items.push({ el, x: b[0], y: b[1], h: b[3], ah: el.offsetHeight, aw: el.offsetWidth });
    });
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    items.forEach((it, i) => {
      it.push = 0;
      if (!push) return;
      for (let j = 0; j < i; j++) {
        const a = items[j];
        if (a.y + a.h > it.y + 2) continue;
        if (a.x >= it.x + it.aw - 1 || it.x >= a.x + a.aw - 1) continue;
        it.push = Math.max(it.push, a.push + Math.max(0, a.ah - a.h));
      }
    });
    let stored = 0, bottom = 0;
    items.forEach((it) => {
      if (it.push) it.el.style.setProperty("--py", it.push + "px");
      stored = Math.max(stored, it.y + it.h);
      bottom = Math.max(bottom, it.y + it.push + it.ah);
    });
    let rh = push ? Math.max(H + Math.max(0, bottom - stored), bottom) : Math.max(H, bottom);
    if (auto.length) {
      let y = bottom ? bottom + 24 : 32;
      auto.forEach((el) => { el.style.setProperty("--mx", 0); el.style.setProperty("--my", y); el.style.setProperty("--mw", MW); y += el.offsetHeight + 24; });
      rh = Math.max(rh, y + 16);
    }
    sec.style.setProperty("--rh", String(Math.round(rh * 10) / 10));
  });
}

/** The public site: fit to the screen, lay out, and do it again when the size or the fonts change. */
export function attachLayout(site) {
  let mode = null;
  const relayout = (force) => {
    const m = applyFit(site);
    if (force || m !== mode) { mode = m; layoutSections(site, m); }
  };
  relayout(true);
  if (window.ResizeObserver) new ResizeObserver(() => relayout(false)).observe(site);
  else window.addEventListener("resize", () => relayout(false));
  const toHash = () => {
    if (location.hash.length > 1) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) t.scrollIntoView({ behavior: "instant" });
    }
  };
  if (document.fonts) {
    document.fonts.ready.then(() => { relayout(true); toHash(); });
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => relayout(true));
  }
  toHash();
  return relayout;
}
