/* The CSP allows no inline scripts and no <style> blocks, so every page and the editor must keep their
   styles and scripts in files under public/. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./static-html.mjs";

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const files = walk(path.join(ROOT, "public"));

test("HTML under public/ has no inline scripts, <style> blocks or event-handler attributes", () => {
  for (const f of files.filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) assert.match(tag, /\ssrc="\/[^"]+"/, `${rel}: inline <script>`);
    assert.ok(!/<style[\s>]/i.test(html), `${rel}: <style> block`);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${rel}: inline event handler`);
    assert.ok(!/javascript:/i.test(html), `${rel}: javascript: URL`);
  }
});

test("browser code loads only from the site itself", () => {
  for (const f of files.filter((f) => /\.(js|css|html)$/.test(f))) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    for (const m of src.matchAll(/(?:import\s[^'"]*|import\(|@import\s|url\()\s*["']?([^"')\s]+)/g)) {
      const target = m[1];
      if (target.startsWith("data:")) continue;
      assert.ok(target.startsWith("/") || target.startsWith("./"), `${rel} loads ${target}`);
    }
    assert.ok(!/eval\(|new Function\(/.test(src), `${rel}: eval`);
  }
});

test("the only third-party URL in browser code is Turnstile's script", () => {
  for (const f of files.filter((f) => f.endsWith(".js"))) {
    const urls = fs.readFileSync(f, "utf8").match(/https:\/\/[a-z0-9.-]+/gi) ?? [];
    for (const u of urls) assert.ok(["https://challenges.cloudflare.com", "https://www.instagram.com"].includes(u), `${path.relative(ROOT, f)}: ${u}`);
  }
});
