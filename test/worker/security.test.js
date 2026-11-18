/* Local mode, sign-in and request-origin rules (CLAUDE.md, security rules 1-6). */
import { describe, expect, it } from "vitest";
import { isLocalMode, siteFor } from "../../src/hosts.js";
import { turnstileRequired, verifyTurnstile } from "../../src/turnstile.js";
import {
  call, fromEditor, accessToken, stubNetwork, otherKeyPair,
  LOCAL_ADMIN, LOCAL_PUBLIC, PROD_ADMIN, PROD_PUBLIC, LOCAL_ENV, PROD_ENV, AUD,
} from "./helpers.js";

describe("local mode", () => {
  it("is on only with LOCAL_MODE=1 and a localhost hostname", () => {
    expect(isLocalMode({ LOCAL_MODE: "1" }, "localhost")).toBe(true);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "admin.localhost")).toBe(true);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "ADMIN.LOCALHOST")).toBe(true);
    expect(isLocalMode({}, "admin.localhost")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "true" }, "admin.localhost")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "0" }, "localhost")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "admin.scuclip.com")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "scuclip.com")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "127.0.0.1")).toBe(false);
    expect(isLocalMode({ LOCAL_MODE: "1" }, "evil.localhost.example.com")).toBe(false);
  });

  it("the deployed config doesn't turn it on", async () => {
    const { env } = await import("cloudflare:test");
    expect(env.LOCAL_MODE).toBeUndefined();
  });

  it("opens the editor with no sign-in on admin.localhost", async () => {
    const res = await call(LOCAL_ADMIN + "/api/admin/session", fromEditor("GET"), LOCAL_ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "local", local: true, publicOrigin: "http://localhost:8787", adminOrigin: "http://admin.localhost:8787",
    });
  });

  it("stays off on admin.localhost without LOCAL_MODE", async () => {
    const res = await call(LOCAL_ADMIN + "/api/admin/session", fromEditor("GET"), PROD_ENV);
    expect(res.status).toBe(401);
    const unconfigured = await call(LOCAL_ADMIN + "/api/admin/session", fromEditor("GET"));
    expect(unconfigured.status).toBe(503);
  });

  it("stays off on the real admin hostname even with LOCAL_MODE=1", async () => {
    const res = await call(PROD_ADMIN + "/api/admin/session", fromEditor("GET", undefined, PROD_ADMIN), { ...PROD_ENV, ...LOCAL_ENV });
    expect(res.status).toBe(401);
    const page = await call(PROD_ADMIN + "/", {}, { ...PROD_ENV, ...LOCAL_ENV });
    expect(page.status).toBe(401);
  });

  it("knows each host's origins", () => {
    const local = siteFor(new URL("http://admin.localhost:8787/x"), { PUBLIC_HOST: "scuclip.com", ADMIN_HOST: "admin.scuclip.com", LOCAL_MODE: "1" });
    expect(local).toMatchObject({ kind: "admin", local: true, production: false, publicOrigin: "http://localhost:8787" });
    const prod = siteFor(new URL("https://scuclip.com/"), { PUBLIC_HOST: "scuclip.com", ADMIN_HOST: "admin.scuclip.com", LOCAL_MODE: "1" });
    expect(prod).toMatchObject({ kind: "public", local: false, production: true, adminOrigin: "https://admin.scuclip.com" });
  });
});

describe("Cloudflare Access on the real admin hostname", () => {
  const session = async (token, overrides = {}) => call(PROD_ADMIN + "/api/admin/session",
    { headers: { "Sec-Fetch-Site": "same-origin", ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}) } }, { ...PROD_ENV, ...overrides });

  it("refuses every request when Access isn't configured", async () => {
    await stubNetwork();
    const res = await session(await accessToken(), { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
    expect(res.status).toBe(503);
  });

  it("refuses a request with no token", async () => {
    expect((await session(null)).status).toBe(401);
    expect((await call(PROD_ADMIN + "/", {}, PROD_ENV)).status).toBe(401);
    expect((await call(PROD_ADMIN + "/editor/index.html", {}, PROD_ENV)).status).toBe(401);
  });

  it("accepts a valid token and reports who signed in", async () => {
    await stubNetwork();
    const res = await session(await accessToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "editor@scu.edu", local: false, publicOrigin: "https://scuclip.com" });
  });

  it("refuses bad tokens", async () => {
    await stubNetwork();
    const now = Math.floor(Date.now() / 1000);
    const other = await otherKeyPair();
    const bad = {
      expired: await accessToken({ exp: now - 120 }),
      "not yet valid": await accessToken({ nbf: now + 600 }),
      "wrong audience": await accessToken({ aud: ["someone-else"] }),
      "wrong issuer": await accessToken({ iss: "https://evil.cloudflareaccess.com" }),
      "no email": await accessToken({ email: undefined }),
      "unknown key": await accessToken({}, { kid: "nope" }),
      "forged signature": await accessToken({}, { signWith: other.privateKey }),
      "alg none": (await accessToken({}, { alg: "none" })).split(".").slice(0, 2).join(".") + ".",
      garbage: "not.a.token",
    };
    for (const [name, token] of Object.entries(bad)) {
      const res = await session(token);
      expect(res.status, name).toBe(403);
    }
    const tampered = (await accessToken()).split(".");
    tampered[1] = btoa(JSON.stringify({ aud: [AUD], iss: "x", email: "admin@evil", exp: now + 999 })).replace(/=+$/, "");
    expect((await session(tampered.join("."))).status).toBe(403);
  });
});

