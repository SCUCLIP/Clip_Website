/* The editor canvas: the page rendered with the shared render code, plus the selection overlay.
   - Click selects; Shift-click adds or removes; click empty space selects the section.
   - Drag moves (with snap guides; hold Alt to turn snapping off). Dropping on another section moves it there.
   - Handles resize (sides) and scale (corner); the round handle rotates (Shift: 15° steps).
   - The bar under each section changes its height.
   - Double-click any text to type in place. Rich text gets a small formatting toolbar. */

import { renderMain, renderHeader, renderFooter } from "/shared/render.js";
import { applyFit, layoutSections } from "/shared/layout.js";
import { sanitizeRich, escapeText } from "/shared/rich.js";
import { ELEMENT_FIELDS, LIST_FIELDS } from "/shared/norm.js";
import { findEl, findSection, boxOf, setBox, fitSection, getPath, setPath, designWidth, sectionHeightKey } from "./model.js";

const VAR = { d: { x: "--x", y: "--y", w: "--w", k: "--k" }, m: { x: "--mx", y: "--my", w: "--mw", k: "--mk" } };
const SCALES = new Set(["figure", "stamp"]);          /* sized by zoom (--k), not width */
const PROPORTIONAL = new Set(["image", "doodle"]);    /* height follows width */
const num = (v) => parseFloat(v) || 0;

/** Is this field rich text? Uses the shared schema. */
export function fieldKind(el, path) {
  const parts = path.split(".");
  if (parts[0] === "items" && el.type === "list") return LIST_FIELDS[el.kind]?.[parts[2]]?.t ?? "plain";
  return ELEMENT_FIELDS[el.type]?.[parts[0]]?.t ?? "plain";
}

/** contenteditable DOM -> canonical rich text. */
export function serializeRich(root) {
  const walk = (n) => {
    let out = "";
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { out += escapeText(c.nodeValue); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (t === "BR") out += "<br>";
      else if (t === "B" || t === "STRONG") out += "<b>" + walk(c) + "</b>";
      else if (t === "I" || t === "EM") out += "<i>" + walk(c) + "</i>";
      else if (t === "SUB") out += "<sub>" + walk(c) + "</sub>";
      else if (t === "SUP") out += "<sup>" + walk(c) + "</sup>";
      else if (t === "SPAN" && c.classList.contains("hl")) out += '<span class="hl">' + walk(c) + "</span>";
      else if (t === "DIV" || t === "P") out += (out && !out.endsWith("<br>") ? "<br>" : "") + walk(c);
      else out += walk(c);
    }
    return out;
  };
  return sanitizeRich(walk(root)).replace(/^(<br>)+|(<br>)+$/g, "");
}

export class Canvas {
  constructor(app, wrap) {
    this.app = app;
    this.wrap = wrap;
    this.site = document.createElement("div");
    this.site.className = "site ed-site";
    wrap.appendChild(this.site);
    this.drag = null;
    this.editing = null;
    this.guides = [];
    this.site.addEventListener("pointerdown", (e) => this.onDown(e));
    this.site.addEventListener("pointermove", (e) => this.onMove(e));
    this.site.addEventListener("pointerup", (e) => this.onUp(e));
    this.site.addEventListener("pointercancel", (e) => this.onUp(e, true));
    this.site.addEventListener("dblclick", (e) => this.onDblClick(e));
    this.site.addEventListener("click", (e) => { if (!e.target.closest("[contenteditable]")) e.preventDefault(); });
    this.site.addEventListener("submit", (e) => e.preventDefault());
    this.site.addEventListener("dragstart", (e) => e.preventDefault());
    new ResizeObserver(() => { if (!this.drag) this.relayout(); }).observe(wrap);
    this.toolbar = document.getElementById("ed-rtb");
    this.toolbar.addEventListener("mousedown", (e) => e.preventDefault());
    this.toolbar.addEventListener("click", (e) => this.onToolbar(e));
  }

  get mode() { return this.app.mode; }
  get scale() { return num(this.site.style.getPropertyValue("--s")) || 1; }
  node(id) { return this.site.querySelector(`.fsec-inner > .el[data-eid="${CSS.escape(id)}"]`); }
  secNode(sid) { return this.site.querySelector(`.fsec[data-sid="${CSS.escape(sid)}"]`); }

