# Going live

Everything here needs the club's Cloudflare account. None of it has been done; this repo has only ever run locally.

## 1. Cloudflare resources
- [ ] Add `scuclip.com` to Cloudflare (DNS on Cloudflare).
- [ ] `wrangler d1 create clip-website`, then put the real `database_id` in `wrangler.jsonc` (it's a placeholder now).
- [ ] `wrangler r2 bucket create clip-website-photos`.
- [ ] `wrangler d1 migrations apply DB --remote` to create the tables and the seed content. The seed uses `INSERT OR IGNORE`, so running it again never overwrites edits.

## 2. Editor sign-in (Cloudflare Access)
- [ ] Zero Trust → Access → Applications: add a self-hosted app for `admin.scuclip.com`, with a policy allowing only the board's emails.
- [ ] Copy the team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN` and the app's Audience (AUD) tag into `ACCESS_AUD` in `wrangler.jsonc`.
- [ ] Check that https://admin.scuclip.com asks for sign-in, and that the editor shows your email.

## 3. Sign-up protection (Turnstile)
- [ ] Create a Turnstile widget for `scuclip.com` (managed mode).
- [ ] Put the site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
- [ ] `wrangler secret put TURNSTILE_SECRET` with the widget's secret key. Never commit it.
- [ ] Sign up on the live site and check the address shows in the editor's Site tab.

## 4. Deploy
- [ ] `npm ci && npm run check`.
- [ ] `wrangler deploy`. The custom domains in `wrangler.jsonc` are created on first deploy.
- [ ] Check `https://scuclip.com` and every page, the 404 page, HTTP → HTTPS, and the response headers (CSP, HSTS).

## 5. Check on the live site what local mode can't
- [ ] Access: the Worker's token check has only been tested with keys the tests make up. Sign in for real and check the editor works, and that a request without Access (for example with `curl`) gets 401.
- [ ] Turnstile: the widget and `siteverify` have only been tested with a stubbed Cloudflare. Sign up on the live site, and check a sign-up without a token gets 403.
- [ ] Look at every page on a real phone.

## Left for later
### Tooling
- wrangler is pinned at 4.156.2; 4.164.0 is out. Upgrade deliberately, keeping `--infer-origin-from-routes=false` working.
- While `npm run dev` runs, wrangler's file watcher can crash on the temporary files some editors write under `public/` ("ENOENT … .tmp"). Start `npm run dev` again if it stops.

### Site and editor
- The editor and the content format are the prototype's (`prototype/clip-website.html`). The prototype had live updates from other editors; here the drafts load again when the editor window gets focus, and a save that clashes with someone else's (409) loads their version and leaves this one on Undo.
- Content in `[brackets]` is still unwritten: meeting time and room, events, speakers, roles, links, Instagram.
- Uploaded photos are never deleted, even when no page uses them. Add a cleanup (list R2 objects not referenced by any draft or published doc) if storage grows.
- Sign-up lists have no unsubscribe link; people email the club. Add one before sending a lot of email.
- Like the prototype, the editor has no drag-a-box selection and no cropping. The handles need a mouse or touch; keyboard users can nudge with the arrow keys and type positions in Settings.
- Not done yet, from the original repo's CLAUDE.md (left for later, as asked): the Access check with `jose` (`src/security/access.ts`), the sign-up rate limit (`SIGNUP_LIMITER`), the audit log, the privacy line under each sign-up form, the CI, CodeQL and deploy workflows, the `scuclip`/`scuclip-photos` names and the www route, and the zip's wrangler and vitest versions.
- Ask CLIP answers from published content only (FAQ, board, speakers, events). The Claude-powered chat mode was dropped, as asked.

### Hosting
- `www.scuclip.com`: add a redirect rule to `scuclip.com` if people type it.
- A WAF rate-limit rule on `POST /api/signup` if spam gets through Turnstile.
- Consider HSTS `includeSubDomains` and preload once every subdomain is HTTPS-only.
