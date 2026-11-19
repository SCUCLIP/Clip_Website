/* What the Add panel offers: element tiles, doodles and section presets, and how a new element is made.
   Ported from prototype/clip-website.html as it is. No DOM here, so the Node tests can check that everything the
   editor makes comes back unchanged from norm(). */

import { uid, DW, SYMS, LISTS, LIST_ORDER, EL, listMake, normElement } from "../shared/model.js";

const NEW_W = { text: 560, image: 380, button: 200, link: 220, doodle: 80, note: 230, stamp: 200, figure: 160, entry: 1180, contact: 560, line: 420, signup: 820, form: 560, callout: 820, list: 1180 };
const SYM_W = { benzene: 100, capsule: 48, tablet: 24, aspirin: 100, chair: 110, tlc: 48, mortar: 70, ballstick: 100, dose: 120, sn2: 140, flask: 96, arrow: 56 };
function makeElement(spec) {
  const type = spec.type, def = EL[type];
  if (!def) return null;
  const base = Object.assign({}, type === "list" ? listMake(spec.src) : def.make(), spec, { id: uid("e"), type });
  base.d = { x: 0, y: 0, w: spec.w || (type === "doodle" ? SYM_W[spec.sym] || 80 : NEW_W[type]) || 300, h: 40 };
  base.m = null;
  base.mHide = type === "doodle";
  base.r = spec.r || 0;
  return normElement(base, 0, new Set());
}

const SEC_PRESETS = {
  blank: { label: "Blank", desc: "An empty band to fill", cols: [] },
  text: { label: "Heading and text", desc: "A heading over a paragraph", cols: [{ x: 0, w: 760, els: [{ type: "text", kind: "section", text: "[Heading]" }, { type: "text", kind: "body", text: "[A few sentences about this part.]", w: 640 }] }] },
  photo: { label: "Photo and text", desc: "A photo beside a heading and paragraph", cols: [{ x: 0, w: 460, els: [{ type: "image", r: -1 }] }, { x: 540, w: 640, els: [{ type: "text", kind: "section", text: "[Heading]" }, { type: "text", kind: "body", text: "[A few sentences about the photo.]" }] }] },
  events: { label: "Events", desc: "Entry line, heading and the events list", cols: [{ x: 0, w: DW, els: [{ type: "entry", tag: "Entry 0XX", label: "Upcoming events", pg: "events" }, { type: "text", kind: "section", text: "Coming up", w: 700 }, { type: "list", src: "events", limit: "3" }, { type: "link", label: "See all events", url: "#events" }] }] },
  signup: { label: "Sign-up note", desc: "The weekly email sign-up", cols: [{ x: 180, w: 820, els: [{ type: "signup", r: -1 }] }] },
  faq: { label: "Questions", desc: "Questions and answers, then the email line", cols: [{ x: 0, w: DW, els: [{ type: "text", kind: "sub", text: "[Questions]", rule: true }, { type: "list", src: "faq" }, { type: "contact", lead: "Email the board:", w: 640 }] }] }
};

const ADD_GROUPS = [
  { label: "Text", tiles: [
    ["t-title", "Title", "Big handwritten heading", { type: "text", kind: "section", text: "[Heading]", w: 700 }],
    ["t-sub", "Heading", "Smaller handwritten heading", { type: "text", kind: "sub", text: "[Heading]", w: 560 }],
    ["t-body", "Paragraph", "Body text", { type: "text", kind: "body", text: "[Write a few sentences here.]", w: 560 }],
    ["t-lede", "Intro", "Larger, softer paragraph", { type: "text", kind: "lede", text: "[One or two sentences to open this part.]", w: 620 }],
    ["t-eyebrow", "Label line", "Small capitals", { type: "text", kind: "eyebrow", text: "[Small label]", w: 420 }],
    ["t-pen", "Pen note", "Red handwriting", { type: "text", kind: "hand", color: "pen", text: "[a quick note]", w: 300 }]
  ] },
  { label: "Photos and shapes", tiles: [
    ["m-photo", "Photo", "Upload a picture", { type: "image" }],
    ["m-logo", "Logo", "The CLIP logo card", { type: "image", src: "logo", frame: "card", caption: "Fig. 1 · our logo", ar: 0.9677, tape: true, w: 330, r: 2 }],
    ["m-note", "Sticky note", "Handwritten note", { type: "note", r: -2 }],
    ["m-stamp", "Stamp", "Red rubber stamp", { type: "stamp", r: -8 }],
    ["m-fig", "Figure", "A labeled lab drawing", { type: "figure", r: -2 }],
    ["m-line", "Line", "A dashed divider", { type: "line" }]
  ] },
  { label: "Buttons and links", tiles: [
    ["b-btn", "Button", "Filled button", { type: "button" }],
    ["b-btn2", "Outline button", "Lighter button", { type: "button", style: "secondary", label: "Learn more", url: "#about" }],
    ["b-link", "Link", "Text link with an arrow", { type: "link" }],
    ["b-email", "Email line", "Club email with Copy", { type: "contact" }],
    ["b-entry", "Entry line", "Notebook entry header", { type: "entry", w: DW }]
  ] },
  { label: "Doodles", doodles: true },
  { label: "Lists", tiles: LIST_ORDER.map((src) => [`l-${src}`, LISTS[src].label, LISTS[src].shared ? "Shared list" : "Its own items", { type: "list", src, w: src === "chips" || src === "steps" ? 760 : DW }]) },
  { label: "Forms and notes", tiles: [
    ["f-signup", "Sign-up note", "Weekly email sign-up", { type: "signup", r: -1, w: 820 }],
    ["f-form", "Email form", "Email box and a button", { type: "form", w: 560 }],
    ["f-callout", "Callout note", "Note with the club email", { type: "callout", r: -0.6, w: 820 }]
  ] }
];
const ADD_SPECS = {};
ADD_GROUPS.forEach((g) => (g.tiles || []).forEach((t) => { ADD_SPECS[t[0]] = { label: t[1], spec: t[3] }; }));
Object.keys(SYMS).forEach((k) => { ADD_SPECS["d-" + k] = { label: SYMS[k].label, spec: { type: "doodle", sym: k, w: SYM_W[k] } }; });

export { NEW_W, SYM_W, makeElement, SEC_PRESETS, ADD_GROUPS, ADD_SPECS };