  /* ---------- Rendering ---------- */
  render() {
    if (this.editing) this.finishEdit(false);
    const app = this.app, page = app.doc(), site = app.doc("site");
    const top = this.wrap.scrollTop;
    this.site.innerHTML = `<div class="page">${renderHeader(site, page.id)}\n${renderMain(page, { site, editor: true })}\n${renderFooter(site)}</div>`;
    this.relayout();
    this.wrap.scrollTop = top;
  }

  relayout() {
    const phone = this.mode === "m";
    this.site.classList.toggle("ed-phone", phone);
    applyFit(this.site, this.mode);
    layoutSections(this.site, this.mode, { push: false });
    this.drawOverlay();
  }

  /** Where an element is drawn, in design px, read from the rendered node (so it covers auto-stacked phone elements). */
  shown(node) {
    const v = VAR[this.mode];
    return { x: num(node.style.getPropertyValue(v.x)), y: num(node.style.getPropertyValue(v.y)), w: node.offsetWidth, h: node.offsetHeight, r: num(node.style.getPropertyValue("--r")) };
  }

  drawOverlay() {
    this.site.querySelectorAll(".ed-ov").forEach((n) => n.remove());
    const app = this.app;
    const one = app.sel.size === 1 ? findEl(app.doc(), [...app.sel][0]) : null;
    for (const secNode of this.site.querySelectorAll(".fsec")) {
      const sid = secNode.dataset.sid;
      const sec = findSection(app.doc(), sid);
      const inner = secNode.querySelector(".fsec-inner");
      const ov = document.createElement("div");
      ov.className = "ed-ov" + (app.selSection === sid ? " is-sec" : "");
      const bar = document.createElement("div");
      bar.className = "ed-sec-h";
      bar.dataset.h = "sech";
      bar.dataset.sid = sid;
      bar.title = "Drag to change the section's height";
      bar.style.setProperty("top", (sec ? sec[sectionHeightKey(this.mode)] : 0) + "px");
      ov.appendChild(bar);
      for (const id of app.sel) {
        const node = inner.querySelector(`:scope > .el[data-eid="${CSS.escape(id)}"]`);
        if (!node || node.offsetParent === null) continue;
        const b = this.shown(node);
        const box = document.createElement("div");
        box.className = "ed-sel";
        box.dataset.for = id;
        box.style.setProperty("left", b.x + "px");
        box.style.setProperty("top", b.y + "px");
        box.style.setProperty("width", b.w + "px");
        box.style.setProperty("height", b.h + "px");
        box.style.setProperty("transform", `rotate(${b.r}deg)`);
        if (one && one.el.id === id && !this.editing) {
          const handles = SCALES.has(one.el.type) ? ["se", "rot"] : PROPORTIONAL.has(one.el.type) ? ["w", "e", "se", "rot"] : ["w", "e", "rot"];
          for (const h of handles) {
            const d = document.createElement("div");
            d.className = "ed-h ed-h-" + h;
            d.dataset.h = h;
            d.title = h === "rot" ? "Drag to rotate (Shift: 15° steps)" : "Drag to resize";
            box.appendChild(d);
          }
        }
        ov.appendChild(box);
      }
      for (const g of this.guides) {
        if (g.sid !== sid) continue;
        const d = document.createElement("div");
        d.className = "ed-guide " + (g.x !== undefined ? "is-v" : "is-h");
        d.style.setProperty(g.x !== undefined ? "left" : "top", (g.x ?? g.y) + "px");
        ov.appendChild(d);
      }
      inner.appendChild(ov);
    }
  }

