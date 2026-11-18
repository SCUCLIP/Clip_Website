/* What Ask CLIP answers from, built from the published content. Served as /assets/clip-facts.js, which sets
   window.CLIP_FACTS for the public site's chat (same shape as the original export's clip-facts.js). */

const listItems = (doc, kind) => {
  for (const s of doc?.sections ?? []) for (const e of s.els) if (e.type === "list" && e.kind === kind) return e.items;
  return [];
};

/** @param {Record<string, object>} docs published docs by id (site, faq, board, speakers, events, biohackathon) */
export function buildFacts(docs) {
  return {
    email: docs.site?.email ?? "",
    faqs: listItems(docs.faq, "faq").map(({ q, a }) => ({ q, a })),
    hackLede: docs.biohackathon?.description ?? "",
    boardNote: docs.site?.chat?.boardNote ?? "",
    members: listItems(docs.board, "members").map(({ name, role }) => ({ name, role })),
    speakers: listItems(docs.speakers, "speakers").map(({ name, when }) => ({ name, when })),
    events: listItems(docs.events, "events").map(({ name, month, day, time, location }) => ({ name, month, day, time, location })),
  };
}

/* JSON is valid JavaScript, but escape "<" and the two line separators anyway so the output is safe anywhere. */
const UNSAFE = new RegExp("[<\\u2028\\u2029]", "g");
const esc = (c) => String.fromCharCode(92) + "u" + c.charCodeAt(0).toString(16).padStart(4, "0");

/** The body of /assets/clip-facts.js. */
export function factsScript(facts) {
  return "/* What Ask CLIP answers from. Built from the published site. */\nwindow.CLIP_FACTS = " + JSON.stringify(facts, null, 1).replace(UNSAFE, esc) + ";\n";
}

export const FACT_DOCS = ["site", "faq", "board", "speakers", "events", "biohackathon"];
