/* norm(): checks a content doc and returns it in canonical form, or throws NormError.
   The Worker runs it on every draft save (PUT /api/admin/drafts/:id) and on the seed files; the editor runs the
   same code before it saves. The schema below is also what the editor's Settings panel is built from.
   See docs/CONTENT-FORMAT.md for the format in prose. */

import { DOC_IDS, PAGE_IDS, ASSETS, HASH_LINK, PHOTO_ID } from "./pages.js";
import { sanitizeRich, stripControl } from "./rich.js";

export class NormError extends Error {
  constructor(message) { super(message); this.name = "NormError"; }
}
const fail = (path, msg) => { throw new NormError(`${path}: ${msg}`); };

export const LIMITS = { sections: 40, elements: 150, items: 60, docChars: 400_000 };

/* ---------- Field specs ---------- */
const plain = (max = 300) => ({ t: "plain", max });
const rich = (max = 3000) => ({ t: "rich", max });
const oneOf = (vals, def = vals[0]) => ({ t: "enum", vals, def });
const bool = () => ({ t: "bool" });
const num = (min, max, dec, def) => ({ t: "num", min, max, dec, def });
const optNum = (min, max, dec) => ({ t: "num", min, max, dec, def: null });
const href = () => ({ t: "href" });
const photo = () => ({ t: "photo" });
const asset = () => ({ t: "enum", vals: ["", ...ASSETS], def: "" });
const listName = () => ({ t: "listName" });
const only = (spec, when) => ({ ...spec, when });

export const TEXT_KINDS = ["eyebrow", "hero", "big", "page", "section", "sub", "lede", "body", "small", "hand"];
export const FIGURE_ARTS = ["aspirin", "chair", "tlc", "mortar", "ballstick", "dose", "sn2", "rxn"];
export const DOODLE_ARTS = ["flask", "flask-mini", "benzene", "capsule", "tablet", "tick", "arrow"];
export const LIST_KINDS = ["highlights", "chips", "cards", "events", "speakers", "members", "roles", "steps", "past", "faq", "status"];
const isRxn = (o) => o.art === "rxn";

/** Fields of each element type, in the order they are stored. */
export const ELEMENT_FIELDS = {
  text: {
    tag: oneOf(["p", "h1", "h2", "h3"]), kind: oneOf(TEXT_KINDS, "body"),
    color: oneOf(["", "ink", "muted", "pen", "teal"]), align: oneOf(["", "center", "right"]), rule: bool(),
    fs: num(6, 240, 1, 18), mfs: num(6, 240, 1, 18), text: rich(5000),
  },
  button: { label: plain(80), href: href(), style: oneOf(["primary", "secondary"]) },
  link: { label: plain(80), href: href() },
  entry: { num: plain(40), label: plain(80), page: plain(40), href: href() },
  figure: {
    art: oneOf(FIGURE_ARTS), alt: plain(200), caption: rich(300),
    from: only(plain(40), isRxn), above: only(plain(40), isRxn), below: only(plain(40), isRxn), to: only(plain(40), isRxn),
    k: num(0.1, 8, 2, 1), mk: optNum(0.1, 8, 2),
  },
  doodle: { art: oneOf(DOODLE_ARTS) },
  image: {
    asset: asset(), photo: photo(), alt: plain(300), caption: rich(300),
    frame: oneOf(["card", "polaroid", "plain"]), tape: oneOf(["", "blue", "yellow"]), logo: bool(),
    ar: num(0.1, 10, 4, 1.5), iw: num(0, 20000, 0, 0), ih: num(0, 20000, 0, 0),
  },
  note: { color: oneOf(["yellow", "blue"]), text: rich(1000) },
  line: { solid: bool() },
  stamp: { text: rich(200), k: num(0.1, 8, 2, 1), mk: optNum(0.1, 8, 2) },
  signup: {
    eyebrow: plain(80), title: plain(120), body: plain(400), label: plain(60), placeholder: plain(60),
    button: plain(40), list: listName(), ok: plain(200), contact: plain(200),
  },
  form: { label: plain(60), placeholder: plain(60), button: plain(40), list: listName(), ok: plain(200) },
  contact: { text: plain(200) },
  callout: { title: plain(160), text: plain(300) },
  list: { kind: oneOf(LIST_KINDS) },
};
export const ELEMENT_TYPES = Object.keys(ELEMENT_FIELDS);

