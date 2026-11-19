# Threat model

What the CLIP website protects, from whom, and how. The rules themselves are in `CLAUDE.md` ("Security rules").

## What's worth protecting
- **The published site.** Nobody but the board should be able to change what scuclip.com shows.
- **Sign-up emails.** Students' email addresses on the weekly and Biohackathon lists.
- **Photos and drafts.** Unpublished work in the editor.
- **The club's Cloudflare account.** D1, R2 and the Worker itself.

## Who might attack it
- **Anyone on the internet.** Can reach scuclip.com and admin.scuclip.com, send any request, and fill in forms.
- **A website the editor happens to have open.** Can make the editor's browser send requests (forms, `fetch`, images) to admin.scuclip.com, or to `admin.localhost:8787` while `npm run dev` is running.
- **Bots.** Fill the sign-up lists with junk or other people's addresses.
- **A mistaken editor.** Pastes something odd, or two board members edit the same page at once.

## Threats and defenses

| Threat | Defense |
|---|---|
| Someone edits the site without being on the board | Cloudflare Access in front of admin.scuclip.com, and the Worker checks the Access token on every editor request (signature, audience, issuer, expiry). Missing config refuses everything. |
| Local mode reaches production | Local mode needs `LOCAL_MODE=1` *and* a `localhost` hostname. `LOCAL_MODE` is set only by `npm run dev` on the command line, never in `wrangler.jsonc` (a test checks). Production hostnames never match. |
| Another website changes content through the editor's browser (CSRF) | Writes must carry the editor's own `Origin`; cross-site `Sec-Fetch-Site` is refused on the API; JSON bodies need `Content-Type: application/json`. No CORS headers are ever sent. |
| Another website reads drafts or sign-ups | Same-origin policy (no CORS), `Sec-Fetch-Site` check, `Cross-Origin-Resource-Policy: same-origin`. |
| DNS rebinding against `npm run dev` | The Worker only answers `localhost`, `admin.localhost` and the real hostnames; a rebound name like `evil.example` gets 404. The dev server listens on 127.0.0.1 only. |
| wrangler's own local data API (`/cdn-cgi/local/explorer`) | Turned off by `npm run dev` (`X_LOCAL_EXPLORER=false`). It also refuses foreign `Origin` and `Host` headers on its own. |
| Script injection through content (XSS) | `norm()` on every save; render escapes every field; rich text keeps only six inline tags; links only `#page`, `#anchor`, `https:`, `mailto:`; strict CSP with no inline scripts. |
| Malicious uploads (HTML or SVG pretending to be a photo) | Type checked by the file's first bytes, only PNG/JPEG/WebP/GIF, 5 MB cap, `nosniff`, served from `/photos/<random id>`. |
| Clickjacking the editor | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| Sign-up spam | Turnstile off localhost, list names must exist in published content, 4 KB body cap, duplicates ignored. |
| Finding out who's on a list | Signing up twice returns the same answer as signing up once. |
| Two editors overwrite each other | Draft versions: a stale save gets 409 and the editor reloads. Publish is one transaction and refuses stale drafts. |
| Secrets leak through the repo | No secrets are needed locally. `TURNSTILE_SECRET` goes in with `wrangler secret put`. `.dev.vars`, `.env` and `.wrangler/` are ignored by git. |

## Accepted risks
- **Draft photos are public by id.** A photo uploaded but used only in a draft can be fetched by anyone who knows its 128-bit random id. Ids aren't listed anywhere public.
- **The public site has no JavaScript fallback for sign-ups.** Without JavaScript the form does nothing, as in the original export.
- **Local mode trusts everyone on this computer.** Anyone who can reach 127.0.0.1:8787 while `npm run dev` runs can edit the local copy. It's local data only.
- **Rate limiting** relies on Turnstile and Cloudflare's defaults. Add a WAF rate-limit rule at go-live if spam gets through (see `docs/GO-LIVE.md`).
