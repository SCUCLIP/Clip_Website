/* Which site a request is for, and whether local mode is on.

   Local mode skips the editor's sign-in (Cloudflare Access) and the sign-up form's Turnstile check, so that
   `npm run dev` works with no setup. It is on only when BOTH are true:
   - LOCAL_MODE is "1". Only `npm run dev` sets it (with --var). wrangler.jsonc never does; a test checks that.
   - the request's hostname is localhost or admin.localhost.
   A real hostname (scuclip.com, admin.scuclip.com) never gets local mode, whatever LOCAL_MODE says. */

export const LOCAL_PUBLIC_HOST = "localhost";
export const LOCAL_ADMIN_HOST = "admin.localhost";
const LOCAL_HOSTS = new Set([LOCAL_PUBLIC_HOST, LOCAL_ADMIN_HOST]);

export function isLocalMode(env, hostname) {
  return env?.LOCAL_MODE === "1" && LOCAL_HOSTS.has(String(hostname).toLowerCase());
}

/**
 * @returns {{ kind: "public" | "admin" | null, local: boolean, production: boolean,
 *             publicOrigin: string, adminOrigin: string }}
 */
export function siteFor(url, env) {
  const host = url.hostname.toLowerCase();
  const localName = LOCAL_HOSTS.has(host);
  let kind = null;
  if (host === LOCAL_ADMIN_HOST || (env.ADMIN_HOST && host === env.ADMIN_HOST)) kind = "admin";
  else if (host === LOCAL_PUBLIC_HOST || (env.PUBLIC_HOST && host === env.PUBLIC_HOST)) kind = "public";
  const port = url.port ? ":" + url.port : "";
  return {
    kind,
    local: isLocalMode(env, host),
    production: !localName,
    publicOrigin: localName ? `${url.protocol}//${LOCAL_PUBLIC_HOST}${port}` : `https://${env.PUBLIC_HOST}`,
    adminOrigin: localName ? `${url.protocol}//${LOCAL_ADMIN_HOST}${port}` : `https://${env.ADMIN_HOST}`,
  };
}
