/* The CLIP editor. Loads every draft and published doc, saves drafts as you work (debounced, with the version
   it loaded, so another tab's changes are never overwritten), and publishes or discards on request.
   It reloads when the window gets focus, and on a 409 says someone else changed the page and reloads it. */

import { norm, NormError } from "/shared/norm.js";
import { DOC_IDS, PAGE_IDS, PAGE_NAMES, pagePath } from "/shared/pages.js";
import { SPRITE } from "/shared/sprite.js";
import { api, ApiError } from "./api.js";
import { Canvas } from "./canvas.js";
import { Panels, h } from "./panels.js";
import { History } from "./history.js";
import { clone, sameJson, findEl, findSection, boxOf, setBox, copyElement, maxZ, fitSection, newId, designWidth, sectionHeightKey } from "./model.js";

const SAVE_DELAY = 700;
const CLIPBOARD_KEY = "clip-editor-clipboard";

const app = {
  session: null,
  docs: {},            /* id -> { draft, version, published, ... } as the server last told us, with draft = our working copy */
  cur: "home",
  mode: "d",
  sel: new Set(),
  selSection: null,
  history: new History(),
  dirty: new Set(),
  saving: new Map(),
  timers: new Map(),
  failed: new Set(),
  clipboard: null,

  doc(id = this.cur) { return this.docs[id].draft; },

  /* ---------- Changes ---------- */
  /**
   * Change a doc. `fn` edits a copy; the result is checked with the shared norm() before it's kept.
   * opts: id (default: current page), key (merge undo steps), measure (element ids whose height to re-measure),
   *       keepPanel (don't rebuild the Settings panel), quiet (don't show norm errors; for live typing).
   */
  change(fn, opts = {}) {
    const id = opts.id ?? this.cur;
    const before = this.docs[id].draft;
    const next = clone(before);
    fn(next);
    let clean;
    try { clean = norm(id, next); } catch (err) {
      if (!(err instanceof NormError)) throw err;
      if (!opts.quiet) this.toast("Can't make that change: " + err.message, true);
      return false;
    }
    if (sameJson(clean, before)) return true;
    this.history.record(id, before, opts.key ?? null);
    this.docs[id].draft = clean;
    this.markDirty(id);
    this.refreshView({ keepPanel: opts.keepPanel, measure: opts.measure });
    return true;
  },

  refreshView({ keepPanel = false, measure = null } = {}) {
    if (this.cur === "site") { if (!keepPanel) this.panels.renderSite(); this.updateBar(); return; }
    this.pruneSelection();
    this.canvas.render();
    if (measure?.length) this.measure(measure);
    if (!keepPanel) this.panels.render();
    this.updateBar();
  },

  /** Store the rendered height of these elements in their box for the current mode (no undo step of its own). */
  measure(ids) {
    const doc = this.doc();
    let changed = false;
    for (const id of ids) {
      const f = findEl(doc, id), node = this.canvas.node(id);
      if (!f || !node || node.offsetParent === null) continue;
      const b = boxOf(f.el, this.mode);
      if (!b) continue;
      const hgt = Math.round(node.offsetHeight * 10) / 10;
      if (Math.abs(b[3] - hgt) > 0.5) { b[3] = hgt; changed = true; }
      const key = sectionHeightKey(this.mode), was = f.sec[key];
      fitSection(f.sec, this.mode);
      if (f.sec[key] !== was) changed = true;
    }
    if (changed) { this.markDirty(this.cur); this.canvas.relayout(); }
  },

  pruneSelection() {
    const doc = this.doc();
    for (const id of [...this.sel]) if (!findEl(doc, id)) this.sel.delete(id);
    if (this.selSection && !findSection(doc, this.selSection)) this.selSection = null;
  },

  /* ---------- Selection ---------- */
  select(ids, opts = {}) {
    this.sel = new Set(ids);
    this.selSection = null;
    this.canvas.drawOverlay();
    if (!opts.keepPanel) this.panels.render();
  },
  toggleSelect(id) {
    if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
    this.selSection = null;
    this.canvas.drawOverlay();
    this.panels.render();
  },
  selectSection(sid, opts = {}) {
    this.sel = new Set();
    this.selSection = sid;
    this.canvas.drawOverlay();
    if (!opts.keepPanel) this.panels.render();
  },

  /* ---------- Element and section commands ---------- */
  targetSection() {
    const doc = this.doc();
    if (this.selSection) return this.selSection;
    for (const id of this.sel) { const f = findEl(doc, id); if (f) return f.sec.id; }
    const wrap = this.canvas.wrap.getBoundingClientRect();
    const hit = this.canvas.sectionAt(wrap.top + wrap.height / 2);
    return hit?.sid ?? doc.sections[0]?.id ?? null;
  },

  addElement(proto) {
    if (this.cur === "site") return;
    let sid = this.targetSection();
    if (!sid) { this.addSection(); sid = this.doc().sections[0].id; }
    const { w = 300, h = 60, mh, r, ...fields } = proto;
    const doc = this.doc(), sec = findSection(doc, sid), mode = this.mode;
    const id = newId(doc, "e");
    const secNode = this.canvas.secNode(sid), wrap = this.canvas.wrap.getBoundingClientRect();
    const s = this.canvas.scale;
    const viewY = secNode ? (wrap.top + wrap.height / 2 - secNode.getBoundingClientRect().top) / s : 40;
    const W = designWidth(mode), ww = Math.min(w, W), hh = mode === "m" ? (mh ?? h) : h;
    const y = Math.max(16, Math.min(viewY - hh / 2, (sec[sectionHeightKey(mode)] || 400) - 16));
    const box = [Math.round((W - ww) / 2), Math.round(y), ww, hh];
    const el = { id, ...fields, d: mode === "d" ? box : [Math.round((1180 - w) / 2), Math.round(sec.h), w, h], m: mode === "m" ? box : null, z: maxZ(sec) + 1 };
    if (r) el.r = r;
    if (this.change((d) => { const t = findSection(d, sid); t.els.push(el); fitSection(t, mode); }, { measure: [id] })) {
      this.select([id]);
      this.toast(mode === "d" ? "Added. It stacks at the bottom of the section on phones until you place it there." : "Added.");
    }
  },

  addSection(afterId) {
    if (this.cur === "site") return;
    const doc = this.doc();
    const sid = newId(doc, "s");
    this.change((d) => {
      const at = afterId === undefined ? (this.selSection ? d.sections.findIndex((s) => s.id === this.selSection) : d.sections.length - 1) : afterId === null ? d.sections.length - 1 : d.sections.findIndex((s) => s.id === afterId);
      d.sections.splice(at + 1, 0, { id: sid, bg: "none", h: 400, mh: 600, els: [] });
    });
    this.selectSection(sid);
    this.canvas.secNode(sid)?.scrollIntoView({ block: "center", behavior: "smooth" });
  },

  async deleteSection(sid) {
    const sec = findSection(this.doc(), sid);
    if (!sec) return;
    if (sec.els.length && !(await this.confirm("Delete this section?", `It holds ${sec.els.length} element${sec.els.length === 1 ? "" : "s"}. You can undo this.`, "Delete section"))) return;
    this.change((d) => { d.sections = d.sections.filter((s) => s.id !== sid); });
    this.selectSection(null);
  },
  moveSection(sid, dir) {
    this.change((d) => {
      const i = d.sections.findIndex((s) => s.id === sid), j = i + dir;
      if (i < 0 || j < 0 || j >= d.sections.length) return;
      [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
    });
  },
  duplicateSection(sid) {
    const doc = this.doc(), sec = findSection(doc, sid);
    if (!sec) return;
    const copy = clone(sec);
    copy.id = newId(doc, "s");
    const used = new Set();
    for (const e of copy.els) { e.id = newId(doc, "e") + used.size; used.add(e.id); delete e.anchor; }
    this.change((d) => { d.sections.splice(d.sections.findIndex((s) => s.id === sid) + 1, 0, copy); });
    this.selectSection(copy.id);
  },

  deleteSelected() {
    if (!this.sel.size) return;
    const ids = new Set(this.sel);
    this.change((d) => { for (const s of d.sections) s.els = s.els.filter((e) => !ids.has(e.id)); });
    this.select([]);
  },

  copy(cut = false) {
    const doc = this.doc();
    const els = [...this.sel].map((id) => findEl(doc, id)?.el).filter(Boolean);
    if (!els.length) return;
    this.clipboard = clone(els);
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(els)); } catch { /* private mode */ }
    if (cut) this.deleteSelected();
    this.toast(`${cut ? "Cut" : "Copied"} ${els.length} element${els.length === 1 ? "" : "s"}.`);
  },
  paste() {
    let els = this.clipboard;
    try { const s = localStorage.getItem(CLIPBOARD_KEY); if (s) els = JSON.parse(s); } catch { /* ignore */ }
    if (!Array.isArray(els) || !els.length || this.cur === "site") return;
    const sid = this.targetSection();
    if (!sid) return;
    const ids = [];
    this.change((d) => {
      const sec = findSection(d, sid);
      let z = maxZ(sec);
      for (const src of els) { const c = copyElement(d, src); c.z = ++z; ids.push(c.id); sec.els.push(c); }
      fitSection(sec, this.mode);
    });
    this.select(ids);
  },
  duplicate() { this.copy(); this.paste(); },

  nudge(dx, dy) {
    if (!this.sel.size) return;
    this.change((d) => {
      for (const id of this.sel) {
        const f = findEl(d, id);
        const b = f && boxOf(f.el, this.mode);
        if (b) setBox(f.el, this.mode, [b[0] + dx, b[1] + dy, b[2], b[3]]);
      }
    }, { key: "nudge", keepPanel: true });
  },

  placeOnPhone(id) {
    const node = this.canvas.node(id);
    if (!node) return;
    const b = this.canvas.shown(node);
    this.change((d) => { const f = findEl(d, id); if (f) f.el.m = [b.x, b.y, b.w, b.h]; });
  },

  undo() { this.applyHistory(this.history.undo(this.cur, this.doc())); },
  redo() { this.applyHistory(this.history.redo(this.cur, this.doc())); },
  applyHistory(doc) {
    if (!doc) return;
    this.docs[this.cur].draft = doc;
    this.markDirty(this.cur);
    this.refreshView();
  },

  /* ---------- Saving ---------- */
  markDirty(id) {
    this.dirty.add(id);
    this.failed.delete(id);
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.save(id), SAVE_DELAY));
    this.updateBar();
  },

  async save(id) {
    clearTimeout(this.timers.get(id));
    if (this.saving.has(id)) { await this.saving.get(id); if (this.dirty.has(id)) return this.save(id); return; }
    if (!this.dirty.has(id)) return;
    const entry = this.docs[id];
    const sent = JSON.stringify(entry.draft);
    this.dirty.delete(id);
    this.updateBar();
    const p = (async () => {
      try {
        const res = await api.save(id, entry.version, JSON.parse(sent));
        entry.version = res.version;
        entry.draftUpdatedBy = this.session.email;
      } catch (err) {
        if (err.status === 409) await this.conflict(id);
        else if (err.status === 400) { this.failed.add(id); this.dirty.add(id); this.toast(err.message, true); }
        else { this.dirty.add(id); this.toast(err.message + " Retrying…", true); clearTimeout(this.timers.get(id)); this.timers.set(id, setTimeout(() => this.save(id), 3000)); }
      }
    })();
    this.saving.set(id, p);
    await p;
    this.saving.delete(id);
    this.updateBar();
  },

  /** Save everything now and wait for it. */
  async flush() {
    for (const id of [...this.dirty]) if (!this.failed.has(id)) await this.save(id);
    await Promise.all([...this.saving.values()]);
  },

  async conflict(id) {
    this.toast(`Someone else changed ${id === "site" ? "the site settings" : "the " + PAGE_NAMES[id] + " page"}, so it was reloaded with their version.`, true);
    try {
      this.docs[id] = await api.draft(id);
    } catch (err) { this.toast(err.message, true); return; }
    this.dirty.delete(id);
    this.history.clear(id);
    if (id === this.cur || id === "site") this.refreshView();
  },

  /** On focus: pick up changes made in other tabs or by other editors. */
  async reloadFromServer() {
    if (this.reloading || this.canvas.drag || this.canvas.editing) return;
    this.reloading = true;
    try {
      await this.flush();
      const { docs } = await api.docs();
      let changedHere = false;
      for (const [id, fresh] of Object.entries(docs)) {
        const mine = this.docs[id];
        if (!mine) { this.docs[id] = fresh; continue; }
        if (this.dirty.has(id) || this.saving.has(id)) continue;
        if (fresh.version !== mine.version) {
          this.docs[id] = fresh;
          this.history.clear(id);
          if (id === this.cur || id === "site") changedHere = true;
        } else Object.assign(mine, { published: fresh.published, publishedAt: fresh.publishedAt, publishedBy: fresh.publishedBy });
      }
      if (changedHere) { this.refreshView(); this.toast("Updated with changes made in another window."); }
      else this.updateBar();
    } catch (err) {
      if (err instanceof ApiError) this.toast(err.message, true);
    } finally { this.reloading = false; }
  },

  /* ---------- Publish and discard ---------- */
  unpublished() { return DOC_IDS.filter((id) => this.docs[id] && !sameJson(this.docs[id].draft, this.docs[id].published)); },
  docName(id) { return id === "site" ? "Site settings" : PAGE_NAMES[id]; },

  async publish() {
    await this.flush();
    if (this.dirty.size) { this.toast("Fix the changes that couldn't be saved first.", true); return; }
    const ids = this.unpublished();
    if (!ids.length) { this.toast("Nothing to publish. The site already shows your latest changes."); return; }
    if (!(await this.confirm("Publish these changes?", "The public site will show: " + ids.map((id) => this.docName(id)).join(", ") + ".", "Publish"))) return;
    try {
      await api.publish(Object.fromEntries(ids.map((id) => [id, this.docs[id].version])));
      for (const id of ids) this.docs[id].published = clone(this.docs[id].draft);
      this.toast("Published. The site now shows your changes.");
    } catch (err) {
      if (err.status === 409) {
        this.toast("Someone else changed a page you were publishing, so nothing was published. Those pages were reloaded; check them and publish again.", true);
        for (const id of Object.keys(err.body?.stale ?? {})) { this.docs[id] = await api.draft(id); this.history.clear(id); }
        this.refreshView();
      } else this.toast(err.message, true);
    }
    this.updateBar();
  },

  async discard() {
    const id = this.cur;
    await this.flush();
    if (sameJson(this.docs[id].draft, this.docs[id].published)) { this.toast("No unpublished changes here."); return; }
    if (!(await this.confirm(`Discard unpublished changes to ${this.docName(id)}?`, "The draft goes back to what the public site shows now. You can still undo.", "Discard"))) return;
    try {
      const before = this.doc(id);
      const res = await api.discard(id, this.docs[id].version);
      this.history.record(id, before);
      Object.assign(this.docs[id], { draft: res.doc, version: res.version });
      this.refreshView();
      this.toast("Changes discarded.");
    } catch (err) {
      if (err.status === 409) await this.conflict(id); else this.toast(err.message, true);
    }
  },

  /* ---------- Pages and modes ---------- */
  async openPage(id) {
    if (this.canvas.editing) this.canvas.finishEdit(true);
    this.cur = id;
    this.sel = new Set();
    this.selSection = null;
    try { history.replaceState(null, "", "#" + id); } catch { /* ignore */ }
    const siteTab = id === "site";
    document.body.classList.toggle("is-sitetab", siteTab);
    this.ui.page.value = id;
    if (siteTab) this.panels.renderSite(); else { this.canvas.render(); this.panels.render(); this.canvas.wrap.scrollTop = 0; }
    this.updateBar();
  },
  setMode(mode) {
    this.mode = mode;
    this.ui.modeD.setAttribute("aria-pressed", String(mode === "d"));
    this.ui.modeM.setAttribute("aria-pressed", String(mode === "m"));
    document.body.classList.toggle("is-phone", mode === "m");
    if (this.cur !== "site") { this.canvas.render(); this.panels.render(); }
  },
  viewSite() {
    const path = this.cur === "site" ? "/" : pagePath(this.cur);
    window.open(this.session.publicOrigin + path, "_blank", "noopener");
  },

  /* ---------- UI bits ---------- */
  updateBar() {
    const ui = this.ui;
    if (!ui) return;
    const un = new Set(this.unpublished());
    for (const opt of ui.page.options) opt.textContent = this.docName(opt.value) + (un.has(opt.value) ? " •" : "");
    let status;
    if (this.failed.size) status = "Some changes couldn't be saved";
    else if (this.saving.size || this.dirty.size) status = "Saving…";
    else status = un.size ? `Saved as draft · ${un.size} unpublished` : "Saved · everything is published";
    ui.status.textContent = status;
    ui.status.classList.toggle("is-error", this.failed.size > 0);
    ui.publish.disabled = !un.size && !this.dirty.size;
    ui.discard.disabled = this.cur && this.docs[this.cur] ? sameJson(this.docs[this.cur].draft, this.docs[this.cur].published) && !this.dirty.has(this.cur) : true;
    ui.undo.disabled = this.cur === "site" ? !this.history.canUndo("site") : !this.history.canUndo(this.cur);
    ui.redo.disabled = this.cur === "site" ? !this.history.canRedo("site") : !this.history.canRedo(this.cur);
  },

  toast(msg, isError = false) {
    const t = h("div", { class: "ed-toast" + (isError ? " is-error" : ""), role: isError ? "alert" : "status" }, msg);
    this.ui.toasts.append(t);
    setTimeout(() => t.remove(), isError ? 7000 : 3500);
  },

  confirm(title, body, okLabel) {
    const d = document.getElementById("ed-dialog");
    d.replaceChildren(h("form", { method: "dialog", class: "ed-dialog" },
      h("h2", {}, title), h("p", {}, body),
      h("div", { class: "ed-btns" },
        h("button", { class: "ed-btn", value: "cancel" }, "Cancel"),
        h("button", { class: "ed-btn is-primary", value: "ok", autofocus: true }, okLabel))));
    return new Promise((resolve) => {
      d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
      d.returnValue = "";
      d.showModal();
    });
  },
};

