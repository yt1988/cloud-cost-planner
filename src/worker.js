// The Worker in front of public/. A request for a file there never reaches it (static assets are free and unmetered);
// it sees only what no file answers. A shared result, /<lang>/[<page>/]r/<code> (toCode in src/calc.mjs), is that page
// with the recommendation in its title and description, so a chat app's link preview shows it. Anything else: the plain 404.
import vps from "../data/vps.json" with { type: "json" };
import egress from "../data/egress.json" with { type: "json" };
import storage from "../data/storage.json" with { type: "json" };
import cdn from "../data/cdn.json" with { type: "json" };
import rates from "../data/rates.json" with { type: "json" };
import { recommend, fromCode } from "./calc.mjs";
import { formats, verdict, comboName } from "./view.mjs";
import { PAGES } from "./pages.mjs";
import en from "./i18n/en.mjs";
import zhCN from "./i18n/zh-CN.mjs";
import zhTW from "./i18n/zh-TW.mjs";
import ja from "./i18n/ja.mjs";
import ko from "./i18n/ko.mjs";
import es from "./i18n/es.mjs";
import fr from "./i18n/fr.mjs";
import de from "./i18n/de.mjs";
import pt from "./i18n/pt.mjs";
import ru from "./i18n/ru.mjs";

const D = { vps, egress, storage, cdn, rates };
const I = { en, "zh-CN": zhCN, "zh-TW": zhTW, ja, ko, es, fr, de, pt, ru };
const DIR = Object.fromEntries(Object.keys(I).filter(l => l !== "en").map(l => [l.toLowerCase(), l]));   // folder → language
const SLUGS = new Set(PAGES.map(p => p.slug));

// What the preview says about a result link, or null when the path isn't one: { page, title, desc }
export function resultMeta(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2 || parts[parts.length - 2] !== "r") return null;
  const code = decodeURIComponent(parts.pop()); parts.pop();
  const lang = DIR[parts[0]] ? DIR[parts.shift()] : "en";
  if (parts.length > 1 || (parts[0] && !SLUGS.has(parts[0]))) return null;
  const page = "/" + (lang === "en" ? "" : lang.toLowerCase() + "/") + (parts[0] ? parts[0] + "/" : "");
  const state = fromCode(code);
  if (!state) return { page, title: null, desc: null };
  const T = I[lang], F = formats(lang, "USD", D.rates), rec = recommend(state, D), best = rec.picks[0];
  if (!best) return { page, title: null, desc: null };
  const title = `${comboName(D, best.r)} · ${F.money(best.r.total)}${T.per_month} · ${T.name}`;
  return { page, title, desc: verdict(rec, T, F, D) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), meta = (req.method === "GET" || req.method === "HEAD") && resultMeta(url.pathname);
    if (!meta) return env.ASSETS.fetch(req);
    const res = await env.ASSETS.fetch(new Request(new URL(meta.page, url), req));
    if (res.status !== 200) return res;
    // never indexed (canonical still points at the page); the result in the title and description
    const set = v => ({ element(e) { if (v) e.setAttribute("content", v); } });
    const out = new HTMLRewriter()
      .on('meta[name="robots"]', set("noindex, follow"))
      .on("title", { element(e) { if (meta.title) e.setInnerContent(meta.title); } })
      .on('meta[property="og:title"], meta[name="twitter:title"]', set(meta.title))
      .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', set(meta.desc))
      .on('meta[property="og:url"]', set(url.origin + url.pathname))
      .transform(res);
    const h = new Headers(out.headers);
    h.delete("etag");
    return new Response(out.body, { status: 200, headers: h });
  },
};
