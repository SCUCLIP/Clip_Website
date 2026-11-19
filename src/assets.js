/* Static files from public/. The Worker runs first for every request (run_worker_first), so it decides which
   files each host may serve: the editor's files only on the admin host. */

const SHARED = ["/assets/", "/fonts/", "/shared/"];
const PREFIXES = { public: SHARED, admin: [...SHARED, "/editor/"] };

/** True when `path` is a static file this host may serve. */
export function isAssetPath(path, kind) {
  if (/[%\\]|\/\/|\/\.|\.\./.test(path)) return false;
  return (PREFIXES[kind] ?? []).some((p) => path.startsWith(p) && path.length > p.length);
}

export async function serveAsset(env, request, path) {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method }));
  if (res.status === 404) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return res;
}
