/* norm() and the link rule. norm() repairs any doc into the v5 shape and never throws; what it returns is what the
   Worker stores, so it must give back a normalized doc unchanged (otherwise a save would quietly change it). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSeed } from "./static-html.mjs";
import { DOC_IDS, VIEW_IDS, EL, LISTS, norm, canon, safeHref, listMake } from "../../public/shared/model.js";

const box = (x = 0, y = 0, w = 100, h = 20) => ({ x, y, w, h });
const idem = (id, doc, label) => {
  const once = norm(id, doc);
  assert.equal(canon(norm(id, once)), canon(once), label || id);
  assert.equal(canon(norm(id, JSON.parse(JSON.stringify(once)))), canon(once), (label || id) + " after a JSON round trip");
  return once;
};

test("every seed doc is already normalized", () => {
  for (const id of DOC_IDS) assert.equal(canon(norm(id, readSeed(id))), canon(readSeed(id)), id);
});

test("norm gives a normalized doc back unchanged, whatever it started from", () => {
  const junk = [null, undefined, 1, "x", [], {}, { v: 4, sections: [] }, { v: 5 }, { v: 5, sections: "x" },
    { v: 5, sections: [null, 1, { elements: [null, { type: "script" }, { type: "list", src: "nope" }] }] }];
  for (const id of DOC_IDS) for (const [i, j] of junk.entries()) idem(id, j, `${id} junk ${i}`);
  /* Every element type and list, with odd values in every field. */
  const odd = { text: 5, hl: null, kind: "huge", color: "red", fs: "999", align: 3, rule: "yes", label: ["x"], url: { a: 1 }, style: "", src: "../x",
    caption: "c".repeat(5000), frame: "gold", ar: "wide", tape: 1, alt: false, sym: "nope", faint: "true", fig: 0, tag: 7, pg: "admin", lead: "",
    list: "secret", eyebrow: "", title: "", body: "", buttonLabel: "", okText: "", contact: "", showEmail: "1", limit: "10", showLinks: 0, more: 1, empty: 2,
    items: [null, "plain", { q: 1, a: 2, t: 3, title: [], state: "done" }], d: { x: "1e9", y: -1e9, w: "NaN", h: 1.23456 }, m: { x: 1.26 }, mHide: "yes", r: 720, k: 99, mk: "0" };
  const elements = [];
  for (const type of Object.keys(EL)) {
    if (type === "list") for (const src of Object.keys(LISTS)) elements.push({ ...odd, type, src, id: "l" + src });
    else elements.push({ ...odd, type, id: "e" + type });
  }
  elements.push({ ...odd, type: "text", id: "etext" }, { ...odd, type: "text", id: "a b" });
  const page = idem("about", { v: 5, sections: [{ id: "s1", h: "x", mh: -5, bg: "pink", elements }, { id: "s1" }] });
  const ids = page.sections.flatMap((s) => [s.id, ...s.elements.map((e) => e.id)]);
  assert.equal(new Set(ids).size, ids.length, "ids are unique after norm");
  idem("data", { events: [odd, odd], speakers: "x", members: [{ name: 1 }], highlights: null, past: [{}] });
  idem("settings", { contactEmail: 5, instagram: ["@x"], footerBlurb: null, extra: 1 });
});

test("norm keeps only known fields and repairs bad values", () => {
  const out = norm("about", { v: 5, evil: 1, sections: [{ id: "s1", onload: "x", elements: [
    { id: "t1", type: "text", text: "Hi", onclick: "x", style: "y", kind: "nope", d: box(1.26, 2.34, 50, 10), r: 400 },
    { id: "b1", type: "button", label: "Go", url: "javascript:alert(1)", d: box() },
    { id: "p1", type: "image", src: "../../etc/passwd", d: box() },
    { id: "x1", type: "iframe", d: box() },
  ] }] });
  assert.equal(out.evil, undefined);
  assert.deepEqual(Object.keys(out.sections[0]), ["id", "h", "mh", "bg", "elements"]);
  const [t, b, p] = out.sections[0].elements;
  assert.equal(out.sections[0].elements.length, 3, "unknown types are dropped");
  assert.equal(t.onclick, undefined);
  assert.equal(t.style, undefined);
  assert.equal(t.kind, "hero", "an unknown style becomes the first one, as in the prototype");
  assert.deepEqual(t.d, { x: 1.3, y: 2.3, w: 50, h: 10 });
  assert.equal(t.r, 180);
  assert.equal(b.url, "javascript:alert(1)", "links are stored as typed, and only rendered if safeHref allows them");
  assert.equal(safeHref(b.url), "");
  assert.equal(p.src, "", "photo ids must look like ids");
});

test("page docs must be v5, so an old draft becomes an empty page", () => {
  assert.deepEqual(norm("home", { id: "home", title: "x", sections: [{ id: "s1", els: [] }] }), { v: 5, sections: [] });
  for (const id of VIEW_IDS) assert.equal(norm(id, null).v, 5);
});

test("links: only https:// and #page or #anchor", () => {
  for (const ok of ["#about", "#join", "#events", "https://example.com/x?y=1"]) assert.equal(safeHref(ok), ok, ok);
  assert.equal(safeHref("  #faq "), "#faq");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "http://example.com", "//evil.example", "/about",
    "#", "#1x", "mailto:a@scu.edu", "https://a b.com", 'https://x.com/"onclick', "vbscript:x", "about.html", ""]) {
    assert.equal(safeHref(bad), "", bad);
  }
});

test("new elements and lists start normalized", () => {
  for (const type of Object.keys(EL)) {
    if (type === "list") continue;
    idem("about", { v: 5, sections: [{ id: "s1", elements: [{ ...EL[type].make(), type, id: "n" + type, d: box() }] }] }, type);
  }
  for (const src of Object.keys(LISTS)) idem("about", { v: 5, sections: [{ id: "s1", elements: [{ ...listMake(src), type: "list", id: "n" + src, d: box() }] }] }, src);
});
