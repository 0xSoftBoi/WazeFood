// Generates the app icon / adaptive icon / splash / favicon PNGs from inline SVG. Run with sharp
// available (e.g. `npm i -g sharp` or `NODE_PATH=…/node_modules node scripts/gen-icons.mjs`). The
// rendered PNGs are committed so a normal install/build needs no image tooling.
//
// Mark: a white location pin (the "Waze" nod) with a downward arrow (prices going down = savings),
// on the brand-green gradient.

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

// sharp is only needed to regenerate assets; resolve it from node_modules, or from SHARP_PATH.
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = require(process.env.SHARP_PATH ?? "sharp");
}

const GRAD = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#13C683"/>
      <stop offset="1" stop-color="#04794F"/>
    </linearGradient>
  </defs>`;

const PIN = (arrow = "#0A7A54") => `
  <path d="M512 196 C 372 196 268 304 268 446 C 268 566 416 700 512 824
           C 608 700 756 566 756 446 C 756 304 652 196 512 196 Z" fill="#ffffff"/>
  <g stroke="${arrow}" stroke-width="60" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M512 356 V520"/>
    <path d="M428 452 L512 536 L596 452"/>
  </g>`;

const FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${GRAD}
  <rect width="1024" height="1024" fill="url(#g)"/>${PIN()}</svg>`;

// Android adaptive foreground: glyph only, scaled into the ~66% safe zone, transparent bg.
const ADAPTIVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.62) translate(-512 -512)">${PIN("#04794F")}</g></svg>`;

// Splash glyph: white pin on transparent (app.json paints the brand-green background).
const SPLASH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g transform="translate(512 512) scale(0.5) translate(-512 -512)">${PIN("#0A7A54")}</g></svg>`;

const png = (svg) => sharp(Buffer.from(svg)).png();

await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
const out = (name) => new URL(`../assets/${name}`, import.meta.url).pathname;

await png(FULL).resize(1024, 1024).toFile(out("icon.png"));
await png(ADAPTIVE).resize(1024, 1024).toFile(out("adaptive-icon.png"));
await png(SPLASH).resize(1024, 1024).toFile(out("splash-icon.png"));
await png(FULL).resize(196, 196).toFile(out("favicon.png"));

console.log("✓ wrote icon.png, adaptive-icon.png, splash-icon.png, favicon.png to mobile/assets/");
