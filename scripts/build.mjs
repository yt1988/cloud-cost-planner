#!/usr/bin/env node
// Builds the static site in public/ from src/ and data/:
//   index.html, <lang>/index.html                   the planner per language
//   <slug>/, <lang>/<slug>/                         scenario, egress, comparison and "cheapest" pages (src/pages.mjs)
//   assets/app.<hash>.js, assets/app.<hash>.css     app code (engine, views and price data inside) and styles
//   assets/l.<lang>.<hash>.js                       the language's strings for the browser
//   data/*.json                                     the price data, open to anyone (CORS)
//   sitemap.xml, robots.txt, llms.txt, _headers     SEO and security headers (CSP)
// Every page is prerendered with its default result, so the numbers are in the HTML.
// Usage: node scripts/build.mjs          write the files
//        node scripts/build.mjs --check  exit 1 if anything is out of date (CI)
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { loadData } from "./data.mjs";
import { recommend, verifiedAt, toQuery } from "../src/calc.mjs";
import { SCENES, SIZES } from "../src/scenes.mjs";
import { PAGES, stateOf, facts } from "../src/pages.mjs";
import { esc, fill, formats, verdict, picksHTML, tableHTML, curveHTML } from "../src/view.mjs";

const SITE = (process.env.SITE_URL || "https://cost.1ms.dog").replace(/\/+$/, "");
const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
// language, URL folder, og:locale; the first is the root
export const LANGS = [["en", "", "en_US"], ["zh-CN", "zh-cn", "zh_CN"], ["zh-TW", "zh-tw", "zh_TW"], ["ja", "ja", "ja_JP"], ["ko", "ko", "ko_KR"],
  ["es", "es", "es_ES"], ["fr", "fr", "fr_FR"], ["de", "de", "de_DE"], ["pt", "pt", "pt_BR"], ["ru", "ru", "ru_RU"]];
// Runs before first paint: the saved theme; on the English root, a saved or browser language sends the visitor on.
const PREPAINT = `(function(){var d=document.documentElement,th=null,s=null;try{th=localStorage.getItem("cloud-cost:theme");s=localStorage.getItem("cloud-cost:lang")}catch(e){}if(th==="light"||th==="dark")d.setAttribute("data-theme",th);if(!d.hasAttribute("data-root"))return;var P=JSON.parse(d.getAttribute("data-paths")||"{}"),l=null;if(P[s])l=s;for(var ls=navigator.languages||[navigator.language||"en"],i=0;!l&&!s&&i<ls.length;i++){var x=String(ls[i]).toLowerCase(),b=x.split("-")[0];l=b==="zh"?(/tw|hk|mo|hant/.test(x)?"zh-TW":"zh-CN"):P[b]?b:null}if(l&&l!=="en")location.replace(P[l]+location.search+location.hash)})();`;
const hash = s => createHash("sha256").update(s).digest("hex").slice(0, 10);
const sha = s => createHash("sha256").update(s).digest("base64");
const CJK = "\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af";
// a Latin name inside Chinese text gets a space at the boundary ("云成本 AWS")
const spaced = (s, lang) => lang.startsWith("zh") ? s.replace(new RegExp(`([${CJK}])([A-Za-z0-9$€¥])`, "g"), "$1 $2").replace(new RegExp(`([A-Za-z0-9%])([${CJK}])`, "g"), "$1 $2") : s;

async function writeRetry(url, text) {
  for (let i = 0; ; i++) {
    try { return await writeFile(url, text); }
    catch (e) { if (i >= 4 || !["UNKNOWN", "EBUSY", "EPERM"].includes(e.code)) throw e; await new Promise(r => setTimeout(r, 150 * (i + 1))); }
  }
}

async function loadI18n() {
  const out = {};
  for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs")))
    out[f.slice(0, -4)] = (await import(new URL("i18n/" + f, src).href + "?" + Date.now())).default;
  return out;
}

