# Setting up scuclip.com

Done once, in this order. Every account belongs to the club, uses connectingleaders@scu.edu and has two-factor authentication turned on. Keep the logins and backup codes in a password manager that at least two officers can open.

## 1. Domain (GoDaddy)
1. Create a GoDaddy account with connectingleaders@scu.edu. Turn on 2-step verification.
2. Buy scuclip.com. Check the renewal price at checkout, since promo prices are usually first-year only. Skip all paid add-ons.
3. Contact details: Organization "Connecting Leaders in Innovation and Pharma", email connectingleaders@scu.edu. Keep privacy on if it's free.
4. Turn on auto-renew, and keep Domain Lock on. A domain that lapses can be bought by anyone.
5. Click GoDaddy's verification email in the club inbox within 15 days, or the domain gets suspended.

## 2. Cloudflare account and DNS
1. Sign up at dash.cloudflare.com with connectingleaders@scu.edu. Turn on two-factor authentication. Save the backup codes.
2. Add a domain: scuclip.com, Free plan. Cloudflare shows two nameservers.
3. In GoDaddy: Domain Portfolio, scuclip.com, DNS, Nameservers, Change nameservers, "I'll use my own nameservers". Enter Cloudflare's two. Save.
4. Wait for Cloudflare's "scuclip.com is now active" email (minutes, sometimes a few hours).
5. Invite each officer who maintains the site as an account member (Manage Account, Members), so nobody has to share the club login.

## 3. Cloudflare security settings
- SSL/TLS: encryption mode **Full (strict)**. Edge Certificates: Always Use HTTPS on, Minimum TLS 1.2, TLS 1.3 on, Automatic HTTPS Rewrites on.
- DNSSEC: DNS, Settings, Enable DNSSEC. Copy the DS record into GoDaddy (DNS, DNSSEC, Add). Check Cloudflare later says DNSSEC is active.
- Security: Bot Fight Mode on. Leave the free managed WAF rules on.
- Email spoofing protection. The domain doesn't send email, so tell the world to reject anything claiming to come from it. Add these DNS records:
  - TXT `@` `v=spf1 -all`
  - TXT `_dmarc` `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s`
  - MX `@` `.` priority 0 (a "null MX". Skip it if Cloudflare won't accept the dot)
  - If the club later wants hello@scuclip.com forwarding to the club inbox, use Cloudflare Email Routing and replace the SPF record with the one it suggests.
- HSTS (Edge Certificates, HTTP Strict Transport Security): turn it on only after the site works over HTTPS. Max-age 6 months, include subdomains, no preload yet.

## 4. Admin login (Cloudflare Zero Trust)
Zero Trust is free for up to 50 users. Cloudflare asks for a card when you pick the free plan, but doesn't charge it.
1. Open Zero Trust from the Cloudflare dashboard. Pick the team name `scuclip`. Choose the Free plan.
2. Settings, Authentication: keep "One-time PIN" (a code sent to the person's email).
3. Access, Applications, Add, Self-hosted. Domain: admin.scuclip.com. Session: 24 hours.
4. Policy "Board", action Allow, include Emails: each officer's SCU email. Nobody else.
5. Copy the application's AUD tag into `ACCESS_AUD` in `wrangler.jsonc`. If you picked another team name, update `ACCESS_TEAM_DOMAIN`.

## 5. Database, photo storage and bot check
In the Cloudflare dashboard (no command line needed):
1. Storage and Databases, D1, Create database named `scuclip`. Copy its id into `database_id` in `wrangler.jsonc`.
2. R2, Create bucket named `scuclip-photos`. Keep public access off. R2 also asks for a card, and its free tier covers a club's photos.
3. Turnstile, Add widget for scuclip.com (managed mode). The site key goes in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`. The secret key goes in the Worker as an encrypted secret named `TURNSTILE_SECRET` (Workers, scuclip, Settings, Variables and Secrets) after the first deploy.

## 6. Deploy token
My Profile, API Tokens, Create Token, start from "Edit Cloudflare Workers":
- Add Account, D1, Edit.
- Account Resources: only the club account. Zone Resources: only scuclip.com.
- Set it to expire at the end of the school year, and put a reminder on the board calendar to replace it.
Copy the token once. It goes straight into GitHub (next step) and nowhere else.

## 7. GitHub
The repository is `SCUCLIP/Clip_Website`. If it moves to a GitHub organization, set these there (Settings):
- Authentication security: require two-factor authentication.
- Member privileges: base permission "No permission".
- Actions, General: allow only actions created by GitHub. Require actions to be pinned to a full commit SHA. Workflow permissions: read repository contents only. Don't let Actions create or approve pull requests.
- Code security: turn on Dependabot alerts and security updates, secret scanning with push protection, and private vulnerability reporting for new repositories.
- Add a second owner (Cindia) so the org never depends on one person.

Repository `Clip_Website` (public is recommended: it makes secret scanning, CodeQL and deploy approvals free):
- Settings, Environments, New environment `production`: required reviewers Gordon and Cindia, deployment branches `main` only. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Settings, Rules, New ruleset for `main`: require a pull request (1 approval, dismiss stale approvals), require the status checks `check` and `analyze`, block force pushes and deletions, require linear history.
- If Claude Code commits under your own GitHub account, you can't approve your own pull requests. Either Cindia approves, or set required approvals to 0 and rely on the production approval step.
- Pages (Settings, Pages): source "GitHub Actions". `.github/workflows/pages.yml` publishes the demo from `main`.
- Code security: if code scanning's "default setup" is on, turn it off. `.github/workflows/codeql.yml` is the advanced setup, and the two can't run together.

## 8. Claude Code
- Open this repository in Claude Code. It reads `CLAUDE.md` and the permission rules in `.claude/settings.json`.
- Don't run `wrangler login` on the computer where Claude Code works. Local development doesn't need it, and without a login there's nothing for it to deploy with.
- Review every pull request before merging. The template has a security checklist.

## 9. After launch
- Every quarter: check that auto-renew and the card on GoDaddy are still good, review who has access in Cloudflare, Zero Trust and GitHub, and remove anyone who left the board.
- When officers change in spring: hand over the password manager, rotate the club email password, and swap the old officers out of the Access policy.