  /* ---------- Pointer ---------- */
  onDown(ev) {
    if (ev.button !== 0) return;
    if (this.editing) {
      if (this.editing.node.contains(ev.target)) return;
      this.finishEdit(true);
    }
    const app = this.app;
    const handle = ev.target.closest("[data-h]");
    if (handle) {
      ev.preventDefault();
      if (handle.dataset.h === "sech") return this.startSectionHeight(ev, handle.dataset.sid);
      return this.startHandle(ev, handle.dataset.h, handle.closest(".ed-sel").dataset.for);
    }
    const elNode = ev.target.closest(".fsec-inner > .el");
    if (elNode) {
      ev.preventDefault();
      const id = elNode.dataset.eid;
      if (ev.shiftKey) { app.toggleSelect(id); return; }
      if (!app.sel.has(id)) app.select([id]);
      return this.startMove(ev, [...app.sel]);
    }
    const sec = ev.target.closest(".fsec");
    if (sec) { app.selectSection(sec.dataset.sid); return; }
    if (ev.target.closest(".site-header, .site-footer")) { app.openPage("site"); return; }
    app.select([]);
  }

  /* The pointer is captured only once the drag really moves: while it's captured, click and dblclick are sent
     to the canvas instead of the element under the pointer, which would break double-click to type. */
  capture(ev, drag) {
    this.drag = { ...drag, sx: ev.clientX, sy: ev.clientY, s: this.scale, moved: false, pid: ev.pointerId };
  }

  startMove(ev, ids) {
    const items = ids.map((id) => ({ id, node: this.node(id) })).filter((it) => it.node && it.node.offsetParent !== null)
      .map((it) => ({ ...it, b0: this.shown(it.node), sid: it.node.closest(".fsec").dataset.sid }));
    if (!items.length) return;
    this.capture(ev, { kind: "move", items });
  }