// the engine, views and presets as one script body (no import/export), for the browser bundle
async function lib() {
  const parts = await Promise.all(["calc.mjs", "scenes.mjs", "view.mjs"].map(f => readFile(new URL(f, src), "utf8")));
  return parts.map(s => s.replace(/^import [^;]+;\n/gm, "").replace(/^export /gm, "")).join("\n");
}

export async function build({ check = false } = {}) {
  const I = await loadI18n(), en = I.en, D = loadData();
  // every language must have every key: a missing translation fails the build instead of falling back to English
  for (const [l] of LANGS) {
    if (!I[l]) throw new Error(`src/i18n/${l}.mjs missing`);
    const miss = Object.keys(en).filter(k => !(k in I[l]));
    if (miss.length) throw new Error(`${l}: missing ${miss.join(", ")}`);
    if (I[l].docs.length !== en.docs.length) throw new Error(`${l}: ${I[l].docs.length} questions, en has ${en.docs.length}`);
  }
  const tpl = await readFile(new URL("page.html", src), "utf8");
  const verified = verifiedAt(D);
  const appSrc = await readFile(new URL("app.js", src), "utf8");
  // the price data, engine and views go inside the app's script, at its /* @lib */ marker
  if (!appSrc.includes("/* @lib */")) throw new Error("src/app.js has no /* @lib */ marker");
  const lib0 = await lib();
  const appCode = appSrc.replace("/* @lib */", () => `const D = ${JSON.stringify(D)};\n${lib0}`);
  new Function(appCode);                                                  // must parse
  const js = (await transform(appCode, { loader: "js", minify: true, target: "es2020", legalComments: "none" })).code;
  const cssFull = (await Promise.all(["fonts.css", "style.css"].map(f => readFile(new URL(f, src), "utf8")))).join("\n");
  const css = (await transform(cssFull, { loader: "css", minify: true, legalComments: "none" })).code;
  const jsName = `app.${hash(js)}.js`, cssName = `app.${hash(css)}.css`;

  const RUNTIME_SKIP = new Set(["docs", "seo_title", "seo_desc", "seo_kw", "og_sub", "lede", "h1", "lang_name"]);
  const path = (slug, sub) => "/" + (slug ? slug + "/" : "") + (sub ? sub + "/" : "");
  const pages = [], files = {};
  for (const [lang, slug, locale] of LANGS) {
    const T = I[lang];
    const strings = Object.fromEntries(Object.keys(en).filter(k => !RUNTIME_SKIP.has(k) && !k.startsWith("lt_")).map(k => [k, T[k]]));
    const sjs = `window.L1MS=${JSON.stringify(strings).replace(/</g, "\\u003c")};\n`;
    const sName = `l.${lang.toLowerCase()}.${hash(sjs)}.js`;
    files["assets/" + sName] = sjs;
    const F = formats(lang, "USD", D.rates);
    const S = s => spaced(s, lang);
    // the title of every long-tail page in this language (footer links, breadcrumbs)
    const info = new Map(PAGES.map(p => { const f = facts(p, D, T, F); return [p.slug, { f, title: S(fill(T["lt_" + p.kind], f.v || {})), intro: S(fill(T["lt_" + p.kind + "_i"], f.v || {})) }]; }));
    const groups = [["sm_scenes", p => p.kind === "scene"], ["sm_egress", p => p.kind === "egress" || p.kind === "volume"], ["sm_vs", p => p.kind.startsWith("vs")], ["sm_cheap", p => p.kind.startsWith("cheap")]];

    for (const page of [null, ...PAGES]) {
      const sub = page ? page.slug : "";
      const url = SITE + path(slug, sub), inf = page && info.get(page.slug);
      const title = page ? inf.title : T.seo_title, desc = page ? inf.intro : T.seo_desc, h1 = page ? inf.title : T.h1;
      const state = stateOf(page);
      const rec = recommend(state, D);
      const alts = LANGS.map(([l, sl]) => `<link rel="alternate" hreflang="${l}" href="${SITE + path(sl, sub)}">`).join("\n") + `\n<link rel="alternate" hreflang="x-default" href="${SITE + path("", sub)}">`;
      const ogScene = page && page.kind === "scene";
      const og = `${SITE}/og/${lang.toLowerCase()}${ogScene ? "/" + page.slug : ""}.png`;
      const graph = [
        { "@type": "WebApplication", name: page ? h1 : T.name, url, applicationCategory: "BusinessApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript",
          description: desc, inLanguage: lang, isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
      ];
      if (!page) graph.push({ "@type": "FAQPage", mainEntity: T.docs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
      else graph.push({ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: T.name, item: SITE + path(slug, "") }, { "@type": "ListItem", position: 2, name: h1, item: url }] });
      const head = [
        `<title>${esc(title)}${page ? " · " + esc(T.name) : ""}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta name="keywords" content="${esc(T.seo_kw)}">`,
        ...(lang === "zh-CN" ? [`<meta http-equiv="Cache-Control" content="no-transform">`, `<meta http-equiv="Cache-Control" content="no-siteapp">`, `<meta name="applicable-device" content="pc,mobile">`] : []),
        `<meta name="robots" content="index, follow, max-image-preview:large">`,
        `<meta name="theme-color" content="#f6f6f7" media="(prefers-color-scheme: light)">`,
        `<meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)">`,
        `<link rel="canonical" href="${url}">`, alts,
        `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">`,
        `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="1ms.dog">`,
        `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`, `<meta property="og:url" content="${url}">`,
        `<meta property="og:image" content="${og}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
        `<meta property="og:locale" content="${locale}">`, ...LANGS.filter(([l]) => l !== lang).map(([, , loc]) => `<meta property="og:locale:alternate" content="${loc}">`),
        `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(title)}">`, `<meta name="twitter:description" content="${esc(desc)}">`,
        `<meta name="twitter:image" content="${og}">`,
        `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`,
      ].join("\n");

      const scenes = SCENES.map(s => `<button class="chip" type="button" data-scene="${s.id}" aria-pressed="${state.scene === s.id}">${esc(T["sc_" + s.id])}</button>`).join("");
      const sizeIdx = SIZES.findIndex(([c, r, d]) => c === state.vcpu && r === state.ram && d === state.disk);
      const sizes = SIZES.map(([c, r], i) => `<button type="button" data-size="${i}" aria-pressed="${i === sizeIdx}">${c} vCPU · ${r} ${F.gb}</button>`).join("") +
        `<button type="button" data-size="custom" aria-pressed="${sizeIdx < 0 && state.vcpu > 0}">${esc(T.size_custom)}</button>` +
        `<button type="button" data-size="none" aria-pressed="${state.vcpu === 0}">${esc(T.size_none)}</button>`;
      const auds = ["na", "eu", "ap", "cn"].map(a => `<button type="button" data-aud="${a}" aria-pressed="${state.aud === a}">${esc(T["aud_" + a])}</button>`).join("");
      const factsHTML = page ? `<section class="card facts" aria-labelledby="factsH"><h2 id="factsH">${esc(T.facts_h)}</h2><p>${esc(inf.intro)}</p>${inf.f.table}</section>` : "";
      const helpNav = T.docs.map(([q], i) => `<button type="button" role="tab" data-hq="${i}" aria-selected="${i === 0}">${esc(q)}</button>`).join("");
      const helpC = T.docs.map(([q, a], i) => `<article data-hqb="${i}"${i ? " hidden" : ""}><h3>${esc(q)}</h3><p>${esc(a)}</p></article>`).join("");
      const langOpts = LANGS.map(([l]) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(I[l].lang_name)}</option>`).join("");
      const paths = Object.fromEntries(LANGS.map(([l, sl]) => [l, path(sl, sub)]));
      const sitemap = `<b>${esc(T.sm_h)}</b><a href="${path(slug, "")}"${sub ? "" : ' aria-current="page"'}>${esc(T.home)}</a>` +
        groups.map(([k, test]) => `<i class="br"></i><b>${esc(T[k])}</b>` + PAGES.filter(test).map(p => `<a href="${path(slug, p.slug)}"${p.slug === sub ? ' aria-current="page"' : ""}>${esc(info.get(p.slug).title)}</a>`).join("")).join("");
      const foot = fill(T.foot, { d: verified, r: D.rates.usdPer.EUR, rd: D.rates.date });
      const data = { lang, paths, state, cur: "USD", verified, slug: sub };
      let html = tpl
        .replace(/(<(\w+)\b[^>]*\sdata-i="(\w+)"[^>]*>)([^<]*)(<\/\2>)/g, (m, open, tag, k, inner, close) => open + esc(T[k]) + close)
        .replace("{{lang}}", lang).replace("{{pathsAttr}}", esc(JSON.stringify(paths))).replace("{{rootAttr}}", slug || sub ? "" : " data-root")
        .replace("{{prepaint}}", PREPAINT).replace("{{head}}", head).replace("{{css}}", cssName).replace("{{js}}", jsName).replace("{{strings}}", sName)
        .split("{{homeHref}}").join(path(slug, "")).replace("{{langOpts}}", langOpts)
        .replace("{{h1}}", esc(h1)).replace("{{lede}}", esc(T.lede)).replace("{{scenes}}", scenes).replace("{{sizes}}", sizes).replace("{{auds}}", auds)
        .replace("{{verdict}}", esc(verdict(rec, T, F, D))).replace("{{picks}}", picksHTML(rec, T, F, D)).replace("{{curve}}", curveHTML(rec, T, F, D, state))
        // every provider compared is the home page's; a sub-page keeps its own case and points there instead
        .replace("{{table}}", page ? "" : `    <section class="card more" aria-labelledby="tblH">
      <h2 id="tblH"><span>${esc(T.tbl_h)}</span> <small>${esc(T.tbl_hint)}</small></h2>
      <div class="tbl-wrap" id="tbl">${tableHTML(rec, T, F, D)}</div>
    </section>
`)
        .replace("{{toHome}}", page ? `      <p class="to-home"><a class="btn" id="toHome" href="${path(slug, "")}?${esc(toQuery(state))}" data-home="${path(slug, "")}">${esc(T.to_home)}</a></p>
` : "").replace("{{facts}}", factsHTML).replace("{{sitemap}}", sitemap).replace("{{foot}}", esc(foot))
        .split("{{uGB}}").join(F.gb).split("{{uTB}}").join(F.tb).replace("{{helpNav}}", helpNav).replace("{{helpC}}", helpC)
        .replace(/\{\{a:(\w+)\}\}/g, (_, k) => esc(T[k])).replace("{{data}}", JSON.stringify(data).replace(/</g, "\\u003c"));
      if (/\{\{[\w:]+\}\}/.test(html)) throw new Error("unfilled placeholder in " + path(slug, sub) + ": " + /\{\{[\w:]+\}\}/.exec(html)[0]);
      pages.push({ file: (slug ? slug + "/" : "") + (sub ? sub + "/" : "") + "index.html", url, sub, html });
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    pages.map(p => `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${verified}</lastmod>\n    <priority>${p.sub ? "0.7" : "1.0"}</priority>\n` +
      LANGS.map(([l, s]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE + path(s, p.sub)}"/>`).join("\n") +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE + path("", p.sub)}"/>\n  </url>`).join("\n") + "\n</urlset>\n";
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
  const llms = `# ${en.name}

> Free browser calculator: given a server size, monthly outbound traffic, the share of static files, stored data and where
> visitors are, it prices every VPS and cloud plan (Hetzner, DigitalOcean, Vultr, Linode, Lightsail, Tencent Cloud Lighthouse, Alibaba Cloud SAS, Oracle Cloud,
> AWS EC2, Google Cloud, Azure) combined with object storage (R2, S3, B2, Wasabi, Spaces, Hetzner) and CDNs (Cloudflare,
> CloudFront, Bunny) for one month, and recommends the cheapest setup. Prices checked by hand against each provider's
> pricing page (${verified}); excluding VAT.

- Planner: ${SITE}/ (also ${LANGS.slice(1).map(([, s]) => "/" + s + "/").join(", ")})
- Pages: ${PAGES.map(p => `${SITE}/${p.slug}/`).join(", ")}
- Price data (JSON, CORS): ${["vps", "egress", "storage", "cdn", "rates"].map(f => `${SITE}/data/${f}.json`).join(", ")}
- Shared result: /[<lang>/][<page>/]r/1_<scene|->_<vCPU>_<RAM GB>_<disk GB>_<servers>_<egress GB/month>_<static %>_<stored GB>_<na|eu|ap|cn>_<flags: 1 shared CPU + 2 free tiers>_<file KB>
- Page state: ?v=1&c=<vCPU>&r=<RAM GB>&d=<disk GB>&n=<servers>&gb=<egress GB/month>&st=<static %>&sg=<stored GB>&a=<na|eu|ap|cn>&sh=<shared CPU 0|1>&f=<free tiers 0|1>&o=<file KB>
`;
  const csp = ["default-src 'self'", `script-src 'self' 'sha256-${sha(PREPAINT)}'`, "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:",
    "connect-src 'self' https:", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
  const headers = `# Generated by scripts/build.mjs
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
/assets/*
  Cache-Control: public, max-age=604800
/assets/app.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/l.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
/assets/share/*
  ! Cache-Control
  Cache-Control: public, max-age=0, must-revalidate
/og/*
  Cache-Control: public, max-age=604800
/data/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=3600
/llms.txt
  Access-Control-Allow-Origin: *
  Content-Type: text/plain; charset=utf-8
`;
  Object.assign(files, { ["assets/" + jsName]: js, ["assets/" + cssName]: css, "sitemap.xml": sitemap, "robots.txt": robots, "llms.txt": llms, "_headers": headers });
  for (const f of ["vps", "egress", "storage", "cdn", "rates"]) files[`data/${f}.json`] = await readFile(new URL(`../data/${f}.json`, import.meta.url), "utf8");
  for (const p of pages) files[p.file] = p.html;

  const stale = [];
  for (const [name, text] of Object.entries(files)) {
    const url = new URL(name, pub);
    const current = await readFile(url, "utf8").catch(() => null);
    if (current === text) continue;
    if (check) { stale.push(name); continue; }
    await mkdir(new URL(".", url), { recursive: true });
    await writeRetry(url, text);
  }
  // pages no longer built: only index.html files, never assets
  const walk = async dir => (await readdir(new URL(dir, pub), { withFileTypes: true })).flatMap(e => e.isDirectory() ? [dir + e.name + "/"] : []);
  const dirs = [""];
  for (let i = 0; i < dirs.length; i++) if (!/^(assets|og|data)\//.test(dirs[i])) dirs.push(...await walk(dirs[i]));
  for (const d of dirs) {
    const f = d + "index.html";
    if (files[f] || !(await readFile(new URL(f, pub)).catch(() => null))) continue;
    if (check) stale.push(f + " (old)"); else await rm(new URL(f, pub));
  }
  const old = (await readdir(new URL("assets/", pub))).filter(f => /^(app|l\.[a-z-]+)\.[0-9a-f]+\.(js|css)$/.test(f) && !files["assets/" + f]);
  if (check && old.length) stale.push(...old.map(f => f + " (old)"));
  else for (const f of old) await rm(new URL("assets/" + f, pub));
  return { stale, pages: pages.length, sizes: { html: Math.max(...pages.map(p => p.html.length)), js: js.length, css: css.length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const r = await build({ check });
  if (check && r.stale.length) { console.error("out of date (run npm run build):\n  " + r.stale.join("\n  ")); process.exit(1); }
  console.log(`${r.pages} pages · largest HTML ${(r.sizes.html / 1024).toFixed(1)} KB · JS ${(r.sizes.js / 1024).toFixed(1)} KB · CSS ${(r.sizes.css / 1024).toFixed(1)} KB`);
}
