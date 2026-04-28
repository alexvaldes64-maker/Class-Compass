import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const indexPath = join(process.cwd(), "dist", "index.html");
let html = readFileSync(indexPath, "utf8");

// The Vite bundle is self-contained, so it can run as a classic script.
// This keeps the challenge preview working when opened directly via file://.
html = html.replace(
  /<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/,
  '<script defer src="$1"></script>'
);
html = html.replace(/<link rel="stylesheet" crossorigin href=/, '<link rel="stylesheet" href=');

writeFileSync(indexPath, html);
