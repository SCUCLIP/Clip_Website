/* The render must match prototype/static/*.html apart from links and asset paths (static-html.mjs lists the
   rewrites). Compared byte for byte. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expectedHtml, readSeed, STATIC_FILES, ROOT } from "./static-html.mjs";
import { DOC_IDS, VIEW_IDS, EL, LISTS, LIST_ORDER, norm, listMake } from "../../public/shared/model.js";
import { pageMain, headerHTML, footerHTML } from "../../public/shared/render.js";
import { renderPage, renderNotFound, cleanUrl } from "../../public/shared/export.js";

const seed = () => Object.fromEntries(DOC_IDS.map((id) => [id, readSeed(id)]));

for (const id of Object.keys(STATIC_FILES)) {
  test(`${id}: rendered page matches prototype/static/${STATIC_FILES[id]}`, () => {
    const want = expectedHtml(id), got = renderPage(seed(), id);
    if (got !== want) {
      let i = 0;
      while (got[i] === want[i]) i++;
      assert.fail(`first difference at character ${i}:\n  want: ${JSON.stringify(want.slice(i - 60, i + 80))}\n   got: ${JSON.stringify(got.slice(i - 60, i + 80))}`);
    }
  });
}

test("there's no Ask CLIP", () => {
  const html = renderPage(seed(), "faq");
  assert.ok(!/chat-launcher|chat-panel|clip-facts/.test(html));
});

test("links render as clean URLs", () => {
  assert.equal(cleanUrl("#home"), "/");
  assert.equal(cleanUrl("#about"), "/about");
  assert.equal(cleanUrl("#join"), "/#join");
  assert.equal(cleanUrl("https://example.com/x"), "https://example.com/x");
  const html = renderPage(seed(), "home");
  assert.ok(html.includes('href="/#join"'));
  assert.ok(html.includes('href="/about"'));
  assert.ok(!/href="#[a-z]/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, "")), "no #page links left in the page body");
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html));
});

test("render escapes content and drops links that aren't https:// or #page", () => {
  const box = { x: 0, y: 0, w: 100, h: 10 };
  const about = norm("about", { v: 5, sections: [{ id: "sx1", elements: [
    { id: "txt1", type: "text", text: "<script>alert(1)</script><img src=x onerror=alert(1)>", hl: '"><b>', d: box },
    { id: "btn1", type: "button", label: '"><img src=x>', url: "javascript:alert(1)", d: box },
    { id: "lnk1", type: "link", label: "b", url: "http://plain.example", d: box },
    { id: "btn2", type: "button", label: "c", url: "https://ok.example/", d: box },
    { id: "img1", type: "image", src: "../../etc/passwd", d: box },
  ] }] });
  const html = renderPage({ ...seed(), about }, "about");
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("http://plain.example"), "http:// links don't render as links");
  assert.ok(!html.includes("passwd"), "photo ids that aren't ids are dropped");
  assert.ok(html.includes('href="https://ok.example/" target="_blank" rel="noopener noreferrer"'));
});

test("the editor's canvas marks every editable text with its ref", () => {
  const C = seed();
  for (const id of VIEW_IDS) {
    const X = { C, edit: true, idp: "cv-", editor: false, animate: false };
    const html = headerHTML(X, id) + pageMain(X, id) + footerHTML(X);
    const refs = [...html.matchAll(/data-f="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 5, id);
    for (const ref of refs) assert.match(ref, /^(E\.[A-Za-z0-9]+\.[A-Za-z0-9]+|S\.[A-Za-z0-9]+|D\.[a-z]+\.\d+|G)\.[A-Za-z0-9.]+$/, `${id}: ${ref}`);
    assert.ok(refs.includes("G.contactEmail"), id);
    assert.ok(!/ data-d="/.test(html), "data-d is only for the public pages");
  }
});

test("the 404 page uses the site shell", () => {
  const html = renderNotFound(seed());
  assert.match(html, /<title>Page not found · CLIP/);
  assert.ok(html.includes('<header class="site-header">'));
  assert.ok(html.includes("This page isn't in the notebook"));
  assert.ok(!html.includes("aria-current"));
});

test("every element type and list renders from its defaults", () => {
  const elements = [];
  for (const type of Object.keys(EL)) {
    if (type === "list") for (const src of LIST_ORDER) elements.push({ ...listMake(src), type, id: "l" + src, d: { x: 0, y: 0, w: 100, h: 10 } });
    else elements.push({ ...EL[type].make(), type, id: "e" + type, d: { x: 0, y: 0, w: 100, h: 10 } });
  }
  const C = { ...seed(), about: norm("about", { v: 5, sections: [{ id: "sall", elements }] }) };
  assert.equal(C.about.sections[0].elements.length, Object.keys(EL).length - 1 + Object.keys(LISTS).length);
  const html = renderPage(C, "about");
  assert.equal((html.match(/class="el el-/g) || []).length, C.about.sections[0].elements.length);
});
