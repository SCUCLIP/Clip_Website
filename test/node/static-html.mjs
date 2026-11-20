/* What prototype/static/<file> should look like once its links and asset paths are rewritten for the Worker.
   These are the only differences the render is allowed to have from the original export. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STATIC_FILES = {
  home: "index.html", about: "about.html", events: "events.html", biohackathon: "biohackathon.html",
  speakers: "speakers.html", board: "board.html", resources: "resources.html", faq: "faq.html",
};

export function expectedHtml(id) {
  const html = fs.readFileSync(path.join(ROOT, "prototype/static", STATIC_FILES[id]), "utf8");
  return html
    /* Fonts are self-hosted instead of loaded from Google Fonts. */
    .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">/, '<link rel="stylesheet" href="/fonts/fonts.css">')
    /* Asset paths become absolute. */
    .replace(/(src|href)="assets\//g, '$1="/assets/')
    /* Page links become clean URLs. */
    .replace(/href="index\.html#/g, 'href="/#')
    .replace(/href="index\.html"/g, 'href="/"')
    .replace(/href="(about|events|biohackathon|speakers|board|resources|faq)\.html"/g, 'href="/$1"')
    /* Every sign-up form has a privacy line under its status line. */
    .replace(/(\n( *)<p class="form-status" id="st-[^"]+" role="status" aria-live="polite"><\/p>)/g,
      '$1\n$2<p class="form-privacy">We use your email only to send you CLIP news. To be taken off the list, email connectingleaders@scu.edu.</p>')
    /* Ask CLIP was removed: its button, its panel and its facts script. */
    .replace(/<button class="chat-launcher"[\s\S]*?<\/section>\n/, "")
    .replace('<script src="/assets/clip-facts.js"></script>\n', "")
    /* site.js is an ES module now (it imports the shared layout code). */
    .replace('<script src="/assets/site.js"></script>', '<script type="module" src="/assets/site.js"></script>');
}

export const readSeed = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, "content/seed", id + ".json"), "utf8"));