/** Fields of each list kind's items. */
export const LIST_FIELDS = {
  highlights: { title: plain(120), text: plain(400) },
  chips: { text: plain(60), more: bool() },
  cards: { title: plain(120), text: plain(600), linkLabel: plain(80), linkHref: href() },
  events: {
    month: plain(20), day: plain(20), name: plain(120), time: plain(80), location: plain(120),
    desc: plain(400), linkLabel: plain(80), linkHref: href(),
  },
  speakers: { name: plain(80), when: plain(40), title: plain(120), topic: plain(160), photo: photo() },
  members: { name: plain(80), role: plain(80), photo: photo() },
  roles: { title: plain(80), text: plain(600) },
  steps: { text: plain(60) },
  past: { when: plain(40), what: plain(300) },
  faq: { q: plain(200), a: plain(1000) },
  status: { title: plain(120), tag: plain(30), text: plain(400) },
};

export const SITE_FIELDS = {
  email: { t: "email" }, instagram: plain(60), footer: plain(400), notebook: plain(60),
};

/* ---------- Normalizers ---------- */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const round = (v, dec) => { const f = 10 ** dec; return Math.round(v * f) / f; };
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const LIST_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
/* DOM ids the page shell and the render already use. Anchors can't take them. */
const RESERVED_IDS = new Set(["site", "site-nav", "chat-launcher", "chat-panel", "chat-close", "chat-log", "chat-suggest",
  "chat-form", "chat-input", "chat-send", "chat-send-icon", "chat-mode", "flask", "flask-mini", "tick", "arrow-right",
  "benzene", "capsule", "tablet", "aspirin", "chair", "tlc", "mortar", "ballstick", "dose", "sn2", ...PAGE_IDS]);

function normPlain(v, max, path) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number") fail(path, "must be text");
  const s = stripControl(String(v)).replace(/[\n\t]+/g, " ").trim();
  if (s.length > max) fail(path, `is longer than ${max} characters`);
  return s;
}

export function normHref(v, path = "link") {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") fail(path, "must be text");
  const s = v.trim();
  if (!s) return "";
  if (HASH_LINK.test(s)) return s;
  if (/^mailto:/i.test(s)) {
    const addr = s.slice(7);
    if (s.length > 260 || !EMAIL.test(addr)) fail(path, "isn't a valid mailto: link");
    return "mailto:" + addr;
  }
  if (/^https:\/\//i.test(s) && s.length <= 600) {
    let u;
    try { u = new URL(s); } catch { fail(path, "isn't a valid web address"); }
    if (u.protocol !== "https:" || u.username || u.password || /[\s"<>]/.test(u.href)) fail(path, "isn't an allowed web address");
    return u.href;
  }
  return fail(path, "must be #page, #anchor, https://… or mailto:…");
}

function normField(spec, v, path) {
  switch (spec.t) {
    case "plain": return normPlain(v, spec.max, path);
    case "rich": {
      if (v === undefined || v === null) return "";
      if (typeof v !== "string") fail(path, "must be text");
      const s = sanitizeRich(v).replace(/^(<br>)+|(<br>)+$/g, "");
      if (s.length > spec.max) fail(path, `is longer than ${spec.max} characters`);
      return s;
    }
    case "enum":
      if (v === undefined || v === null) return spec.def;
      if (!spec.vals.includes(v)) fail(path, `must be one of: ${spec.vals.filter(Boolean).join(", ")}`);
      return v;
    case "bool":
      if (v === undefined || v === null) return false;
      if (typeof v !== "boolean") fail(path, "must be true or false");
      return v;
    case "num":
      if (v === undefined || v === null) { if (spec.def === undefined) fail(path, "is required"); return spec.def; }
      if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "must be a number");
      return round(Math.min(spec.max, Math.max(spec.min, v)), spec.dec);
    case "href": return normHref(v, path);
    case "photo":
      if (v === undefined || v === null || v === "") return "";
      if (typeof v !== "string" || !PHOTO_ID.test(v)) fail(path, "isn't a photo id");
      return v;
    case "listName":
      if (typeof v !== "string" || !LIST_NAME.test(v)) fail(path, "must be a list name (lowercase letters, digits and dashes)");
      return v;
    case "email": {
      const s = normPlain(v, 254, path);
      if (!EMAIL.test(s)) fail(path, "must be an email address");
      return s;
    }
    default: return fail(path, "has an unknown field type");
  }
}

function normFields(specs, src, path) {
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.when && !spec.when({ ...src, ...out })) continue;
    const v = normField(spec, src[key], `${path}.${key}`);
    if (v === null) continue; /* optional number not set */
    out[key] = v;
  }
  return out;
}

