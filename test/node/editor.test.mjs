/* What the editor saves. The Worker stores what norm() returns, so everything the editor makes must already be
   normalized: otherwise a save would quietly change it. The editor also runs norm() on each doc before sending it
   (flush() in public/editor/editor.js); these tests check the parts it builds new content from. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readSeed } from "./static-html.mjs";
import { DOC_IDS, norm, canon, normElement, DW } from "../../public/shared/model.js";
import { makeElement, ADD_SPECS, SEC_PRESETS } from "../../public/editor/catalog.js";

const unchanged = (id, doc, label) => assert.equal(canon(norm(id, JSON.parse(JSON.stringify(doc)))), canon(doc), label);
const pageWith = (elements) => ({ v: 5, sections: [{ id: "sec1", h: 400, mh: 400, bg: "none", elements }] });

test("every tile in the Add panel makes an element norm() keeps as it is", () => {
  assert.ok(Object.keys(ADD_SPECS).length >= 40);
  for (const [key, { spec }] of Object.entries(ADD_SPECS)) {
    const e = makeElement(spec);
    assert.ok(e, key);
    assert.equal(canon(normElement(JSON.parse(JSON.stringify(e)), 0, new Set())), canon(e), key);
    unchanged("about", pageWith([e]), key);
  }
});

test("every section preset's elements are normalized, and so is a page built from them", () => {
  const elements = [];
  for (const [key, preset] of Object.entries(SEC_PRESETS)) {
    for (const col of preset.cols) {
      let y = 64;
      for (const spec of col.els) {
        const e = makeElement({ w: spec.w || col.w, ...spec });
        assert.ok(e, key);
        e.d.x = col.x;
        e.d.y = y;
        y += 64;
        elements.push(e);
      }
    }
  }
  unchanged("about", pageWith(elements), "presets");
  assert.ok(elements.every((e) => e.d.x >= 0 && e.d.x + e.d.w <= DW + 400));
});

test("the seed, as the editor loads and saves it, comes back unchanged", () => {
  for (const id of DOC_IDS) unchanged(id, norm(id, readSeed(id)), id);
});

test("the editor sends norm()'s result, and keeps the page in step with it", () => {
  const src = fs.readFileSync(path.join(ROOT, "public/editor/editor.js"), "utf8");
  const flush = src.slice(src.indexOf("function flush(doc)"), src.indexOf("async function onConflict"));
  assert.match(flush, /const body = norm\(doc, A\.local\[doc\]\);/);
  assert.match(flush, /api\.saveDraft\(doc, A\.ver\[doc\], body\)/);
});
