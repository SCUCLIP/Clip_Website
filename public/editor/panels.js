/* The Add panel, the Settings panel and the Site tab. Forms are built from the shared schema (/shared/norm.js),
   so every field the content format has can be edited here. */

import { ELEMENT_FIELDS, LIST_FIELDS, LIST_KINDS } from "/shared/norm.js";
import { PAGE_IDS, PAGE_NAMES, photoSrc, assetSrc } from "/shared/pages.js";
import { CATALOG } from "./catalog.js";
import { findEl, findSection, boxOf, setBox, describe, designWidth, sectionHeightKey, clone, newId, maxZ, fitSection } from "./model.js";
import { api } from "./api.js";

/* ---------- Tiny DOM helper ---------- */
export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : String(kid));
  return n;
}

const LABELS = {
  tag: "HTML tag", kind: "Style", color: "Color", align: "Alignment", rule: "Dashed line above", fs: "Font size, desktop", mfs: "Font size, phones",
  text: "Text", label: "Label", href: "Link", style: "Style", num: "Entry number", page: "Page note", art: "Drawing", alt: "Description (for screen readers)",
  caption: "Caption", from: "Left of arrow", above: "Above arrow", below: "Below arrow", to: "Right of arrow", frame: "Frame", tape: "Tape",
  logo: "Logo (no photo background)", solid: "Solid line", eyebrow: "Eyebrow", title: "Title", body: "Body", placeholder: "Placeholder",
  button: "Button", list: "Sign-up list name", ok: "Thank-you message", contact: "Text before the email", q: "Question", a: "Answer",
  month: "Month", day: "Day", name: "Name", time: "Time", location: "Location", desc: "Description", linkLabel: "Link label", linkHref: "Link",
  when: "When", topic: "Talk topic", role: "Role", what: "What happened", more: "Faded last chip", photo: "Photo",
};
const ENUM_LABELS = { "": "Default", blue: "Blue", yellow: "Yellow", none: "None" };
const LAYOUT_KEYS = new Set(["k", "mk", "ar", "iw", "ih", "photo", "asset"]);
const LINK_HINTS = ["#home", ...PAGE_IDS.filter((p) => p !== "home").map((p) => "#" + p), "#join", "https://", "mailto:"];

function field(label, input, note) {
  return h("label", { class: "ed-field" }, h("span", { class: "ed-label" }, label), input, note ? h("small", { class: "ed-note" }, note) : null);
}
const group = (title, ...kids) => h("section", { class: "ed-group" }, h("h3", {}, title), ...kids);
const btn = (label, onclick, cls = "") => h("button", { type: "button", class: "ed-btn " + cls, onclick }, label);

export class Panels {
  constructor(app) {
    this.app = app;
    this.addEl = document.getElementById("ed-add");
    this.setEl = document.getElementById("ed-settings");
    this.siteEl = document.getElementById("ed-sitetab");
    this.fileInput = document.getElementById("ed-file");
    this.dialog = document.getElementById("ed-dialog");
    this.fileInput.addEventListener("change", () => this.onFileChosen());
    document.body.append(h("datalist", { id: "ed-links" }, LINK_HINTS.map((v) => h("option", { value: v }))));
    this.renderAdd();
  }

  /* ---------- Add panel ---------- */
  renderAdd() {
    this.addEl.replaceChildren(
      h("h2", {}, "Add"),
      h("p", { class: "ed-hint" }, "Click to add to the selected section, or the one in view."),
      ...CATALOG.map((g) => h("details", { class: "ed-cat", open: g.group === "Text" },
        h("summary", {}, g.group),
        h("div", { class: "ed-cat-items" }, g.items.map((it) => btn(it.label, () => this.app.addElement(it.make()), "ed-add-item"))))),
      h("details", { class: "ed-cat", open: true }, h("summary", {}, "Sections"),
        h("div", { class: "ed-cat-items" }, btn("New section below", () => this.app.addSection(), "ed-add-item"))),
    );
  }

  /* ---------- Settings panel ---------- */
  render() {
    const app = this.app;
    if (app.cur === "site") return;
    const doc = app.doc();
    let body;
    if (app.sel.size === 1) {
      const f = findEl(doc, [...app.sel][0]);
      body = f ? this.elementSettings(f.el, f.sec) : this.pageSettings(doc);
    } else if (app.sel.size > 1) body = this.multiSettings();
    else if (app.selSection && findSection(doc, app.selSection)) body = this.sectionSettings(findSection(doc, app.selSection));
    else body = this.pageSettings(doc);
    this.setEl.replaceChildren(body);
  }
  focusSettings() {
    const first = this.setEl.querySelector("input, textarea, select");
    if (first) first.focus();
  }

