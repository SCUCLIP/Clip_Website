/* npm run demo:serve: serve dist/demo (built with the default --base /) at http://127.0.0.1:8790, on this computer
   only, the way GitHub Pages would: files as they are, 404.html for anything missing. */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/demo");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain" };
if (!fs.existsSync(path.join(DIR, "index.html"))) {
  console.error("Build the demo first: npm run demo:build");
  process.exit(1);
}
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  let file = path.join(DIR, p), status = 200;
  if (!file.startsWith(DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(DIR, "404.html"); status = 404; }
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(8790, "127.0.0.1", () => console.log("The demo: http://127.0.0.1:8790/  (editor: http://127.0.0.1:8790/editor/)"));
