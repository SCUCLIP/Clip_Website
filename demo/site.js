/* The demo's public pages. They are built from the seed content, like the static export. This script runs before
   assets/site.js and adds what the demo needs:
   - after this visitor publishes in the demo editor, the page shows their published version (from this browser),
   - sign-ups are kept in this browser, so they show up in the demo editor's Site tab,
   - a note that this is a demo, with links to the editor and a reset. */

import * as store from "./store.js";
import { headerHTML, pageMain, footerHTML } from "../shared/render.js";
import { domSerialize } from "../shared/export.js";
import { VIEW_IDS } from "../shared/model.js";
import { demoLink } from "./links.js";

const site = document.getElementById("site");
const main = site && site.querySelector("main.view");
const page = main ? main.id.replace(/^view-/, "") : "";
if (site && VIEW_IDS.includes(page) && store.publishedChanged()) {
  const C = store.publishedDocs();
  const X = { C, edit: false, idp: "", editor: false, animate: false, exp: true, link: demoLink };
  site.innerHTML = domSerialize(`<div class="page">${headerHTML(X, page)}\n${pageMain(X, page)}\n<div class="wrap">${footerHTML(X)}</div></div>`);
}

/* Sign-ups: assets/site.js posts to /api/signup, which a static host doesn't have. Answer it from here. */
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (input !== "/api/signup") return realFetch(input, init);
  let body = {};
  try { body = JSON.parse((init && init.body) || "{}"); } catch (_) { body = {}; }
  try {
    return Response.json(store.signup(body.email, body.list));
  } catch (e) {
    return Response.json({ error: e.message }, { status: e.status || 400 });
  }
};

/* The demo note, bottom left. */
const note = document.createElement("aside");
note.className = "demo-note";
note.setAttribute("aria-label", "About this demo");
note.innerHTML = '<b>Demo</b><span>Edits stay in this browser.</span><a>Open the editor</a><button type="button">Reset</button>';
note.querySelector("a").href = new URL("../editor.html", import.meta.url).href;
const reset = note.querySelector("button");
let armed = 0;
reset.addEventListener("click", () => {
  if (!armed) { reset.textContent = "Reset everything?"; armed = setTimeout(() => { armed = 0; reset.textContent = "Reset"; }, 4000); return; }
  store.reset();
  location.reload();
});
document.body.appendChild(note);