  /** An input for one schema field. `set(value, live)` applies it. */
  input(spec, value, set, opts = {}) {
    const live = (v) => set(v, true), done = (v) => set(v, false);
    switch (spec.t) {
      case "plain": case "rich": {
        const long = spec.t === "rich" || spec.max > 300;
        const n = long ? h("textarea", { rows: spec.t === "rich" ? 3 : 2 }) : h("input", { type: "text" });
        n.value = value ?? "";
        n.maxLength = spec.max;
        n.addEventListener("input", () => live(n.value));
        n.addEventListener("change", () => done(n.value));
        return n;
      }
      case "enum": {
        const n = h("select", {}, spec.vals.map((v) => h("option", { value: v }, opts.names?.[v] ?? ENUM_LABELS[v] ?? v)));
        n.value = value ?? spec.def;
        n.addEventListener("change", () => done(n.value));
        return n;
      }
      case "bool": {
        const n = h("input", { type: "checkbox" });
        n.checked = !!value;
        n.addEventListener("change", () => done(n.checked));
        return n;
      }
      case "num": {
        const n = h("input", { type: "number", step: spec.dec ? String(10 ** -spec.dec) : "1", min: spec.min, max: spec.max });
        n.value = value ?? "";
        n.addEventListener("change", () => { if (n.value !== "") done(Number(n.value)); });
        return n;
      }
      case "href": case "listName": {
        const n = h("input", { type: "text", list: spec.t === "href" ? "ed-links" : null, spellcheck: "false", placeholder: spec.t === "href" ? "#about, https://… or mailto:…" : "weekly" });
        n.value = value ?? "";
        n.addEventListener("change", () => done(n.value.trim()));
        return n;
      }
      default: return h("span", {}, String(value ?? ""));
    }
  }

  /** Apply a change to the selected element. Live changes merge into one undo step per field. */
  setter(id, apply, key) {
    return (v, live) => this.app.change((doc) => { const f = findEl(doc, id); if (f) apply(f.el, v, f.sec, doc); },
      { key: key ? `${id}:${key}` : null, keepPanel: true, measure: [id], quiet: live });
  }

  elementSettings(el, sec) {
    const app = this.app, mode = app.mode;
    const content = [];
    for (const [k, spec] of Object.entries(ELEMENT_FIELDS[el.type])) {
      if (LAYOUT_KEYS.has(k) || (spec.when && !spec.when(el))) continue;
      if (el.type === "list" && k === "kind") {
        content.push(field("List kind", this.input(spec, el.kind, this.setter(el.id, (e, v) => { e.kind = v; }), {}), "Changing it keeps the fields both kinds share."));
        continue;
      }
      const note = spec.t === "rich" ? "Double-click the text on the page to edit it with formatting." : spec.t === "listName" ? "Sign-ups are saved under this name. It must be used by a published form." : null;
      content.push(field(LABELS[k] || k, this.input(spec, el[k], this.setter(el.id, (e, v) => { e[k] = v; }, k)), note));
    }
    const parts = [h("div", { class: "ed-title" }, h("h2", {}, describe(el)), btn("Delete", () => app.deleteSelected(), "is-danger"))];
    parts.push(group("Content", ...content));
    if (el.type === "image") parts.push(group("Photo", this.photoControl(el.photo, el.asset, (id, meta, asset) => this.setter(el.id, (e) => {
      e.photo = id || ""; e.asset = asset || "";
      if (meta?.width && meta?.height) { e.iw = meta.width; e.ih = meta.height; e.ar = Math.round((meta.width / meta.height) * 10000) / 10000; }
    })(null, false))));
    if (el.type === "list") parts.push(this.itemsEditor(el));
    parts.push(this.layoutGroup(el, sec, mode));
    return h("div", {}, parts);
  }

