#!/usr/bin/env node
// Renders the link-preview images with resvg, 1200 × 630: public/og/<lang>.png for each language, and
// public/og/<lang>/<scenario>.png for the scenario pages (where shared links land). No prices on them: the build
// does not redraw images, so a price on a card would go stale the day the data changes.
// Run when the name, a subtitle or the logo changes, and commit the output. Uses system fonts for the text
// (Windows: Segoe UI, Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic), like the other 1ms.dog tools.
// Usage: npm i && node scripts/og.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import { LANGS } from "./build.mjs";
import { PAGES } from "../src/pages.mjs";
import { fill } from "../src/view.mjs";

const pub = new URL("../public/", import.meta.url);
const HOST = new URL(process.env.SITE_URL || "https://cost.1ms.dog").host;
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();
const logo = Buffer.from(await readFile(new URL("assets/logo-dark.svg", pub))).toString("base64");
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// split a title into at most two lines near the middle (at a space, or anywhere in CJK text)
function lines(title, max) {
  if (title.length <= max) return [title];
  const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(title);
  const mid = Math.ceil(title.length / 2);
  const cut = cjk ? mid : title.lastIndexOf(" ", mid + 4);
  return cut > 3 ? [title.slice(0, cut).trim(), title.slice(cut).trim()] : [title];
}

// three bars of falling cost: the picture behind every card
const bars = () => [[0.92, "#5a5a5a"], [0.55, "#6aa5ff"], [0.18, "#3ecf8e"]]
  .map(([w, c], i) => `<rect x="90" y="${470 + i * 34}" width="${Math.round(600 * w)}" height="22" rx="6" fill="${c}"/>`).join("");

function card(lang, title, sub) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const cjk = /[぀-ヿ㐀-鿿가-힯]/.test(title);
  const ls = lines(title, cjk ? 16 : 28), size = ls.length > 1 ? 58 : 68;
  const subY = 240 + ls.length * (size + 14) + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1c1c1c"/>
  <image href="data:image/svg+xml;base64,${logo}" x="90" y="60" width="250" height="100"/>
  ${ls.map((l, i) => `<text x="90" y="${240 + i * (size + 14)}" font-size="${size}" font-weight="700" fill="#ffffff" font-family="${ff}">${esc(l)}</text>`).join("")}
  <text x="90" y="${subY}" font-size="30" fill="#a0a0a0" font-family="${ff}">${esc(sub)}</text>
  ${bars()}
  <text x="1110" y="566" text-anchor="end" font-size="30" font-weight="600" fill="#3ecf8e" font-family="Consolas, monospace">${HOST}</text>
</svg>`;
}

await mkdir(new URL("og/", pub), { recursive: true });
for (const [lang] of LANGS) {
  const T = (await import(new URL(`../src/i18n/${lang}.mjs`, import.meta.url).href)).default;
  await writeFile(new URL(`og/${lang.toLowerCase()}.png`, pub), render(card(lang, T.name, T.og_sub)));
  await mkdir(new URL(`og/${lang.toLowerCase()}/`, pub), { recursive: true });
  for (const p of PAGES.filter(p => p.kind === "scene")) {
    const title = fill(T.lt_scene, { scene: T["sc_" + p.scene] }).split(/[：:？?]/)[0];
    const sub = T.og_sub;
    await writeFile(new URL(`og/${lang.toLowerCase()}/${p.slug}.png`, pub), render(card(lang, title, sub)));
  }
  console.log("wrote og for " + lang);
}