function normBox(v, path) {
  if (!Array.isArray(v) || v.length !== 4) fail(path, "must be [x, y, width, height]");
  const [x, y, w, h] = v;
  return [
    normField(num(-1200, 2400, 1), x, path + "[0]"),
    normField(num(-400, 20000, 1), y, path + "[1]"),
    normField(num(1, 2400, 1), w, path + "[2]"),
    normField(num(0, 20000, 1), h, path + "[3]"),
  ];
}

function normItems(kind, items, path) {
  if (!Array.isArray(items)) fail(path, "must be a list");
  if (items.length > LIMITS.items) fail(path, `can hold at most ${LIMITS.items} items`);
  return items.map((it, i) => {
    if (!isObj(it)) fail(`${path}[${i}]`, "must be an object");
    return normFields(LIST_FIELDS[kind], it, `${path}[${i}]`);
  });
}

function normElement(src, path, seen) {
  if (!isObj(src)) fail(path, "must be an object");
  const type = src.type;
  if (!ELEMENT_FIELDS[type]) fail(path + ".type", `must be one of: ${ELEMENT_TYPES.join(", ")}`);
  if (typeof src.id !== "string" || !ID.test(src.id)) fail(path + ".id", "must be 1-40 letters, digits, _ or -");
  if (seen.ids.has(src.id)) fail(path + ".id", `"${src.id}" is used twice on this page`);
  seen.ids.add(src.id);
  const el = { id: src.id, type, d: normBox(src.d, path + ".d"), m: src.m === null || src.m === undefined ? null : normBox(src.m, path + ".m") };
  el.z = normField(num(0, 9999, 0, 1), src.z, path + ".z");
  const r = normField(num(-360, 360, 1, 0), src.r, path + ".r");
  if (r) el.r = r;
  Object.assign(el, normFields(ELEMENT_FIELDS[type], src, path));
  if (type === "list") el.items = normItems(el.kind, src.items ?? [], path + ".items");
  if (normField(bool(), src.mHide, path + ".mHide")) el.mHide = true;
  if (normField(bool(), src.faint, path + ".faint")) el.faint = true;
  if (src.anchor !== undefined && src.anchor !== "") {
    const a = src.anchor;
    if (typeof a !== "string" || !HASH_LINK.test("#" + a) || RESERVED_IDS.has(a) || /^(em|st|addr|view)-/.test(a)) fail(path + ".anchor", "isn't an allowed anchor name");
    if (seen.anchors.has(a)) fail(path + ".anchor", `"${a}" is used twice on this page`);
    seen.anchors.add(a);
    el.anchor = a;
  }
  return el;
}

