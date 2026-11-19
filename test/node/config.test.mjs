/* Config rules that keep local mode local (CLAUDE.md, security rules 1-2). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./static-html.mjs";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("wrangler.jsonc never sets LOCAL_MODE", () => {
  const cfg = read("wrangler.jsonc");
  assert.ok(!/LOCAL_MODE/.test(cfg), "wrangler.jsonc must not mention LOCAL_MODE at all");
});

test("wrangler.jsonc keeps the Worker off workers.dev and holds no secrets", () => {
  const cfg = read("wrangler.jsonc");
  assert.match(cfg, /"workers_dev":\s*false/);
  assert.match(cfg, /"preview_urls":\s*false/);
  assert.ok(!/TURNSTILE_SECRET"\s*:/.test(cfg), "TURNSTILE_SECRET is a secret, not a var");
  assert.ok(!/"(api_token|account_id)"/.test(cfg));
});

test("only npm run dev turns on local mode, with every flag local mode needs", () => {
  const dev = read("scripts/dev.mjs");
  for (const flag of ['"--ip", "127.0.0.1"', '"--port", "8787"', '"--var", "LOCAL_MODE:on"', '"--var", "ADMIN_HOST:admin.localhost"', '"--infer-origin-from-routes=false"']) {
    assert.ok(dev.includes(flag), `scripts/dev.mjs is missing ${flag}`);
  }
  assert.ok(!/--remote/.test(dev), "dev must never use remote bindings");
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.dev, "node scripts/dev.mjs");
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (name !== "dev") assert.ok(!/LOCAL_MODE/.test(cmd), `npm script "${name}" must not set LOCAL_MODE`);
    assert.ok(!/\b(deploy|--remote|login)\b/.test(cmd.replace("wrangler deploy --dry-run", "")), `npm script "${name}" must not deploy, log in or use remote resources`);
  }
});

test("no secrets or local-only files are committed", () => {
  const ignore = read(".gitignore");
  for (const p of [".dev.vars", ".wrangler/", "node_modules/", ".env"]) assert.ok(ignore.includes(p), `.gitignore must include ${p}`);
  assert.ok(!fs.existsSync(path.join(ROOT, ".dev.vars")), "there must be no .dev.vars; local mode needs none");
});

test("dependencies are pinned to exact versions", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `${name} must be an exact version, not ${v}`);
  }
});
