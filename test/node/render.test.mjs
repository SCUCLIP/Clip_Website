/* The render must match prototype/static/*.html apart from links and asset paths (static-html.mjs lists the
   rewrites). Compared byte for byte. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expectedHtml, readSeed, STATIC_FILES, ROOT } from "./static-html.mjs";
import { renderPage, renderMain, renderNotFound } from "../../public/shared/render.js";
import { buildFacts } from "../../public/shared/facts.js";
import { norm, ELEMENT_FIELDS, LIST_KINDS } from "../../public/shared/norm.js";

const site = readSeed("site");

for (const id of Object.keys(STATIC_FILES)) {
  test(`${id}: rendered page matches prototype/static/${STATIC_FILES[id]}`, () => {
    const want = expectedHtml(id), got = renderPage(site, readSeed(id));
    if (got !== want) {
      let i = 0;
      while (got[i] === want[i]) i++;
      assert.fail(`first difference at character ${i}:\n  want: ${JSON.stringify(want.slice(i - 60, i + 80))}\n   got: ${JSON.stringify(got.slice(i - 60, i + 80))}`);
    }
  });
}

test("Ask CLIP's facts from the seed match the export's clip-facts.js", () => {
  const src = fs.readFileSync(path.join(ROOT, "prototype/static/assets/clip-facts.js"), "utf8");
  const want = JSON.parse(src.replace(/^[\s\S]*?window\.CLIP_FACTS = /, "").replace(/;\s*$/, ""));
  const docs = Object.fromEntries(["site", "faq", "board", "speakers", "events", "biohackathon"].map((id) => [id, readSeed(id)]));
  assert.deepEqual(buildFacts(docs), want);
});

test("links render as clean URLs", () => {
  const html = renderPage(site, readSeed("home"));
  assert.ok(html.includes('href="/#join"'));
  assert.ok(html.includes('href="/about"'));
  assert.ok(!/href="[a-z]+\.html/.test(html));
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(html));
});

test("render escapes content even if it skipped norm()", () => {
  const page = readSeed("about");
  const el = page.sections[0].els[1];
  el.text = '<script>alert(1)</script><span class="hl" onmouseover="x">hi</span>';
  page.title = '</title><script>alert(1)</script>';
  const btn = { ...readSeed("about").sections[2].els[2], href: "javascript:alert(1)", label: '"><img src=x onerror=alert(1)>' };
  page.sections[2].els[2] = btn;
  const html = renderPage(site, page);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!/<[^>]*onmouseover/.test(html), "no onmouseover attribute");
  assert.ok(html.includes("&lt;span class=\"hl\" onmouseover"), "the unknown tag shows as text");
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<img src=x"));
});

test("editor mode only adds data-f markers", () => {
  const page = readSeed("events");
  const plain = renderMain(page, { site }), ed = renderMain(page, { site, editor: true });
  assert.ok(ed.includes('data-f="items.0.name"'));
  assert.equal(ed.replace(/ data-f="[^"]*"/g, ""), plain);
});

test("the 404 page uses the site shell", () => {
  const html = renderNotFound(site);
  assert.match(html, /<title>Page not found · CLIP/);
  assert.ok(html.includes('<header class="site-header">'));
  assert.ok(!html.includes("aria-current"));
});

test("every element type and list kind renders from defaults", () => {
  const els = [];
  for (const type of Object.keys(ELEMENT_FIELDS)) {
    if (type === "list") for (const kind of LIST_KINDS) els.push({ id: "l" + kind, type, kind, d: [0, 0, 100, 10], m: null, z: 1, items: [{}, {}] });
    else els.push({ id: "e" + type, type, d: [0, 0, 100, 10], m: null, z: 1, list: "weekly" });
  }
  const page = norm("about", { title: "x", sections: [{ id: "s", els }] });
  const html = renderMain(page, { site });
  assert.equal((html.match(/class="el el-/g) || []).length, els.length);
});