function normSection(src, path, seen) {
  if (!isObj(src)) fail(path, "must be an object");
  if (typeof src.id !== "string" || !ID.test(src.id)) fail(path + ".id", "must be 1-40 letters, digits, _ or -");
  if (seen.ids.has(src.id)) fail(path + ".id", `"${src.id}" is used twice on this page`);
  seen.ids.add(src.id);
  const els = src.els ?? [];
  if (!Array.isArray(els)) fail(path + ".els", "must be a list");
  if (els.length > LIMITS.elements) fail(path + ".els", `can hold at most ${LIMITS.elements} elements`);
  return {
    id: src.id,
    bg: normField(oneOf(["none", "blue", "yellow"]), src.bg, path + ".bg"),
    h: normField(num(0, 20000, 1, 400), src.h, path + ".h"),
    mh: normField(num(0, 40000, 1, 600), src.mh, path + ".mh"),
    els: els.map((e, i) => normElement(e, `${path}.els[${i}]`, seen)),
  };
}

function normPage(id, src) {
  const sections = src.sections ?? [];
  if (!Array.isArray(sections)) fail("sections", "must be a list");
  if (sections.length > LIMITS.sections) fail("sections", `can hold at most ${LIMITS.sections} sections`);
  const seen = { ids: new Set(), anchors: new Set() };
  return {
    id,
    title: normPlain(src.title, 150, "title"),
    description: normPlain(src.description, 300, "description"),
    sections: sections.map((s, i) => normSection(s, `sections[${i}]`, seen)),
  };
}

function normSite(src) {
  const out = { id: "site", ...normFields(SITE_FIELDS, src, "site") };
  const nav = src.nav ?? [];
  if (!Array.isArray(nav) || nav.length > PAGE_IDS.length) fail("nav", "must be a list of pages");
  const pages = new Set();
  out.nav = nav.map((n, i) => {
    if (!isObj(n)) fail(`nav[${i}]`, "must be an object");
    const page = normField(oneOf(PAGE_IDS), n.page, `nav[${i}].page`);
    if (pages.has(page)) fail(`nav[${i}].page`, "is listed twice");
    pages.add(page);
    return { page, label: normPlain(n.label, 40, `nav[${i}].label`) };
  });
  const cta = isObj(src.cta) ? src.cta : {};
  out.cta = { label: normPlain(cta.label, 40, "cta.label"), href: normHref(cta.href, "cta.href") };
  const chat = isObj(src.chat) ? src.chat : {};
  const sugg = chat.suggestions ?? [];
  if (!Array.isArray(sugg) || sugg.length > 6) fail("chat.suggestions", "must be a list of at most 6 questions");
  out.chat = {
    greeting: normPlain(chat.greeting, 400, "chat.greeting"),
    suggestions: sugg.map((s, i) => normPlain(s, 80, `chat.suggestions[${i}]`)).filter(Boolean),
    foot: normPlain(chat.foot, 120, "chat.foot"),
    boardNote: normPlain(chat.boardNote, 600, "chat.boardNote"),
  };
  return out;
}

/** Check and normalize one content doc. Throws NormError with a path and a reason. */
export function norm(id, doc) {
  if (!DOC_IDS.includes(id)) throw new NormError(`unknown doc "${id}"`);
  if (!isObj(doc)) throw new NormError("the doc must be a JSON object");
  if (doc.id !== undefined && doc.id !== id) throw new NormError(`the doc's id "${doc.id}" doesn't match "${id}"`);
  const out = id === "site" ? normSite(doc) : normPage(id, doc);
  if (JSON.stringify(out).length > LIMITS.docChars) throw new NormError("the doc is too large");
  return out;
}

/** Sign-up list names used by the forms in these docs. */
export function listNames(docs) {
  const names = new Set();
  for (const doc of docs) for (const s of doc?.sections ?? []) for (const e of s.els) if (e.type === "signup" || e.type === "form") names.add(e.list);
  return names;
}