  layoutGroup(el, sec, mode) {
    const app = this.app;
    const box = boxOf(el, mode);
    const kids = [];
    const where = mode === "m" ? "phones" : "desktop";
    if (mode === "m" && el.mHide) kids.push(h("p", { class: "ed-hint" }, "Hidden on phones."));
    else if (!box) {
      kids.push(h("p", { class: "ed-hint" }, "Not placed on phones yet: it's stacked at the bottom of the section. Drag it, or:"),
        btn("Place it where it is now", () => app.placeOnPhone(el.id)));
    } else {
      const num = (i, label) => field(label, this.input({ t: "num", min: -2000, max: 20000, dec: 1 }, box[i],
        this.setter(el.id, (e, v) => { const b = boxOf(e, mode); b[i] = v; setBox(e, mode, b); }, "box" + i)));
      kids.push(h("div", { class: "ed-row" }, num(0, "X"), num(1, "Y"), num(2, "Width")));
    }
    kids.push(h("div", { class: "ed-row" },
      field("Rotation", this.input({ t: "num", min: -360, max: 360, dec: 1 }, el.r ?? 0, this.setter(el.id, (e, v) => { e.r = v; }, "r"))),
      el.type === "figure" || el.type === "stamp"
        ? field(mode === "m" ? "Zoom, phones" : "Zoom", this.input({ t: "num", min: 0.1, max: 8, dec: 2 }, mode === "m" ? (el.mk ?? el.k) : el.k,
          this.setter(el.id, (e, v) => { if (mode === "m") e.mk = v; else e.k = v; }, "k")))
        : el.type === "image" ? field("Width ÷ height", this.input({ t: "num", min: 0.1, max: 10, dec: 2 }, el.ar, this.setter(el.id, (e, v) => { e.ar = v; }, "ar"))) : null,
    ));
    kids.push(h("div", { class: "ed-btns" },
      btn("Bring to front", () => app.change((d) => { const f = findEl(d, el.id); f.el.z = maxZ(f.sec) + 1; })),
      btn("Send to back", () => app.change((d) => { const f = findEl(d, el.id); for (const e of f.sec.els) e.z = (e.z || 0) + 1; f.el.z = 0; })),
      btn("Duplicate", () => app.duplicate()),
    ));
    kids.push(field("Hide on phones", this.input({ t: "bool" }, el.mHide, this.setter(el.id, (e, v) => { if (v) e.mHide = true; else delete e.mHide; }))));
    if (el.m && !el.mHide) kids.push(btn("Stack it automatically on phones", () => app.change((d) => { findEl(d, el.id).el.m = null; })));
    kids.push(field("Faint (half opacity)", this.input({ t: "bool" }, el.faint, this.setter(el.id, (e, v) => { if (v) e.faint = true; else delete e.faint; }))));
    const anchor = this.input({ t: "listName" }, el.anchor ?? "", this.setter(el.id, (e, v) => { if (v) e.anchor = v; else delete e.anchor; }));
    anchor.placeholder = "join";
    kids.push(field("Anchor name", anchor,
      "Other links can point here with #name. Only anchors on the home page work from other pages."));
    return group(`Position and layout (${where})`, ...kids);
  }

  itemsEditor(el) {
    const app = this.app, kind = el.kind, specs = LIST_FIELDS[kind];
    const items = el.items.map((it, i) => {
      const fields = Object.entries(specs).map(([k, spec]) => {
        if (spec.t === "photo") return field("Photo", this.photoControl(it.photo, "", (id) => this.setter(el.id, (e) => { e.items[i].photo = id || ""; })(null, false)));
        return field(LABELS[k] || k, this.input(spec, it[k], this.setter(el.id, (e, v) => { e.items[i][k] = v; }, `i${i}.${k}`)));
      });
      return h("fieldset", { class: "ed-item" },
        h("legend", {}, `Item ${i + 1}`),
        h("div", { class: "ed-btns" },
          btn("↑", () => this.moveItem(el.id, i, -1), "is-small"), btn("↓", () => this.moveItem(el.id, i, 1), "is-small"),
          btn("Remove", () => app.change((d) => { findEl(d, el.id).el.items.splice(i, 1); }, { measure: [el.id] }), "is-small is-danger")),
        ...fields);
    });
    return group("Items", ...items, btn("Add item", () => app.change((d) => {
      const e = findEl(d, el.id).el;
      e.items.push(e.items.length ? clone(e.items[e.items.length - 1]) : {});
    }, { measure: [el.id] })));
  }
  moveItem(id, i, dir) {
    this.app.change((d) => {
      const items = findEl(d, id).el.items, j = i + dir;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
    }, { measure: [id] });
  }

