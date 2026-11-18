/* Worker tests run inside workerd with local D1 and R2 (no network, no Cloudflare account).
   Each test starts from an empty store with every migration (including the seed) applied: see test/worker/setup.js. */
import fs from "node:fs";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = fs.existsSync("./migrations") ? await readD1Migrations("./migrations") : [];
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["test/worker/**/*.test.js"],
      setupFiles: ["./test/worker/setup.js"],
    },
  };
});
