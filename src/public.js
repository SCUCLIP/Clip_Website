/* The public site (scuclip.com, or localhost in local mode). Admin routes never answer here.
   Pages are rendered from published content on every request with the shared render code. */

import { apiError, html, methodNotAllowed, redirect, text } from "./http.js";
import { isAssetPath, serveAsset } from "./assets.js";
import { servePhoto } from "./photos.js";
import { handleSignup } from "./signup.js";
import { getPublished } from "./db.js";
import { turnstileSiteKey } from "./turnstile.js";
import { norm, VIEW_IDS } from "../public/shared/model.js";
import { renderPage, renderNotFound, pagePath } from "../public/shared/export.js";

const PAGE_BY_PATH = new Map(VIEW_IDS.map((id) => [pagePath(id), id]));
const NO_CACHE = { "Cache-Control": "no-cache" };

const notLoaded = () => text("The site's content isn't in the database yet. Run `npm run dev`, which applies the migrations.", 503);

/** Published docs by id, normalized so the render always gets the shape it expects. Null if one is missing. */
async function publishedDocs(env, ids) {
  const raw = await getPublished(env, ids);
  const C = {};
  for (const id of ids) {
    if (!raw[id]) return null;
    C[id] = norm(id, raw[id]);
  }
  return C;
}

export async function handlePublic(request, env, ctx, site, url) {
  const path = url.pathname;
  if (path === "/api/signup") return handleSignup(request, env, ctx, site, url);
  if (path.startsWith("/api/")) return apiError(404, "Not found");
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

  if (path.startsWith("/photos/")) return servePhoto(env, request, path.slice(8));
  if (isAssetPath(path, "public")) return serveAsset(env, request, path);

  /* Old .html addresses from the static export, and trailing slashes, go to the clean URL. */
  const legacy = /^\/(index|about|events|biohackathon|speakers|board|resources|faq)\.html$/.exec(path);
  if (legacy) return redirect((legacy[1] === "index" ? "/" : "/" + legacy[1]) + url.search, 301);
  if (path.length > 1 && path.endsWith("/") && PAGE_BY_PATH.has(path.slice(0, -1))) return redirect(path.slice(0, -1) + url.search, 301);

  const id = PAGE_BY_PATH.get(path);
  const C = await publishedDocs(env, id ? [id, "data", "settings"] : ["data", "settings"]);
  if (!C) return notLoaded();
  if (!id) return html(renderNotFound(C), 404, NO_CACHE);
  return html(renderPage(C, id, { turnstileSiteKey: turnstileSiteKey(site, env) }), 200, NO_CACHE);
}
