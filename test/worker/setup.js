import { applyD1Migrations, env, reset } from "cloudflare:test";
import { afterEach, beforeEach, vi } from "vitest";
import { resetAccessKeys } from "../../src/access.js";

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  resetAccessKeys();
});
afterEach(() => vi.restoreAllMocks());
