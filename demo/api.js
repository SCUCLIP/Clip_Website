/* The demo editor's API: the same functions as public/editor/api.js, answered from this browser's storage
   (demo/store.js) instead of the Worker. The demo build copies this file over editor/api.js. */

import * as store from "../demo/store.js";

const later = (fn) => async (...args) => fn(...args);
/** The demo site's own address, without the trailing slash (the editor's "View site" goes there). */
const siteRoot = () => new URL(".", document.baseURI).href.replace(/\/$/, "");

export const session = later(() => ({ email: "demo", local: true, demo: true, publicOrigin: siteRoot(), adminOrigin: siteRoot() }));
export const docs = later(store.docs);
export const draft = later(store.draft);
export const saveDraft = later(store.saveDraft);
export const publish = later(store.publish);
export const discard = later(store.discard);
export const uploadPhoto = store.uploadPhoto;
export const signups = later(store.signups);
export const deleteSignup = later(store.deleteSignup);
export const signupsCsv = later(store.signupsCsv);

/* ---------- Demo chrome: say where edits go, and offer a reset ---------- */
function addDemoChrome(bar) {
  const domain = bar.querySelector(".adm-domain");
  if (domain) {
    domain.textContent = "Demo";
    domain.title = "This is a demo. Edits, photos and sign-ups stay in this browser. Nothing is sent anywhere.";
  }
  const actions = bar.querySelector(".adm-bar-actions");
  if (!actions || actions.querySelector(".demo-reset")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "adm-btn adm-btn-bar demo-reset";
  btn.textContent = "Reset demo";
  btn.title = "Throw away every change in this browser and start again from the original content";
  let armed = 0;
  btn.addEventListener("click", () => {
    if (!armed) {
      btn.textContent = "Reset everything?";
      armed = setTimeout(() => { armed = 0; btn.textContent = "Reset demo"; }, 4000);
      return;
    }
    clearTimeout(armed);
    store.reset();
    location.reload();
  });
  actions.prepend(btn);
}
new MutationObserver((_, obs) => {
  const bar = document.querySelector("#adm .ce-bar .adm-bar-actions") && document.querySelector("#adm .ce-bar");
  if (bar) { addDemoChrome(bar); obs.disconnect(); }
}).observe(document.documentElement, { childList: true, subtree: true });
