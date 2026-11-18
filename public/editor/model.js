/* Helpers for editing content docs in place. The format is defined by /shared/norm.js. */

import { DW, MW } from "/shared/pages.js";

export const clone = (v) => JSON.parse(JSON.stringify(v));
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const rand = () => Math.random().toString(36).slice(2, 7);
/** A new id that isn't used on this page. */
export function newId(doc, prefix = "e") {
  const used = allIds(doc);
  let id;
  do { id = prefix + Date.now().toString(36).slice(-4) + rand(); } while (used.has(id));
  return id;
}
export function allIds(doc) {
  const ids = new Set();
  for (const s of doc.sections ?? []) { ids.add(s.id); for (const e of s.els) ids.add(e.id); }
  return ids;
}

export function findEl(doc, id) {
  for (const s of doc.sections ?? []) {
    const i = s.els.findIndex((e) => e.id === id);
    if (i !== -1) return { el: s.els[i], sec: s, index: i };
  }
  return null;
}
export const findSection = (doc, id) => (doc.sections ?? []).find((s) => s.id === id) ?? null;

/** The box for a layout mode: "d" desktop, "m" phone (may be null). */
export const boxOf = (el, mode) => (mode === "m" ? el.m : el.d);
export function setBox(el, mode, box) {
  const b = box.map((v) => Math.round(v * 10) / 10);
  if (mode === "m") el.m = b; else el.d = b;
}
export const designWidth = (mode) => (mode === "m" ? MW : DW);
export const sectionHeightKey = (mode) => (mode === "m" ? "mh" : "h");

/** Get or set a value by path like "items.2.title". */
export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[/^\d+$/.test(k) ? Number(k) : k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[/^\d+$/.test(k) ? Number(k) : k], obj);
  target[/^\d+$/.test(last) ? Number(last) : last] = value;
}

/** Make a copy of an element with a fresh id, for paste and duplicate. */
export function copyElement(doc, el, dx = 16, dy = 16) {
  const c = clone(el);
  c.id = newId(doc, "e");
  delete c.anchor;
  c.d = [c.d[0] + dx, c.d[1] + dy, c.d[2], c.d[3]];
  if (c.m) c.m = [Math.min(c.m[0] + dx, MW - 8), c.m[1] + dy, c.m[2], c.m[3]];
  return c;
}

export const maxZ = (sec) => sec.els.reduce((z, e) => Math.max(z, e.z || 0), 0);

/** Grow a section so every element fits (never shrinks it). */
export function fitSection(sec, mode) {
  const key = sectionHeightKey(mode);
  let bottom = 0;
  for (const e of sec.els) {
    const b = boxOf(e, mode);
    if (b && !(mode === "m" && e.mHide)) bottom = Math.max(bottom, b[1] + b[3]);
  }
  if (bottom + 24 > sec[key]) sec[key] = Math.round(bottom + 24);
}

/** A short human name for an element, for lists and the Settings panel title. */
export function describe(el) {
  const names = { text: "Text", button: "Button", link: "Arrow link", entry: "Entry header", figure: "Figure", doodle: "Drawing",
    image: "Photo", note: "Sticky note", line: "Line", stamp: "Stamp", signup: "Sign-up sheet", form: "Sign-up form",
    contact: "Contact line", callout: "Callout", list: "List" };
  let name = names[el.type] || el.type;
  if (el.type === "list") name = { highlights: "Highlights", chips: "Chips", cards: "Cards", events: "Events", speakers: "Speakers",
    members: "Board members", roles: "Roles", steps: "Steps", past: "Past events", faq: "FAQ", status: "Status cards" }[el.kind] + " list";
  if (el.type === "text") name = { eyebrow: "Eyebrow", hero: "Hero title", big: "Big title", page: "Page title", section: "Section title",
    sub: "Subheading", lede: "Lede", body: "Body text", small: "Small text", hand: "Handwriting" }[el.kind] || "Text";
  const snippet = String(el.text ?? el.label ?? el.title ?? el.caption ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 28);
  return snippet ? `${name}: ${snippet}` : name;
}
