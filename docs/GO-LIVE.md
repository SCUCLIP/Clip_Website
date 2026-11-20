# Going live

For now the site runs only on a laptop, with no sign-in (local mode in `CLAUDE.md`), plus the static demo on GitHub
Pages. Local mode stays in the code. It can't switch on at scuclip.com, because it needs `LOCAL_MODE=on`, which only
`npm run dev` passes, and a localhost hostname.

Until the steps below are done, a deployed copy stays locked: the editor refuses everyone and sign-ups are refused.
`docs/SETUP.md` has the click-by-click steps.

## 1. Accounts and domain
- [ ] GoDaddy, Cloudflare and DNS for scuclip.com (SETUP.md steps 1 to 3).

## 2. Editor sign-in (Cloudflare Access)
- [ ] Zero Trust, a self-hosted Access application for `admin.scuclip.com` allowing only the board's emails (SETUP.md step 4).
- [ ] Its AUD tag in `ACCESS_AUD` in `wrangler.jsonc`. If the team isn't `scuclip`, fix `ACCESS_TEAM_DOMAIN` too (`https://<team>.cloudflareaccess.com`).

## 3. Storage and the bot check
- [ ] The D1 database `scuclip`: its id in `database_id` in `wrangler.jsonc` (it's a placeholder now). The R2 bucket `scuclip-photos`.
- [ ] A Turnstile widget for scuclip.com: its site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`; its secret as the Worker secret `TURNSTILE_SECRET` after the first deploy (SETUP.md step 5).

## 4. GitHub and the deploy
- [ ] The deploy token, and the `production` environment with required reviewers, the ruleset on `main` (SETUP.md steps 6 and 7).
- [ ] Merge a pull request. `.github/workflows/deploy.yml` runs `npm run check`, applies the D1 migrations (schema and seed; the seed never overwrites edits) and deploys, after an owner approves. Until the token exists it stops without deploying.

## 5. The newsletter Sheet
- [ ] The Google Sheet and its Apps Script in the club's Google account, and the Worker secrets `SHEETS_URL` and `SHEETS_SECRET` (`docs/NEWSLETTER.md`).

## 6. Check it
- [ ] In a private window, admin.scuclip.com asks for the Access sign-in, and the editor shows your email. A request without Access (for example with `curl`) gets 401.
- [ ] A test sign-up shows up in the editor's Site tab and on the Sheet's Weekly email tab. A sign-up without a Turnstile token gets 403; a sixth one in a minute gets 429.
- [ ] `https://scuclip.com` and every page, the 404 page, http to https, www.scuclip.com to scuclip.com, and the response headers (CSP, HSTS).
- [ ] Every page on a real phone.
- [ ] The Access check and Turnstile have only been tested with keys and answers the tests make up. These checks are the first real ones.

## Left for later
### Tooling
- While `npm run dev` runs, wrangler's file watcher can crash on the temporary files some editors write under `public/` ("ENOENT … .tmp"). Start `npm run dev` again if it stops.

### Site and editor
- The editor and the content format are the prototype's (`prototype/clip-website.html`). The prototype had live updates from other editors; here the drafts load again when the editor window gets focus, and a save that clashes with someone else's (409) loads their version and leaves this one on Undo.
- Content in `[brackets]` is still unwritten: meeting time and room, events, speakers, roles, links, Instagram.
- Uploaded photos are never deleted, even when no page uses them. Add a cleanup (list R2 objects not referenced by any draft or published doc) if storage grows.
- Sign-up lists have no unsubscribe link; the privacy line tells people to email the club. Add one before sending a lot of email.
- Like the prototype, the editor has no drag-a-box selection and no cropping. The handles need a mouse or touch; keyboard users can nudge with the arrow keys and type positions in Settings.
- The audit log is in D1 only. Nothing in the editor shows it yet.
- Ask CLIP (the chat in the corner) was removed, as asked. The static export still has it, so the render tests strip it from what they compare with.
- The Worker is plain JavaScript; the original repo's TypeScript conversion was skipped, as asked.

### Hosting
- A WAF rate-limit rule on `POST /api/signup` if spam gets through Turnstile and `SIGNUP_LIMITER`.
- Consider HSTS `includeSubDomains` and preload once every subdomain is HTTPS-only.