/* ---------- Keyboard ---------- */
function onKey(ev) {
  const t = ev.target;
  if (t.closest?.("input, textarea, select, [contenteditable], dialog")) return;
  if (app.cur === "site") return;
  const mod = ev.ctrlKey || ev.metaKey;
  const k = ev.key.toLowerCase();
  if (mod && k === "z") { ev.preventDefault(); if (ev.shiftKey) app.redo(); else app.undo(); return; }
  if (mod && k === "y") { ev.preventDefault(); app.redo(); return; }
  if (mod && k === "c") { if (app.sel.size) { ev.preventDefault(); app.copy(); } return; }
  if (mod && k === "x") { if (app.sel.size) { ev.preventDefault(); app.copy(true); } return; }
  if (mod && k === "v") { ev.preventDefault(); app.paste(); return; }
  if (mod && k === "d") { ev.preventDefault(); app.duplicate(); return; }
  if (k === "delete" || k === "backspace") { if (app.sel.size) { ev.preventDefault(); app.deleteSelected(); } return; }
  if (k === "escape") { app.select([]); return; }
  const step = ev.shiftKey ? 10 : 1;
  const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
  if (arrows[k] && app.sel.size) { ev.preventDefault(); app.nudge(...arrows[k]); }
}

/* ---------- Start ---------- */
async function start() {
  document.getElementById("ed-sprite").innerHTML = SPRITE;
  const ui = app.ui = {
    page: document.getElementById("ed-page"), modeD: document.getElementById("ed-mode-d"), modeM: document.getElementById("ed-mode-m"),
    undo: document.getElementById("ed-undo"), redo: document.getElementById("ed-redo"), status: document.getElementById("ed-status"),
    discard: document.getElementById("ed-discard"), publish: document.getElementById("ed-publish"), view: document.getElementById("ed-view"),
    who: document.getElementById("ed-who"), toasts: document.getElementById("ed-toasts"),
  };
  for (const id of [...PAGE_IDS, "site"]) ui.page.append(h("option", { value: id }, app.docName(id)));
  ui.page.addEventListener("change", () => app.openPage(ui.page.value));
  ui.modeD.addEventListener("click", () => app.setMode("d"));
  ui.modeM.addEventListener("click", () => app.setMode("m"));
  ui.undo.addEventListener("click", () => (app.cur === "site" ? app.applyHistory(app.history.undo("site", app.doc("site"))) : app.undo()));
  ui.redo.addEventListener("click", () => (app.cur === "site" ? app.applyHistory(app.history.redo("site", app.doc("site"))) : app.redo()));
  ui.publish.addEventListener("click", () => app.publish());
  ui.discard.addEventListener("click", () => app.discard());
  ui.view.addEventListener("click", () => app.viewSite());
  document.getElementById("ed-toggle-add").addEventListener("click", () => document.body.classList.toggle("hide-add"));

  try {
    app.session = await api.session();
    ({ docs: app.docs } = await api.docs());
  } catch (err) {
    document.getElementById("ed-stage").replaceChildren(h("div", { class: "ed-fatal" }, h("h2", {}, "The editor couldn't load"), h("p", {}, err.message)));
    return;
  }
  ui.who.textContent = app.session.local ? "Local mode · no sign-in" : app.session.email;
  ui.view.title = "Open " + app.session.publicOrigin;
  app.canvas = new Canvas(app, document.getElementById("ed-canvas"));
  app.panels = new Panels(app);
  document.addEventListener("keydown", onKey);
  window.addEventListener("focus", () => app.reloadFromServer());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) app.reloadFromServer(); else app.flush(); });
  window.addEventListener("beforeunload", (ev) => { if (app.dirty.size || app.saving.size) { app.flush(); ev.preventDefault(); } });
  const want = decodeURIComponent(location.hash.slice(1));
  await app.openPage([...PAGE_IDS, "site"].includes(want) ? want : "home");
  if (document.fonts) document.fonts.ready.then(() => { if (app.cur !== "site") app.canvas.relayout(); });
}

window.clipEditor = app; /* for debugging in the console */
start();