  /** Photo picker: upload, choose an earlier upload, use a built-in image, or remove. onSet(photoId, meta, asset). */
  photoControl(photoId, asset, onSet) {
    const src = photoId ? photoSrc(photoId) : asset ? assetSrc(asset) : "";
    return h("div", { class: "ed-photo" },
      src ? h("img", { src, alt: "", class: "ed-thumb" }) : h("div", { class: "ed-thumb is-empty" }, "No photo"),
      h("div", { class: "ed-btns" },
        btn("Upload…", () => this.pickFile((meta) => onSet(meta.id, meta, ""))),
        btn("Choose…", () => this.choosePhoto((meta) => onSet(meta.id, meta, ""))),
        asset !== undefined ? btn("CLIP logo", () => onSet("", { width: 359, height: 371 }, "clip-logo.png")) : null,
        src ? btn("Remove", () => onSet("", null, ""), "is-danger") : null));
  }

  /* One hidden file input for every Upload button. pickFile() remembers what the chosen photo is for. */
  pickFile(done) {
    this.pendingFile = done;
    this.fileInput.value = "";
    this.fileInput.click();
  }
  async onFileChosen() {
    const done = this.pendingFile, file = this.fileInput.files?.[0];
    this.pendingFile = null;
    if (!done || !file) return;
    if (file.size > 5 * 1024 * 1024) { this.app.toast("Photos can be at most 5 MB.", true); return; }
    this.app.toast("Uploading " + file.name + "…");
    try { done(await api.upload(file)); this.app.toast("Photo uploaded."); } catch (err) { this.app.toast(err.message, true); }
  }

  async choosePhoto(done) {
    let photos = [];
    try { ({ photos } = await api.photos()); } catch (err) { this.app.toast(err.message, true); return; }
    const d = this.dialog;
    d.replaceChildren(h("form", { method: "dialog", class: "ed-dialog" },
      h("h2", {}, "Uploaded photos"),
      photos.length ? h("div", { class: "ed-photo-grid" }, photos.map((p) => h("button", { type: "button", class: "ed-photo-pick", onclick: () => { d.close(); done(p); } },
        h("img", { src: p.src, alt: "", loading: "lazy" }), h("small", {}, (p.width && p.height ? `${p.width}×${p.height}` : "") + " · " + p.createdAt.slice(0, 10)))))
        : h("p", {}, "No photos uploaded yet."),
      h("div", { class: "ed-btns" }, h("button", { class: "ed-btn", value: "cancel" }, "Close"))));
    d.showModal();
  }

  multiSettings() {
    const app = this.app, mode = app.mode;
    const align = (how) => app.change((doc) => {
      const els = [...app.sel].map((id) => findEl(doc, id)?.el).filter((e) => e && boxOf(e, mode));
      if (els.length < 2) return;
      const bs = els.map((e) => boxOf(e, mode));
      const L = Math.min(...bs.map((b) => b[0])), R = Math.max(...bs.map((b) => b[0] + b[2]));
      const T = Math.min(...bs.map((b) => b[1])), B = Math.max(...bs.map((b) => b[1] + b[3]));
      for (const b of bs) {
        if (how === "left") b[0] = L; if (how === "right") b[0] = R - b[2]; if (how === "center") b[0] = (L + R) / 2 - b[2] / 2;
        if (how === "top") b[1] = T; if (how === "bottom") b[1] = B - b[3]; if (how === "middle") b[1] = (T + B) / 2 - b[3] / 2;
      }
      els.forEach((e, i) => setBox(e, mode, bs[i]));
    });
    return h("div", {},
      h("div", { class: "ed-title" }, h("h2", {}, `${app.sel.size} selected`), btn("Delete", () => app.deleteSelected(), "is-danger")),
      group("Align", h("div", { class: "ed-btns" }, ["left", "center", "right", "top", "middle", "bottom"].map((a) => btn(a[0].toUpperCase() + a.slice(1), () => align(a))))),
      group("Arrange", h("div", { class: "ed-btns" }, btn("Duplicate", () => app.duplicate()),
        btn("Hide on phones", () => app.change((d) => { for (const id of app.sel) { const f = findEl(d, id); if (f) f.el.mHide = true; } })))),
      h("p", { class: "ed-hint" }, "Shift-click to add or remove elements. Drag any of them to move them together."));
  }

