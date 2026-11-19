/* The GitHub Pages demo (scripts/build-demo.mjs): it builds, every page and the editor use paths that work under
   /Clip_Website/, and the editor talks to the browser-storage API instead of the Worker. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./static-html.mjs";

const OUT = path.join(ROOT, "dist", "test-demo");
const read = (rel) => fs.readFileSync(path.join(OUT, rel), "utf8");

test("the demo builds for /Clip_Website/", (t) => {
  t.after(() => fs.rmSync(OUT, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, ["scripts/build-demo.mjs", "--base", "/Clip_Website/", "--out", "dist/test-demo"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  const pages = ["index", "about", "events", "biohackathon", "speakers", "board", "resources", "faq"];
  for (const p of pages) {
    const html = read(p + ".html");
    assert.ok(!/(href|src)="\//.test(html), `${p}.html has an absolute path`);
    assert.ok(!/<base\b/.test(html), `${p}.html: <base> would break the drawings`);
    assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'), p);
    assert.ok(html.indexOf('src="demo/site.js"') < html.indexOf('src="assets/site.js"'), `${p}.html runs the demo script first`);
    assert.ok(!/href="#(home|about|events|join)"/.test(html), `${p}.html has a #page link`);
  }
  assert.ok(read("index.html").includes('href="about.html"'));
  assert.ok(read("index.html").includes('href="index.html#join"'));

  const notFound = read("404.html");
  assert.ok(notFound.includes('href="/Clip_Website/assets/site.css"'), "404.html is served at any depth, so it uses the full path");
  assert.ok(notFound.includes('href="/Clip_Website/about.html"'));

  assert.ok(read("editor.html").includes('src="editor/editor.js"'));
  assert.ok(read("editor/api.js").includes("demo/store.js"), "the demo editor uses the browser-storage API");
  assert.ok(read("shared/model.js").includes("globalThis.clipDemoPhoto"));
  assert.ok(!read("shared/render.js").includes('"/assets/'));
  assert.match(read("demo/seed.js"), /^\/\* The content the demo starts from/);
  assert.ok(!fs.existsSync(path.join(ROOT, "public", "demo")), "the demo never ends up in public/");
});

test("the demo build refuses to write outside dist/", () => {
  const r = spawnSync(process.execPath, ["scripts/build-demo.mjs", "--out", "public/demo"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(ROOT, "public", "demo")));
});
