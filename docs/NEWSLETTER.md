# The newsletter sign-up sheet

Every newsletter sign-up on the real site goes to a Google Sheet automatically: the Weekly email list and the
Biohackathon list each get a tab. The Sheet is the list the board sends the newsletter from.

How it works: the site's Worker checks each sign-up (bot check, rate limit, a real email address), keeps it in its
own database, and sends it to a small Apps Script attached to the Sheet (`apps-script/newsletter.gs`). The script
only accepts requests that carry a shared secret, so nobody else can add rows. If the Sheet can't be reached, the
sign-up waits and is sent again every 15 minutes. Deleting a sign-up in the editor's Site tab takes it off the Sheet
too. The GitHub Pages demo never sends anything to the Sheet.

Set it up once, in the club's Google account (connectingleaders@scu.edu), so it stays with the club. It needs the
site to be deployed (`docs/GO-LIVE.md`) before the last step.

## 1. The Sheet and the script
1. In Google Drive, create a Google Sheet named **CLIP newsletter sign-ups**. Share it only with the board.
2. In the Sheet: **Extensions > Apps Script**. Delete the sample code, paste in all of `apps-script/newsletter.gs`,
   and save (the disk icon). Name the project **CLIP newsletter**.
3. Make a secret: a long random value. For example, in a terminal: `node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"`.
   Keep it in the board's password manager.
4. In Apps Script: **Project Settings** (the gear) **> Script properties > Add script property**.
   Property `SECRET`, value: the secret. Save.

## 2. Deploy the script as a web app
1. **Deploy > New deployment**. Select type: **Web app**.
2. Description: `CLIP newsletter`. Execute as: **Me (connectingleaders@scu.edu)**. Who has access: **Anyone**.
   ("Anyone" lets the website reach it without a Google sign-in; the secret is what keeps others out.)
3. **Deploy**, then **Authorize access** with the club account. Google warns that the app isn't verified, because
   it's your own script: **Advanced > Go to CLIP newsletter**, then **Allow**. It asks to edit this Sheet only.
4. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/.../exec`.
5. Check it: open that URL in a browser. It should show `{"ok":true,"what":"CLIP newsletter sign-ups. ..."}`.

To change the script later: paste the new code, save, then **Deploy > Manage deployments > Edit (pencil) > Version:
New version > Deploy**. The URL stays the same.

## 3. Connect the site
After the site's first deploy, give the Worker the two values as encrypted secrets. In the Cloudflare dashboard:
**Workers & Pages > scuclip > Settings > Variables and Secrets > Add**, type **Secret**:
- `SHEETS_URL`: the Web app URL.
- `SHEETS_SECRET`: the secret from step 1.

(Or from a terminal signed in to the club's Cloudflare account: `npx wrangler secret put SHEETS_URL`, then
`npx wrangler secret put SHEETS_SECRET`.) Never put either value in the repo.

## 4. Check it
1. Sign up on scuclip.com with your own email. Within a few seconds it's on the **Weekly email** tab.
2. The editor's Site tab says "Every sign-up is in the Google Sheet."
3. Delete that sign-up in the Site tab. The row disappears from the Sheet.

## Sending the newsletter
Copy the email column of the tab into the BCC field, or use a mail merge from the Sheet (for example Gmail's mail
merge, or a Sheets add-on). People who want off the list email the club: delete them in the editor's Site tab, which
also takes them off the Sheet.

## If something goes wrong
- The Site tab says sign-ups aren't in the Sheet yet: the script can't be reached, or the secret doesn't match.
  Open the Web app URL in a browser to check it answers, and check `SHEETS_SECRET` matches the script property
  `SECRET` exactly. "Send to the Sheet now" tries again straight away.
- If the secret ever leaks: make a new one, change the script property and the Worker secret to it.
- Rows deleted by hand in the Sheet stay in the site's own list; delete them in the Site tab too.

## Testing it locally (optional)
`npm run dev` doesn't need the Sheet: sign-ups stay in the local database and the Site tab says the Sheet isn't
connected. To try the real Sheet from your laptop, put `SHEETS_URL=...` and `SHEETS_SECRET=...` in a `.dev.vars`
file (git ignores it) and restart `npm run dev`. Use a test copy of the Sheet, not the real list.
