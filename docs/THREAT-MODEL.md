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
| Someone edits the site without being on the board | Cloudflare Access in front of admin.scuclip.com, and the Worker checks the Access token on every editor request with `jose` (RS256 signature, audience, issuer, expiry). Missing config refuses everything. No `*.workers.dev` address or preview URLs, which would skip Access. |
| Local mode reaches production | Local mode needs `LOCAL_MODE=on` *and* a hostname of `localhost`, `127.0.0.1` or `*.localhost`. `LOCAL_MODE` and the local `ADMIN_HOST` are set only by `npm run dev` on the command line, never in `wrangler.jsonc` (a test checks). Production hostnames never match. |
| Another website changes content through the editor's browser (CSRF) | Writes must carry the editor's own `Origin`; cross-site `Sec-Fetch-Site` is refused on the API; JSON bodies need `Content-Type: application/json`. No CORS headers are ever sent. |
| Another website reads drafts or sign-ups | Same-origin policy (no CORS), `Sec-Fetch-Site` check, `Cross-Origin-Resource-Policy: same-origin`. |
| DNS rebinding against `npm run dev` | The editor answers only on `ADMIN_HOST` (`admin.localhost` in local mode), and the Worker answers nothing on other names; a rebound name like `evil.example` gets 404. The dev server listens on 127.0.0.1 only. |
| wrangler's own local data API (`/cdn-cgi/local/explorer`) | Turned off by `npm run dev` (`X_LOCAL_EXPLORER=false`). It also refuses foreign `Origin` and `Host` headers on its own. |
| Script injection through content (XSS) | `norm()` on every save; text is plain and escaped on render (`esc()`, `fmt()`); links only `https://` or `#page`/`#anchor` (`safeHref()`); strict CSP with no inline scripts. |
| Malicious uploads (HTML or SVG pretending to be a photo) | Type checked by the file's first bytes, only PNG/JPEG/WebP/GIF, 10 MB cap, `nosniff`, served from `/photos/<random id>`. The editor re-encodes JPEGs before upload, which drops location data. |
| Clickjacking the editor | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| Sign-up spam | Turnstile off localhost, at most 5 sign-ups a minute per IP (`SIGNUP_LIMITER`), only the `weekly` and `biohackathon` lists, 4 KB body cap, duplicates ignored. |
| Finding out who's on a list | Signing up twice returns the same answer as signing up once. |
| Two editors overwrite each other | Draft versions: a stale save gets 409 and the editor reloads. Publish is one transaction and refuses stale drafts. |
| Secrets leak through the repo | No secrets are needed locally. `TURNSTILE_SECRET` goes in with `wrangler secret put`, the deploy token only in the GitHub `production` environment. `.dev.vars`, `.env` and `.wrangler/` are ignored by git, and Claude Code's settings stop it reading them. |
| A board member's action can't be traced | The audit log (D1 `audit_log`) records who published, discarded, uploaded a photo, or deleted or downloaded sign-ups, and when. It holds no visitor data. |
| Someone takes over the domain or the accounts | Auto-renew and domain lock, 2FA on GoDaddy, Cloudflare and GitHub, DNSSEC, personal member accounts, quarterly access review (`docs/SETUP.md`). |
| A malicious or careless code change ships | Pull requests only, CI (`npm run check`) and CodeQL on every pull request, owner review, an approval step before the deploy job can read the Cloudflare token. |
| A compromised dependency or GitHub Action | Few dependencies (`jose` at run time), exact versions with a lockfile, install scripts off (`.npmrc`), actions pinned to commit SHAs, Dependabot, `npm audit` in CI. |
| Sign-up privacy | Emails visible only to the board (the editor and the Sheet, shared with the board only); a privacy line under each form says what's collected, why and how to be taken off; no analytics. |
| Someone else writes to the newsletter Sheet | The Apps Script refuses any request without the shared secret (compared in constant time), which only the Worker has (`SHEETS_SECRET`). The Worker only sends to a `script.google.com` web app address. Values that look like formulas are stored as text. |

## Accepted risks
- **Draft photos are public by id.** A photo uploaded but used only in a draft can be fetched by anyone who knows its 128-bit random id. Ids aren't listed anywhere public.
- **The public site has no JavaScript fallback for sign-ups.** Without JavaScript the form does nothing, as in the original export.
- **Local mode trusts everyone on this computer.** Anyone who can reach 127.0.0.1:8787 while `npm run dev` runs can edit the local copy. It's local data only.
- **The rate limit is per Cloudflare location.** Workers rate limiting counts per data center, so a spread-out bot gets a little more than 5 a minute. Turnstile is the main defense.