describe("request origin rules", () => {
  it("answers admin routes only on the admin hostname", async () => {
    for (const base of [LOCAL_PUBLIC, PROD_PUBLIC]) {
      const res = await call(base + "/api/admin/session", fromEditor("GET", undefined, base), LOCAL_ENV);
      expect(res.status, base).toBe(404);
      const editor = await call(base + "/editor/index.html", {}, LOCAL_ENV);
      expect(editor.status, base).toBe(404);
    }
  });

  it("refuses unknown hostnames", async () => {
    const res = await call("http://127.0.0.1:8787/api/admin/session", fromEditor("GET"), LOCAL_ENV);
    expect(res.status).toBe(404);
    const other = await call("https://clip-website.example.workers.dev/", {}, LOCAL_ENV);
    expect(other.status).toBe(404);
  });

  it("refuses a write from another Origin, or with no Origin", async () => {
    for (const origin of ["https://evil.example", "http://localhost:8787", "http://admin.localhost:9999", "null"]) {
      const res = await call(LOCAL_ADMIN + "/api/admin/session", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" }, LOCAL_ENV);
      expect(res.status, origin).toBe(403);
      expect((await res.json()).error).toMatch(/didn't come from the editor/);
    }
    const none = await call(LOCAL_ADMIN + "/api/admin/session", { method: "POST", body: "{}" }, LOCAL_ENV);
    expect(none.status).toBe(403);
  });

  it("refuses a cross-site read of the API", async () => {
    for (const s of ["cross-site", "same-site", "none"]) {
      const res = await call(LOCAL_ADMIN + "/api/admin/session", { headers: { "Sec-Fetch-Site": s } }, LOCAL_ENV);
      expect(res.status, s).toBe(403);
    }
  });

  it("lets a same-origin write through to the route", async () => {
    const res = await call(LOCAL_ADMIN + "/api/admin/session", fromEditor("POST", {}), LOCAL_ENV);
    expect(res.status).toBe(405); /* the gate passed; the route only answers GET */
  });

  it("sends the security headers", async () => {
    const res = await call(LOCAL_ADMIN + "/api/admin/session", fromEditor("GET"), LOCAL_ENV);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/style-src [^;]*unsafe-inline/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("serves the editor and its files on the admin host only", async () => {
    const page = await call(LOCAL_ADMIN + "/", {}, LOCAL_ENV);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('<script type="module" src="/editor/editor.js"></script>');
    expect(page.headers.get("Content-Security-Policy")).toContain("script-src 'self';");
    for (const f of ["/editor/editor.js", "/editor/canvas.js", "/editor/panels.js", "/editor/editor.css", "/shared/render.js", "/shared/norm.js"]) {
      expect((await call(LOCAL_ADMIN + f, {}, LOCAL_ENV)).status, f).toBe(200);
      expect((await call(LOCAL_PUBLIC + f, {}, LOCAL_ENV)).status, f).toBe(f.startsWith("/editor/") ? 404 : 200);
    }
  });

  it("redirects plain HTTP to HTTPS on real hostnames", async () => {
    const res = await call("http://scuclip.com/about", {}, PROD_ENV);
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://scuclip.com/about");
  });
});

describe("Turnstile", () => {
  it("is required everywhere except local mode", () => {
    expect(turnstileRequired({ local: true })).toBe(false);
    expect(turnstileRequired({ local: false })).toBe(true);
  });

  it("refuses when it isn't configured, or the token is missing or rejected", async () => {
    expect((await verifyTurnstile("tok", {}, "1.2.3.4")).status).toBe(503);
    expect((await verifyTurnstile("", PROD_ENV, "1.2.3.4")).status).toBe(403);
    await stubNetwork({ turnstile: { success: false } });
    expect((await verifyTurnstile("tok", PROD_ENV, "1.2.3.4")).status).toBe(403);
  });

  it("accepts a token Cloudflare confirms for this site", async () => {
    const calls = await stubNetwork({ turnstile: { success: true, hostname: "scuclip.com" } });
    expect(await verifyTurnstile("tok", { ...PROD_ENV, PUBLIC_HOST: "scuclip.com" }, "1.2.3.4")).toEqual({ ok: true });
    const body = calls[0].init.body;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("tok");
  });

  it("refuses a token issued for another hostname", async () => {
    await stubNetwork({ turnstile: { success: true, hostname: "evil.example" } });
    expect((await verifyTurnstile("tok", { ...PROD_ENV, PUBLIC_HOST: "scuclip.com" }, "1.2.3.4")).status).toBe(403);
  });
});
