import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, NormError, normHref } from "../../public/shared/norm.js";
import { sanitizeRich, richToPlain, plainHtml } from "../../public/shared/rich.js";
import { hrefFor } from "../../public/shared/pages.js";
import { readSeed } from "./static-html.mjs";

const page = (els, extra = {}) => ({ id: "about", title: "T", description: "D", sections: [{ id: "s1", bg: "none", h: 100, mh: 100, els }], ...extra });
const text = (over = {}) => ({ id: "e1", type: "text", d: [0, 0, 100, 20], m: [0, 0, 100, 20], z: 1, text: "Hi", ...over });
const rejects = (doc, re, id = "about") => assert.throws(() => norm(id, doc), (e) => e instanceof NormError && re.test(e.message));

test("norm is idempotent on every seed doc", () => {
  for (const id of ["site", "home", "about", "events", "biohackathon", "speakers", "board", "resources", "faq"]) {
    const once = norm(id, readSeed(id));
    assert.deepEqual(norm(id, once), once, id);
  }
});

test("norm fills defaults and drops unknown fields", () => {
  const out = norm("about", page([{ ...text(), onclick: "x", style: "y" }], { evil: 1 }));
  assert.equal(out.evil, undefined);
  const el = out.sections[0].els[0];
  assert.equal(el.onclick, undefined);
  assert.equal(el.style, undefined);
  assert.equal(el.tag, "p");
  assert.equal(el.kind, "body");
  assert.equal(el.fs, 18);
});

test("norm refuses docs it can't make safe", () => {
  rejects(page([text({ type: "script" })]), /type: must be one of/);
  rejects(page([text(), text()]), /used twice/);
  rejects(page([text({ id: "a b" })]), /\.id: must be/);
  rejects(page([text({ d: [0, 0, 100] })]), /\.d: must be/);
  rejects(page([text({ d: [0, "1", 100, 20] })]), /must be a number/);
  rejects(page([text({ tag: "script" })]), /\.tag: must be one of/);
  rejects(page([text({ text: "x".repeat(6000) })]), /longer than/);
  rejects(page([{ id: "b", type: "button", d: [0, 0, 10, 10], m: null, z: 1, label: "x", href: "javascript:alert(1)" }]), /\.href: must be/);
  rejects(page([text({ anchor: "site" })]), /anchor/);
  rejects(page([text({ anchor: "addr-x" })]), /anchor/);
  rejects(page([{ id: "l", type: "list", kind: "faq", d: [0, 0, 1, 1], m: null, z: 1, items: [{ q: 1n }] }]), /must be text/);
  rejects(page([{ id: "p", type: "image", d: [0, 0, 1, 1], m: null, z: 1, photo: "../../etc" }]), /photo id/);
  rejects(page([{ id: "f", type: "form", d: [0, 0, 1, 1], m: null, z: 1, list: "Weekly List" }]), /list name/);
  rejects({ id: "home" }, /doesn't match/);
  assert.throws(() => norm("admin", {}), /unknown doc/);
  assert.throws(() => norm("about", []), /JSON object/);
  assert.doesNotThrow(() => norm("about", page([])));
});

test("links: only #page, #anchor, https: and mailto:", () => {
  for (const ok of ["#about", "#join", "https://example.com/x?y=1", "mailto:a@scu.edu", ""]) assert.doesNotThrow(() => normHref(ok), ok);
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "http://example.com", "//evil.example", "/about", "#", "#About", "https://user:pw@x.com", "vbscript:x", "about.html"]) {
    assert.throws(() => normHref(bad), NormError, bad);
  }
  assert.equal(hrefFor("#home"), "/");
  assert.equal(hrefFor("#about"), "/about");
  assert.equal(hrefFor("#join"), "/#join");
  assert.equal(hrefFor("https://x.com/"), "https://x.com/");
  assert.equal(hrefFor("javascript:alert(1)"), "");
});

test("rich text keeps six tags and escapes everything else", () => {
  assert.equal(sanitizeRich('a<script>alert(1)</script>'), "a&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(sanitizeRich('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(sanitizeRich('<span class="hl" onclick="x">y</span>'), '&lt;span class="hl" onclick="x"&gt;y');
  assert.equal(sanitizeRich("<B>bold</B> <i>it<sub>2</sub></i><br/>next"), "<b>bold</b> <i>it<sub>2</sub></i><br>next");
  assert.equal(sanitizeRich("<b>open"), "<b>open</b>");
  assert.equal(sanitizeRich("R&amp;D & more &lt;tag&gt;"), "R&amp;D &amp; more &lt;tag&gt;");
  assert.equal(sanitizeRich("line\nbreak"), "line<br>break");
  assert.equal(sanitizeRich("<b></b>x"), "x");
  const tricky = '<span class="hl">a</span></span><b>b</i></b>';
  assert.equal(sanitizeRich(sanitizeRich(tricky)), sanitizeRich(tricky));
  assert.equal(richToPlain("our lab<br>mascot &amp; <b>friend</b>"), "our lab mascot & friend");
  assert.equal(plainHtml("[Day] · <b>"), '<span class="ph">[Day]</span> · &lt;b&gt;');
});
