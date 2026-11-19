/* Links as the demo's static pages write them: #about -> about.html, #home -> index.html, #join -> index.html#join.
   Every demo page has <base href> set to the demo's root, so these work from any page, the editor's included. */
const PAGES = ["home", "about", "events", "biohackathon", "speakers", "board", "resources", "faq"];

export function demoLink(href) {
  if (!href.startsWith("#")) return href;
  const id = href.slice(1);
  if (id === "home") return "index.html";
  return PAGES.includes(id) ? id + ".html" : "index.html" + href;
}
export const pageFile = (id) => (id === "home" ? "index" : id) + ".html";
