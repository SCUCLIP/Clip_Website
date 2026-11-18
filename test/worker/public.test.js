/* The public site: pages at clean URLs, the 404 page, redirects, files, Ask CLIP facts and the CSP. */
import { describe, expect, it } from "vitest";
import { call, fromEditor, LOCAL_ADMIN, LOCAL_PUBLIC, PROD_PUBLIC, LOCAL_ENV, PROD_ENV } from "./helpers.js";

const get = (path, init = {}, envOver = LOCAL_ENV, base = LOCAL_PUBLIC) => call(base + path, init, envOver);
const api = (path, method = "GET", body) => call(LOCAL_ADMIN + path, fromEditor(method, body), LOCAL_ENV);
const PAGES = { "/": "CLIP · Connecting Leaders", "/about": "About · CLIP", "/events": "Events · CLIP", "/biohackathon": "Biohackathon · CLIP",
  "/speakers": "Speakers · CLIP", "/board": "Board · CLIP", "/resources": "Resources · CLIP", "/faq": "FAQ · CLIP" };

describe("pages", () => {
  it("renders every page at its clean URL", async () => {
    for (const [path, title] of Object.entries(PAGES)) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      const html = await res.text();
      expect(html).toContain(`<title>${title}`);
      expect(html).toContain('<script type="module" src="/assets/site.js"></script>');
      if (path !== "/") expect(html).toContain(`<a href="${path}" aria-current="page">`);
    }
  });

  it("serves the 404 page for anything else", async () => {
    for (const path of ["/nope", "/about/team", "/editor/index.html", "/.env", "/wrangler.jsonc"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain("This page isn't in the notebook");
    }
  });

  it("redirects the export's .html addresses and trailing slashes", async () => {
    const cases = { "/index.html": "/", "/about.html": "/about", "/faq.html?x=1": "/faq?x=1", "/events/": "/events" };
    for (const [from, to] of Object.entries(cases)) {
      const res = await get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get("Location"), from).toBe(to);
    }
  });

  it("answers HEAD without a body, and refuses other methods", async () => {
    const head = await get("/about", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await get("/about", { method: "POST", headers: { Origin: LOCAL_PUBLIC } })).status).toBe(405);
  });

  it("shows a published edit, and not a draft", async () => {
    const { draft, version } = await (await api("/api/admin/drafts/about")).json();
    draft.sections[0].els[1].text = "What CLIP <b>really</b> does";
    const saved = await (await api("/api/admin/drafts/about", "PUT", { version, doc: draft })).json();
    expect(await (await get("/about")).text()).not.toContain("really");
    await api("/api/admin/publish", "POST", { versions: { about: saved.version } });
    expect(await (await get("/about")).text()).toContain('What CLIP <b>really</b> does</h1>');
  });

  it("sends a strict CSP: fonts and styles only from the site", async () => {
    const res = await get("/");
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain("googleapis");
    expect(csp).not.toContain("challenges.cloudflare.com");
    const html = await res.text();
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).not.toContain("turnstile-sitekey");
  });

  it("adds Turnstile to pages off localhost only when it's set up", async () => {
    const res = await get("/", {}, PROD_ENV, PROD_PUBLIC);
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(await res.text()).toContain('<meta name="turnstile-sitekey" content="site-key">');
  });
});

describe("files", () => {
  it("serves the site's CSS, script, shared modules, fonts and logos", async () => {
    const files = { "/assets/site.css": "text/css", "/assets/site.js": "javascript", "/shared/layout.js": "javascript",
      "/fonts/fonts.css": "text/css", "/fonts/caveat-latin.woff2": "font/woff2", "/assets/clip-mark.png": "image/png" };
    for (const [path, type] of Object.entries(files)) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type"), path).toContain(type);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("doesn't serve the editor's files or anything outside the allowed folders", async () => {
    for (const path of ["/editor/index.html", "/editor/editor.js", "/assets/../editor/index.html", "/assets/%2e%2e/editor/index.html", "/assets/", "/fonts/missing.woff2"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("builds Ask CLIP's facts from published content", async () => {
    const res = await get("/assets/clip-facts.js");
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    const js = await res.text();
    expect(js).toMatch(/^\/\* What Ask CLIP answers from/);
    const facts = JSON.parse(js.replace(/^[\s\S]*?window\.CLIP_FACTS = /, "").replace(/;\s*$/, ""));
    expect(facts.email).toBe("connectingleaders@scu.edu");
    expect(facts.faqs).toHaveLength(6);
    expect(facts.members.map((m) => m.name)).toContain("Cindia Qi");

    const { draft, version } = await (await api("/api/admin/drafts/site")).json();
    draft.email = "board@scu.edu";
    const saved = await (await api("/api/admin/drafts/site", "PUT", { version, doc: draft })).json();
    await api("/api/admin/publish", "POST", { versions: { site: saved.version } });
    expect(await (await get("/assets/clip-facts.js")).text()).toContain('"email": "board@scu.edu"');
    expect(await (await get("/")).text()).toContain('<span class="addr">board@scu.edu</span>');
  });
});
