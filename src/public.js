/* The public site (scuclip.com, or localhost in local mode). Admin routes never answer here.
   Pages are rendered from published content on every request with the shared render code. */

import { apiError, html, methodNotAllowed, redirect, text } from "./http.js";
import { isAssetPath, serveAsset } from "./assets.js";
import { servePhoto } from "./photos.js";
import { handleSignup } from "./signup.js";
import { getPublished } from "./db.js";
import { turnstileSiteKey } from "./turnstile.js";
import { renderPage, renderNotFound } from "../public/shared/render.js";
import { buildFacts, factsScript, FACT_DOCS } from "../public/shared/facts.js";
import { PAGE_IDS, pagePath } from "../public/shared/pages.js";

const PAGE_BY_PATH = new Map(PAGE_IDS.map((id) => [pagePath(id), id]));
const NO_CACHE = { "Cache-Control": "no-cache" };

const notLoaded = () => text("The site's content isn't in the database yet. Run `npm run dev`, which applies the migrations.", 503);

export async function handlePublic(request, env, ctx, site, url) {
  const path = url.pathname;
  if (path === "/api/signup") return handleSignup(request, env, site, url);
  if (path.startsWith("/api/")) return apiError(404, "Not found");
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");

  if (path === "/assets/clip-facts.js") {
    const docs = await getPublished(env, FACT_DOCS);
    return new Response(factsScript(buildFacts(docs)), { headers: { "Content-Type": "text/javascript; charset=utf-8", ...NO_CACHE } });
  }
  if (path.startsWith("/photos/")) return servePhoto(env, request, path.slice(8));
  if (isAssetPath(path, "public")) return serveAsset(env, request, path);

  /* Old .html addresses from the static export, and trailing slashes, go to the clean URL. */
  const legacy = /^\/(index|about|events|biohackathon|speakers|board|resources|faq)\.html$/.exec(path);
  if (legacy) return redirect((legacy[1] === "index" ? "/" : "/" + legacy[1]) + url.search, 301);
  if (path.length > 1 && path.endsWith("/") && PAGE_BY_PATH.has(path.slice(0, -1))) return redirect(path.slice(0, -1) + url.search, 301);

  const id = PAGE_BY_PATH.get(path);
  const docs = await getPublished(env, id ? ["site", id] : ["site"]);
  if (!docs.site || (id && !docs[id])) return notLoaded();
  if (!id) return html(renderNotFound(docs.site), 404, NO_CACHE);
  return html(renderPage(docs.site, docs[id], { turnstileSiteKey: turnstileSiteKey(site, env) }), 200, NO_CACHE);
}
