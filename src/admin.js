/* The editor host (admin.scuclip.com, or admin.localhost in local mode).

   Every request goes through gate() before any route runs:
   1. API calls (/api/admin/*) must come from the editor itself: a Sec-Fetch-Site header, when the browser sends
      one, must say same-origin.
   2. Anything that can change data (every method except GET and HEAD) must carry an Origin header equal to the
      editor's own origin. Other websites open in the same browser can't change anything.
   3. Sign-in: Cloudflare Access, checked by verifyAccess(). Skipped only in local mode (see hosts.js). */

import { apiError, json, text, methodNotAllowed } from "./http.js";
import { verifyAccess } from "./access.js";
import { isAssetPath, serveAsset } from "./assets.js";

const SAFE = new Set(["GET", "HEAD"]);

/** @returns {Promise<{res: Response} | {editor: {email: string, local: boolean}}>} */
export async function gate(request, env, site, url) {
  const path = url.pathname;
  const isApi = path.startsWith("/api/");
  const deny = (status, msg) => ({ res: isApi ? apiError(status, msg) : text(msg, status) });

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (isApi && fetchSite && fetchSite !== "same-origin") return deny(403, "Editor requests must come from the editor itself.");
  if (!SAFE.has(request.method)) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== url.origin) return deny(403, "This change didn't come from the editor, so it was refused.");
  }
  if (site.local) return { editor: { email: "local", local: true } };
  const who = await verifyAccess(request, env);
  if (!who.ok) return deny(who.status, who.message);
  return { editor: { email: who.email, local: false } };
}

/* Routes: [method, pattern, handler]. Patterns are matched against the path; :id captures one segment. */
const ROUTES = [];
export function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  ROUTES.push({ method, re, keys, handler });
}

route("GET", "/api/admin/session", (c) => json({
  email: c.editor.email,
  local: c.editor.local,
  publicOrigin: c.site.publicOrigin,
  adminOrigin: c.site.adminOrigin,
}));

export async function handleAdmin(request, env, ctx, site, url) {
  const path = url.pathname;
  const g = await gate(request, env, site, url);
  if (g.res) return g.res;
  const c = { request, env, ctx, site, url, editor: g.editor, params: {} };

  if (path === "/" || path === "/index.html") {
    if (!SAFE.has(request.method)) return methodNotAllowed("GET, HEAD");
    return serveAsset(env, request, "/editor/index.html");
  }
  if (isAssetPath(path, "admin")) {
    if (!SAFE.has(request.method)) return methodNotAllowed("GET, HEAD");
    return serveAsset(env, request, path);
  }

  let allowed = [];
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (r.method !== method) { allowed.push(r.method); continue; }
    r.keys.forEach((k, i) => { c.params[k] = decodeURIComponent(m[i + 1]); });
    return r.handler(c);
  }
  if (allowed.length) return methodNotAllowed(allowed.join(", "));
  return path.startsWith("/api/") ? apiError(404, "Not found") : text("Not found", 404);
}
