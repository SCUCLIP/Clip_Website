/* CLIP website Worker: the public site on scuclip.com and the editor on admin.scuclip.com.
   In local mode (npm run dev) the same code serves http://localhost:8787 and http://admin.localhost:8787. */

import { siteFor } from "./hosts.js";
import { secure, text, redirect, apiError } from "./http.js";
import { handleAdmin } from "./admin.js";
import { handlePublic } from "./public.js";
import { turnstileSiteKey } from "./turnstile.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const site = siteFor(url, env);
    if (!site.kind) return secure(text("Not found", 404), site);
    /* www.scuclip.com goes to scuclip.com. */
    if (site.kind === "www") return secure(redirect(`https://${env.PUBLIC_HOST}${url.pathname}${url.search}`, 301), site);
    /* Real hostnames are HTTPS only. */
    if (site.production && url.protocol === "http:") {
      url.protocol = "https:";
      return secure(redirect(url.href, 308), site);
    }
    let res;
    try {
      res = site.kind === "admin" ? await handleAdmin(request, env, ctx, site, url) : await handlePublic(request, env, ctx, site, url);
    } catch (err) {
      console.error("Unhandled error", err?.stack || err);
      res = url.pathname.startsWith("/api/") ? apiError(500, "Something went wrong on the server.") : text("Something went wrong on the server.", 500);
    }
    if (request.method === "HEAD" && res.body) res = new Response(null, res);
    return secure(res, site, { turnstile: site.kind === "public" && !!turnstileSiteKey(site, env) });
  },
};
