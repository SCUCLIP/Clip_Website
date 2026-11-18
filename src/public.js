/* The public site (scuclip.com, or localhost in local mode). Admin routes never answer here. */

import { apiError, html, methodNotAllowed, text } from "./http.js";
import { isAssetPath, serveAsset } from "./assets.js";

export async function handlePublic(request, env, ctx, site, url) {
  const path = url.pathname;
  if (path.startsWith("/api/")) return apiError(404, "Not found");
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
  if (isAssetPath(path, "public")) return serveAsset(env, request, path);
  if (path === "/") return html("<!doctype html><title>CLIP</title><p>The CLIP site renders here (step 4).</p>");
  return text("Not found", 404);
}