  sectionSettings(sec) {
    const app = this.app, mode = app.mode, key = sectionHeightKey(mode);
    const doc = app.doc(), i = doc.sections.findIndex((s) => s.id === sec.id);
    const set = (fn) => app.change((d) => { const s = findSection(d, sec.id); if (s) fn(s, d); }, { keepPanel: false });
    return h("div", {},
      h("div", { class: "ed-title" }, h("h2", {}, `Section ${i + 1} of ${doc.sections.length}`), btn("Delete", () => app.deleteSection(sec.id), "is-danger")),
      group("Section",
        field("Background", this.input({ t: "enum", vals: ["none", "blue", "yellow"], def: "none" }, sec.bg, (v) => set((s) => { s.bg = v; }))),
        field(mode === "m" ? "Height on phones" : "Height on desktop", this.input({ t: "num", min: 40, max: 20000, dec: 0 }, sec[key], (v) => set((s) => { s[key] = v; })),
          "Or drag the bar at the bottom of the section."),
        h("div", { class: "ed-btns" },
          btn("Move up", () => app.moveSection(sec.id, -1)), btn("Move down", () => app.moveSection(sec.id, 1)),
          btn("Duplicate", () => app.duplicateSection(sec.id)), btn("New section below", () => app.addSection(sec.id)))),
      h("p", { class: "ed-hint" }, `${sec.els.length} element${sec.els.length === 1 ? "" : "s"}. Click one to edit it.`));
  }

  pageSettings(doc) {
    const app = this.app;
    const set = (k) => (v, live) => app.change((d) => { d[k] = v; }, { key: "page:" + k, keepPanel: true, quiet: live });
    const hidden = app.mode === "m" ? doc.sections.flatMap((s) => s.els.filter((e) => e.mHide)) : [];
    return h("div", {},
      h("div", { class: "ed-title" }, h("h2", {}, PAGE_NAMES[doc.id] + " page")),
      group("Page",
        field("Title (browser tab and search results)", this.input({ t: "plain", max: 150 }, doc.title, set("title"))),
        field("Description (search results)", this.input({ t: "plain", max: 300 }, doc.description, set("description"))),
        btn("Add a section at the end", () => app.addSection(null))),
      hidden.length ? group("Hidden on phones", ...hidden.map((e) => h("div", { class: "ed-row" }, h("span", {}, describe(e)),
        btn("Show", () => app.change((d) => { delete findEl(d, e.id).el.mHide; }), "is-small")))) : null,
      group("How to edit",
        h("ul", { class: "ed-help" },
          h("li", {}, "Drag anything to move it. Handles resize; the round one rotates."),
          h("li", {}, "Double-click text to type. Shift-click selects several."),
          h("li", {}, "Ctrl+C, Ctrl+V, Ctrl+D duplicate, Delete, arrows nudge (Shift: 10px)."),
          h("li", {}, "Ctrl+Z undo, Ctrl+Shift+Z redo. Alt while dragging: no snapping."),
          h("li", {}, "Phone layout is separate: switch to Phone at the top to arrange it."),
          h("li", {}, "Changes save as drafts automatically. Publish puts them on the site."))));
  }

