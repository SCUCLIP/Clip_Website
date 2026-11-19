/* What Ask CLIP answers from, built from the published content the same way the prototype's faqAnswer() reads it.
   Served as /assets/clip-facts.js, which sets window.CLIP_FACTS for the public site's chat (the same shape as the
   static export's clip-facts.js). */

import { CLUB_EMAIL, VIEW_IDS, arr, str } from "./model.js";
import { xyOrder } from "./render.js";

const pageElements = (doc) => (doc ? doc.sections.flatMap((s) => xyOrder(s.elements)) : []);

/** @param {Record<string, object>} C normalized published docs: every page, "data" and "settings" */
export function buildFacts(C) {
  const faqs = [];
  VIEW_IDS.forEach((p) => (C[p] ? C[p].sections : []).forEach((s) => s.elements.forEach((e) => {
    if (e.type === "list" && e.src === "faq") faqs.push(...arr(e.items).map(({ q, a }) => ({ q, a })));
  })));
  const lede = pageElements(C.biohackathon).find((e) => e.type === "text" && e.kind === "lede");
  const board = pageElements(C.board), i = board.findIndex((e) => e.type === "list" && e.src === "roles");
  const note = i >= 0 && board[i + 1] && board[i + 1].type === "text" ? board[i + 1].text : "";
  const data = C.data || {};
  return {
    email: str(C.settings && C.settings.contactEmail).trim() || CLUB_EMAIL,
    faqs,
    hackLede: lede ? lede.text : "",
    boardNote: note,
    members: arr(data.members).map(({ name, role }) => ({ name, role })),
    speakers: arr(data.speakers).map(({ name, when }) => ({ name, when })),
    events: arr(data.events).map(({ name, month, day, time, location }) => ({ name, month, day, time, location })),
  };
}

/* JSON is valid JavaScript, but escape "<" and the two line separators anyway so the output is safe anywhere. */
const UNSAFE = new RegExp("[<\\u2028\\u2029]", "g");
const escJs = (c) => String.fromCharCode(92) + "u" + c.charCodeAt(0).toString(16).padStart(4, "0");

/** The body of /assets/clip-facts.js. */
export function factsScript(facts) {
  return "/* What Ask CLIP answers from. Built from the published site. */\nwindow.CLIP_FACTS = " + JSON.stringify(facts, null, 1).replace(UNSAFE, escJs) + ";\n";
}
