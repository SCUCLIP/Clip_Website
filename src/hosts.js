/* Which site a request is for, and whether local mode is on.

   Local mode skips the editor's sign-in (Cloudflare Access) and the sign-up form's Turnstile check, so that
   `npm run dev` works with no setup. It is on only when BOTH are true:
   - LOCAL_MODE is "on". Only `npm run dev` sets it (with --var). wrangler.jsonc never does; a test checks that.
   - the request's hostname is localhost, 127.0.0.1 or ends in .localhost.
   A real hostname (scuclip.com, admin.scuclip.com) never gets local mode, whatever LOCAL_MODE says.

   The editor answers only on ADMIN_HOST: admin.scuclip.com, or admin.localhost when `npm run dev` passes
   --var ADMIN_HOST:admin.localhost. That also keeps DNS rebinding out: a page that points its own name at
   127.0.0.1 still sends its own Host, which isn't the admin host. */

export const LOCAL_PUBLIC_HOST = "localhost";

export const isLocalName = (host) => host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");

export function isLocalMode(env, hostname) {
  return env?.LOCAL_MODE === "on" && isLocalName(String(hostname).toLowerCase());
}

/**
 * @returns {{ kind: "public" | "admin" | "www" | null, local: boolean, production: boolean,
 *             publicOrigin: string, adminOrigin: string }}
 */
export function siteFor(url, env) {
  const host = url.hostname.toLowerCase();
  const localName = isLocalName(host);
  const local = isLocalMode(env, host);
  let kind = null;
  if (env.ADMIN_HOST && host === env.ADMIN_HOST) kind = "admin";
  else if (env.PUBLIC_HOST && host === env.PUBLIC_HOST) kind = "public";
  else if (env.PUBLIC_HOST && host === "www." + env.PUBLIC_HOST) kind = "www";
  else if (local) kind = "public";
  const port = url.port ? ":" + url.port : "";
  return {
    kind,
    local,
    production: !localName,
    publicOrigin: localName ? `${url.protocol}//${LOCAL_PUBLIC_HOST}${port}` : `https://${env.PUBLIC_HOST}`,
    adminOrigin: localName ? `${url.protocol}//${env.ADMIN_HOST}${port}` : `https://${env.ADMIN_HOST}`,
  };
}