  startHandle(ev, h, id) {
    const node = this.node(id);
    const f = findEl(this.app.doc(), id);
    if (!node || !f) return;
    const b = this.shown(node);
    const rect = node.getBoundingClientRect();
    const k0 = this.mode === "m" ? (f.el.mk ?? f.el.k ?? 1) : (f.el.k ?? 1);
    this.capture(ev, { kind: h === "rot" ? "rotate" : "resize", h, id, node, b0: b, k0, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
  }

  startSectionHeight(ev, sid) {
    const sec = findSection(this.app.doc(), sid);
    if (!sec) return;
    this.app.selectSection(sid, { keepOverlay: true });
    this.capture(ev, { kind: "sech", sid, h0: sec[sectionHeightKey(this.mode)] });
  }

  onMove(ev) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pid) return;
    const rx = ev.clientX - d.sx, ry = ev.clientY - d.sy;
    if (!d.moved && Math.hypot(rx, ry) < 3) return;
    if (!d.moved) { try { this.site.setPointerCapture(d.pid); } catch { /* ignore */ } }
    d.moved = true;
    const dx = rx / d.s, dy = ry / d.s;
    const v = VAR[this.mode];
    if (d.kind === "move") {
      const snapped = ev.altKey ? { dx, dy, guides: [] } : this.snap(d.items, dx, dy);
      d.dx = snapped.dx; d.dy = snapped.dy;
      for (const it of d.items) {
        it.node.style.setProperty(v.x, String(Math.round((it.b0.x + d.dx) * 10) / 10));
        it.node.style.setProperty(v.y, String(Math.round((it.b0.y + d.dy) * 10) / 10));
      }
      this.guides = snapped.guides;
      this.drawOverlay();
    } else if (d.kind === "resize") {
      const r = (d.b0.r * Math.PI) / 180;
      const local = dx * Math.cos(r) + dy * Math.sin(r);
      const el = findEl(this.app.doc(), d.id)?.el;
      if (!el) return;
      if (SCALES.has(el.type)) {
        d.k = Math.max(0.1, Math.min(8, Math.round(d.k0 * ((d.b0.w + local) / d.b0.w) * 100) / 100));
        d.node.style.setProperty(v.k, String(d.k));
      } else {
        let w = d.h === "w" ? d.b0.w - local : d.b0.w + local;
        w = Math.max(8, Math.min(designWidth(this.mode) * 2, w));
        d.w = Math.round(w * 10) / 10;
        d.x = d.h === "w" ? Math.round((d.b0.x + (d.b0.w - d.w)) * 10) / 10 : d.b0.x;
        d.node.style.setProperty(v.w, String(d.w));
        d.node.style.setProperty(v.x, String(d.x));
      }
      this.drawOverlay();
    } else if (d.kind === "rotate") {
      const a0 = Math.atan2(d.sy - d.cy, d.sx - d.cx), a = Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx);
      let r = d.b0.r + ((a - a0) * 180) / Math.PI;
      r = ((r + 540) % 360) - 180;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      else for (const t of [0, 90, -90, 180, -180]) if (Math.abs(r - t) < 2) r = t;
      d.r = Math.round(r * 10) / 10;
      d.node.style.setProperty("--r", String(d.r));
      this.drawOverlay();
    } else if (d.kind === "sech") {
      d.h = Math.max(40, Math.round(d.h0 + dy));
      const secNode = this.secNode(d.sid);
      secNode.style.setProperty(this.mode === "m" ? "--mh" : "--h", String(d.h));
      layoutSections(this.site, this.mode, { push: false });
      this.drawOverlay();
    }
  }

  onUp(ev, cancelled = false) {
    const d = this.drag;
    if (!d || ev.pointerId !== d.pid) return;
    this.drag = null;
    this.guides = [];
    try { this.site.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    if (!d.moved || cancelled) { this.relayout(); return; }
    const mode = this.mode, app = this.app;
    if (d.kind === "move") {
      const target = d.items.length === 1 ? this.sectionAt(ev.clientY) : null;
      app.change((doc) => {
        for (const it of d.items) {
          const f = findEl(doc, it.id);
          if (!f) continue;
          const b0 = boxOf(f.el, mode) ?? [it.b0.x, it.b0.y, it.b0.w, it.b0.h];
          setBox(f.el, mode, [it.b0.x + d.dx, it.b0.y + d.dy, b0[2], b0[3]]);
          if (target && target.sid !== it.sid) {
            const dest = findSection(doc, target.sid);
            const oldTop = this.secNode(it.sid).getBoundingClientRect().top;
            const b = boxOf(f.el, mode);
            b[1] = Math.round((b[1] + (oldTop - target.top) / d.s) * 10) / 10;
            f.sec.els.splice(f.index, 1);
            f.el.z = dest.els.reduce((z, e) => Math.max(z, e.z || 0), 0) + 1;
            dest.els.push(f.el);
            const other = mode === "m" ? "d" : "m";
            const ob = boxOf(f.el, other);
            if (ob) ob[1] = Math.max(0, Math.min(ob[1], dest[sectionHeightKey(other)] - ob[3]));
            fitSection(dest, mode);
          } else fitSection(f.sec, mode);
        }
      });
    } else if (d.kind === "resize") {
      app.change((doc) => {
        const f = findEl(doc, d.id);
        if (!f) return;
        if (SCALES.has(f.el.type)) { if (mode === "m") f.el.mk = d.k; else f.el.k = d.k; return; }
        const b = boxOf(f.el, mode) ?? [d.b0.x, d.b0.y, d.b0.w, d.b0.h];
        setBox(f.el, mode, [d.x, b[1], d.w, b[3]]);
      }, { measure: [d.id] });
    } else if (d.kind === "rotate") {
      app.change((doc) => { const f = findEl(doc, d.id); if (f) f.el.r = d.r; });
    } else if (d.kind === "sech") {
      app.change((doc) => { const s = findSection(doc, d.sid); if (s) s[sectionHeightKey(mode)] = d.h; });
    }
  }

  sectionAt(clientY) {
    for (const s of this.site.querySelectorAll(".fsec")) {
      const r = s.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return { sid: s.dataset.sid, top: r.top };
    }
    return null;
  }

  /** Snap the moving group's edges and centre to the section and to other elements. */
  snap(items, dx, dy) {
    const s = this.items0Section(items);
    if (!s) return { dx, dy, guides: [] };
    const tol = 6 / (this.drag?.s || 1);
    const moving = new Set(items.map((i) => i.id));
    const W = designWidth(this.mode);
    const xs = [0, W / 2, W], ys = [0];
    for (const node of s.querySelectorAll(":scope > .fsec-inner > .el")) {
      if (moving.has(node.dataset.eid) || node.offsetParent === null) continue;
      const b = this.shown(node);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    const L = Math.min(...items.map((i) => i.b0.x)), R = Math.max(...items.map((i) => i.b0.x + i.b0.w));
    const T = Math.min(...items.map((i) => i.b0.y)), B = Math.max(...items.map((i) => i.b0.y + i.b0.h));
    const best = (edges, cands, delta) => {
      let pick = null;
      for (const e of edges) for (const c of cands) {
        const diff = c - (e + delta);
        if (Math.abs(diff) <= tol && (!pick || Math.abs(diff) < Math.abs(pick.diff))) pick = { diff, at: c };
      }
      return pick;
    };
    const sx = best([L, (L + R) / 2, R], xs, dx), sy = best([T, (T + B) / 2, B], ys, dy);
    const sid = s.dataset.sid, guides = [];
    if (sx) { dx += sx.diff; guides.push({ sid, x: sx.at }); }
    if (sy) { dy += sy.diff; guides.push({ sid, y: sy.at }); }
    return { dx, dy, guides };
  }
  items0Section(items) {
    const sids = new Set(items.map((i) => i.sid));
    return sids.size === 1 ? this.secNode([...sids][0]) : null;
  }

  /* ---------- Typing in place ---------- */
  onDblClick(ev) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
    const elNode = hit.closest(".fsec-inner > .el");
    if (!elNode) return;
    let target = hit.closest("[data-f]");
    if (!target || !elNode.contains(target)) target = elNode.querySelector("[data-f]");
    if (!target) { this.app.panels.focusSettings(); return; }
    this.startEdit(elNode.dataset.eid, target);
  }

  startEdit(id, node) {
    const f = findEl(this.app.doc(), id);
    if (!f) return;
    const path = node.dataset.f;
    const rich = fieldKind(f.el, path) === "rich";
    const before = getPath(f.el, path) ?? "";
    this.app.select([id], { keepOverlay: true });
    if (rich) node.innerHTML = sanitizeRich(before); else node.textContent = before;
    node.setAttribute("contenteditable", rich ? "true" : "plaintext-only");
    node.spellcheck = true;
    node.classList.add("ed-editing");
    this.editing = { id, path, node, rich, before };
    this.drawOverlay();
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    node.addEventListener("keydown", this.onEditKey = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); this.finishEdit(false); }
      else if (e.key === "Enter") { e.preventDefault(); if (rich) document.execCommand("insertLineBreak"); else this.finishEdit(true); }
      else if (rich && (e.ctrlKey || e.metaKey) && /^[bi]$/i.test(e.key)) { e.preventDefault(); document.execCommand(e.key.toLowerCase() === "b" ? "bold" : "italic"); }
    });
    node.addEventListener("blur", this.onEditBlur = () => setTimeout(() => { if (this.editing?.node === node) this.finishEdit(true); }, 0));
    if (rich) this.showToolbar(node);
  }

  finishEdit(commit) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    this.toolbar.hidden = true;
    ed.node.removeEventListener("keydown", this.onEditKey);
    ed.node.removeEventListener("blur", this.onEditBlur);
    ed.node.removeAttribute("contenteditable");
    ed.node.classList.remove("ed-editing");
    const value = ed.rich ? serializeRich(ed.node) : ed.node.textContent.replace(/[\n\t]+/g, " ").trim();
    if (commit && value !== ed.before) {
      this.app.change((doc) => { const f = findEl(doc, ed.id); if (f) setPath(f.el, ed.path, value); }, { measure: [ed.id] });
    } else this.render();
  }

  showToolbar(node) {
    const r = node.getBoundingClientRect();
    const tb = this.toolbar;
    tb.hidden = false;
    tb.style.setProperty("left", Math.max(8, r.left) + "px");
    tb.style.setProperty("top", Math.max(56, r.top - tb.offsetHeight - 8) + "px");
  }

  onToolbar(ev) {
    const b = ev.target.closest("button[data-cmd]");
    if (!b || !this.editing) return;
    const cmd = b.dataset.cmd, node = this.editing.node;
    if (cmd === "hl") {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !node.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const span = document.createElement("span");
      span.className = "hl";
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } else if (cmd === "plain") {
      node.textContent = node.textContent;
    } else if (cmd === "br") {
      document.execCommand("insertLineBreak");
    } else document.execCommand(cmd);
    node.focus();
  }
}