  /* ---------- Site tab ---------- */
  renderSite() {
    const app = this.app, site = app.doc("site");
    const set = (fn, key) => (v, live) => app.change((d) => fn(d, v), { id: "site", key: key ? "site:" + key : null, keepPanel: true, quiet: live });
    const plain = (max) => ({ t: "plain", max });
    const navRows = site.nav.map((n, i) => h("div", { class: "ed-row" },
      h("span", { class: "ed-nav-page" }, PAGE_NAMES[n.page]),
      this.input(plain(40), n.label, set((d, v) => { d.nav[i].label = v; }, "nav" + i)),
      btn("↑", () => app.change((d) => { if (i > 0) [d.nav[i - 1], d.nav[i]] = [d.nav[i], d.nav[i - 1]]; }, { id: "site" }), "is-small"),
      btn("↓", () => app.change((d) => { if (i < d.nav.length - 1) [d.nav[i + 1], d.nav[i]] = [d.nav[i], d.nav[i + 1]]; }, { id: "site" }), "is-small"),
      btn("Remove", () => app.change((d) => { d.nav.splice(i, 1); }, { id: "site" }), "is-small is-danger")));
    const missing = PAGE_IDS.filter((p) => !site.nav.some((n) => n.page === p));
    const suggestions = site.chat.suggestions.map((q, i) => h("div", { class: "ed-row" },
      this.input(plain(80), q, set((d, v) => { d.chat.suggestions[i] = v; }, "sugg" + i)),
      btn("Remove", () => app.change((d) => { d.chat.suggestions.splice(i, 1); }, { id: "site" }), "is-small is-danger")));
    const signups = h("div", { class: "ed-signups" }, h("p", { class: "ed-hint" }, "Loading sign-ups…"));
    this.siteEl.replaceChildren(h("div", { class: "ed-site-cols" },
      h("div", {},
        h("h2", {}, "Site settings"),
        h("p", { class: "ed-hint" }, "These show on every page. They save as a draft and go live with Publish."),
        group("Contact",
          field("Club email", this.input({ t: "plain", max: 254 }, site.email, set((d, v) => { d.email = v; }, "email")), "Shown in the footer, contact lines, Copy buttons and Ask CLIP."),
          field("Instagram", this.input(plain(60), site.instagram, set((d, v) => { d.instagram = v; }, "ig")), "Like @scuclip. Text in [brackets] shows as not posted yet.")),
        group("Header",
          ...navRows,
          missing.length ? h("div", { class: "ed-btns" }, missing.map((p) => btn("Add " + PAGE_NAMES[p], () => app.change((d) => { d.nav.push({ page: p, label: PAGE_NAMES[p] }); }, { id: "site" }), "is-small"))) : null,
          h("div", { class: "ed-row" },
            field("Button label", this.input(plain(40), site.cta.label, set((d, v) => { d.cta.label = v; }, "ctal"))),
            field("Button link", this.input({ t: "href" }, site.cta.href, set((d, v) => { d.cta.href = v; }))))),
        group("Footer",
          field("About line", this.input(plain(400), site.footer, set((d, v) => { d.footer = v; }, "footer"))),
          field("Notebook label", this.input(plain(60), site.notebook, set((d, v) => { d.notebook = v; }, "nb")))),
        group("Ask CLIP",
          field("Greeting", this.input(plain(400), site.chat.greeting, set((d, v) => { d.chat.greeting = v; }, "greet"))),
          h("span", { class: "ed-label" }, "Suggested questions"), ...suggestions,
          site.chat.suggestions.length < 6 ? btn("Add a question", () => app.change((d) => { d.chat.suggestions.push("A question?"); }, { id: "site" })) : null,
          field("Footer line", this.input(plain(120), site.chat.foot, set((d, v) => { d.chat.foot = v; }, "foot"))),
          field("Board note", this.input(plain(600), site.chat.boardNote, set((d, v) => { d.chat.boardNote = v; }, "bn")), "Added when someone asks about the board."),
          h("p", { class: "ed-hint" }, "Ask CLIP also answers from the FAQ, Board, Speakers and Events pages and the Biohackathon page's description."))),
      h("div", {}, h("h2", {}, "Sign-ups"), signups)));
    this.loadSignups(signups);
  }

  async loadSignups(box) {
    let list;
    try { ({ signups: list } = await api.signups()); } catch (err) { box.replaceChildren(h("p", { class: "ed-error" }, err.message)); return; }
    if (!list.length) { box.replaceChildren(h("p", { class: "ed-hint" }, "Nobody has signed up yet.")); return; }
    const byList = new Map();
    for (const s of list) { if (!byList.has(s.list)) byList.set(s.list, []); byList.get(s.list).push(s); }
    box.replaceChildren(...[...byList].map(([name, rows]) => group(`${name} (${rows.length})`,
      h("div", { class: "ed-btns" },
        btn("Copy emails", async () => { try { await navigator.clipboard.writeText(rows.map((r) => r.email).join("\n")); this.app.toast("Copied " + rows.length + " emails."); } catch { this.app.toast("Couldn't copy. Select them in the table instead.", true); } }),
        btn("Download CSV", () => this.downloadCsv(name, rows))),
      h("table", { class: "ed-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Email"), h("th", {}, "Signed up"), h("th", {}, ""))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.email), h("td", {}, new Date(r.createdAt).toLocaleString()),
          h("td", {}, btn("Delete", async () => {
            if (!(await this.app.confirm("Delete this sign-up?", `${r.email} comes off the "${name}" list. This can't be undone.`, "Delete"))) return;
            try { await api.deleteSignup(r.id); this.loadSignups(box); } catch (err) { this.app.toast(err.message, true); }
          }, "is-small is-danger")))))))));
  }

  downloadCsv(name, rows) {
    /* Quote cells, and stop spreadsheets from running an "email" like =HYPERLINK(…)@x.yz as a formula. */
    const cell = (v) => { const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; return /[",\n']/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = "email,list,signed_up\n" + rows.map((r) => [r.email, r.list, r.createdAt].map(cell).join(",")).join("\n") + "\n";
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: `clip-${name}-signups.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
}
