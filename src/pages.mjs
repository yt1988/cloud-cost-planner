// The pages people search for, each prerendered in every language with real numbers from the price data:
// scenarios, one cloud's egress, an egress volume, two providers side by side, the cheapest of a kind.
// Each has its own calculator preset (`state`), a sentence with its key numbers (`intro` values) and a table.
import { SCENES, SIZES } from "./scenes.mjs";
import { recommend, plan, table, price, tiered, machines, storages, nearOf, normalize } from "./calc.mjs";
import { esc, fill, comboName, machineName } from "./view.mjs";

const PROXY = { vcpu: 1, ram: 2, disk: 20, count: 1, staticPct: 0, storeGB: 0, objKB: 500 };
const BUCKET = { vcpu: 0, ram: 0, disk: 0, count: 1, staticPct: 100, objKB: 1000 };
const SITE = { vcpu: 2, ram: 4, disk: 20, count: 1, staticPct: 90, storeGB: 100, objKB: 300 };

export const PAGES = [
  ...SCENES.map(s => ({ slug: s.slug, kind: "scene", scene: s.id })),
  { slug: "aws-egress-cost", kind: "egress", p: "AWS", profiles: ["aws"] },
  { slug: "gcp-egress-cost", kind: "egress", p: "Google Cloud", profiles: ["gcp-premium", "gcp-standard"] },
  { slug: "azure-egress-cost", kind: "egress", p: "Azure", profiles: ["azure-mgn", "azure-internet"] },
  { slug: "oracle-egress-cost", kind: "egress", p: "Oracle Cloud", profiles: ["oracle"] },
  { slug: "1tb-egress-cost", kind: "volume", gb: 1024 },
  { slug: "10tb-egress-cost", kind: "volume", gb: 10240 },
  { slug: "100tb-egress-cost", kind: "volume", gb: 102400 },
  { slug: "aws-vs-hetzner-bandwidth", kind: "vs", a: "aws", b: "hetzner" },
  { slug: "hetzner-vs-digitalocean", kind: "vs", a: "hetzner", b: "digitalocean" },
  { slug: "hetzner-vs-vultr", kind: "vs", a: "hetzner", b: "vultr" },
  { slug: "digitalocean-vs-vultr", kind: "vs", a: "digitalocean", b: "vultr" },
  { slug: "vultr-vs-linode", kind: "vs", a: "vultr", b: "linode" },
  { slug: "lightsail-vs-ec2", kind: "vs", a: "lightsail", b: "aws" },
  { slug: "tencent-cloud-vs-alibaba-cloud", kind: "vs", a: "tencent", b: "aliyun" },
  { slug: "r2-vs-s3", kind: "vsStorage", a: "r2", b: "s3" },
  { slug: "b2-vs-wasabi", kind: "vsStorage", a: "b2", b: "wasabi" },
  { slug: "cloudfront-vs-cloudflare", kind: "vsCdn", a: "cloudfront", b: "cloudflare" },
  { slug: "cheapest-vps-4gb", kind: "cheapVps", ram: 4 },
  { slug: "cheapest-object-storage", kind: "cheapStorage" },
  { slug: "cheapest-cdn", kind: "cheapCdn" },
  { slug: "hong-kong-vps-cost", kind: "cheapHk" },
];

// the calculator's starting point on each page
export function stateOf(page) {
  const base = { scene: "", aud: "na", shared: true, free: false };
  if (!page) return { ...base, ...scene("saas") };
  if (page.kind === "scene") return { ...base, ...scene(page.scene) };
  if (page.kind === "volume") return { ...base, ...PROXY, gb: page.gb };
  if (page.kind === "egress" || page.kind === "vs") return { ...base, ...PROXY, gb: 10240 };
  if (page.kind === "cheapHk") return { ...base, ...PROXY, ram: 1, gb: 1024, aud: "cn" };
  if (page.kind === "cheapVps") return { ...base, ...PROXY, vcpu: 2, ram: page.ram, disk: 20, gb: 1024 };
  if (page.kind === "vsStorage" || page.kind === "cheapStorage") return { ...base, ...BUCKET, storeGB: 1024, gb: 1024 };
  return { ...base, ...SITE, gb: 10240 };
}
function scene(id) { const { slug, id: sid, ...v } = SCENES.find(s => s.id === id); return { scene: sid, count: 1, ...v }; }

const provName = (D, id) => D.vps.providers[id]?.name || D.storage.services.find(s => s.id === id)?.name || D.cdn.services.find(s => s.id === id)?.name || id;
const VOLS = [100, 1024, 10240, 51200, 102400];

// the cheapest server of one provider for a size and traffic, any region
function bestOf(D, provider, q) {
  const { rows } = plan({ ...PROXY, ...q }, D);
  return rows.find(r => r.m && r.m.provider === provider && !r.s && !r.c && !r.flags.includes("sales")) || null;
}

const th = cells => `<tr>${cells.map((c, i) => `<th${i ? ' class="n"' : ""}>${esc(c)}</th>`).join("")}</tr>`;
const tdRow = cells => `<tr>${cells.map((c, i) => `<td${i ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`;
const tableOf = (head, rows) => `<div class="tbl-wrap"><table class="tbl"><thead>${th(head)}</thead><tbody>${rows.map(tdRow).join("")}</tbody></table></div>`;

// A page's title words and intro values, and its table. Returns { v, table } (v fills the language's templates).
export function facts(page, D, T, F) {
  const k = page.kind;
  if (k === "scene") {
    const st = stateOf(page), rows = [];
    let v = null, ref = "AWS";
    for (const aud of ["na", "eu", "ap", "cn"]) {
      const r = recommend({ ...st, aud }, D), near = r.picks[0];
      if (!near) continue;
      if (r.aws) ref = comboName(D, r.aws);
      if (aud === "na") v = { scene: T["sc_" + page.scene], spec: st.vcpu ? fill(T.spec, { c: st.vcpu, r: F.num(st.ram) }) : T.spec_none, gb: F.size(st.gb), best: comboName(D, r.picks[0].r), t: F.money(r.picks[0].r.total), ref, aws: r.aws ? F.money(r.aws.total) : "—" };
      rows.push([esc(T["aud_" + aud]), esc(comboName(D, near.r)), F.money(near.r.total), r.aws ? F.money(r.aws.total) : "—"]);
    }
    return { v, table: tableOf([T.th_aud, T.tag_cheapest, T.c_total, ref], rows) };
  }
  if (k === "egress") {
    const profs = page.profiles.map(id => D.egress.profiles.find(p => p.id === id));
    const cost = (p, region, gb) => tiered(Math.max(0, gb - (p.freeBefore || 0)), p.tiers[region].global).cost;
    const head = [T.th_volume, ...profs.flatMap(p => ["na", "eu", "ap"].map(r => `${profs.length > 1 ? p.product.replace(/^Routing preference: /, "") + " · " : ""}${T["reg_" + r]}`))];
    const rows = VOLS.map(gb => [esc(F.size(gb)), ...profs.flatMap(p => ["na", "eu", "ap"].map(r => F.money(cost(p, r, gb))))]);
    return { v: { p: page.p, c1: F.money(cost(profs[0], "na", 1024)), c10: F.money(cost(profs[0], "na", 10240)), region: T.reg_na }, table: tableOf(head, rows) };
  }
  if (k === "volume") {
    const r = recommend({ ...stateOf(page) }, D), rows = table(r.rows.filter(x => !x.flags.includes("sales")), 12);
    const v = { v: F.size(page.gb), best: comboName(D, r.picks[0].r), t: F.money(r.picks[0].r.total), aws: r.aws ? F.money(r.aws.total) : "—" };
    return { v, table: tableOf([T.c_plan, T.c_region, T.c_total], rows.map(x => [esc(machineName(D, x.m) + (x.m.egress ? " · " + x.m.egress.product : "")), esc(T["reg_" + x.region]), F.money(x.total)])) };
  }
  if (k === "vs") {
    const rows = [];
    for (const [c, ram, disk] of SIZES) for (const gb of [1024, 5120, 20480]) {
      const a = bestOf(D, page.a, { vcpu: c, ram, disk, gb }), b = bestOf(D, page.b, { vcpu: c, ram, disk, gb });
      const cell = x => (x ? `${F.money(x.total)}<small>${esc(x.m.plan)} · ${esc(T["reg_" + x.region])}</small>` : "—");
      rows.push([esc(`${c} vCPU / ${ram} GB · ${F.size(gb)}`), cell(a), cell(b)]);
    }
    return { v: { a: provName(D, page.a), b: provName(D, page.b) }, table: tableOf([T.th_size, provName(D, page.a), provName(D, page.b)], rows) };
  }
  if (k === "vsStorage" || k === "cheapStorage") {
    const ss = storages(D), cases = [[100, 100], [1024, 1024], [1024, 10240], [10240, 10240], [10240, 51200]];
    const cost = (s, stored, gb) => { const r = price(null, s, null, normalize({ ...BUCKET, storeGB: stored, gb }), D); return r && !r.flags.includes("fair") ? r.total : null; };
    if (k === "vsStorage") {
      const a = ss.find(s => s.id === page.a), b = ss.find(s => s.id === page.b);
      const rows = cases.map(([stored, gb]) => [esc(`${F.size(stored)} · ${F.size(gb)}`), ...[a, b].map(s => { const c = cost(s, stored, gb); return c == null ? "—" : F.money(c); })]);
      return { v: { a: a.name, b: b.name }, table: tableOf([`${T.th_stored} · ${T.th_egress}`, a.name, b.name], rows) };
    }
    const ranked = ss.map(s => ({ s, c: cost(s, 1024, 1024) })).filter(x => x.c != null).sort((x, y) => x.c - y.c);
    const rows = ss.map(s => [esc(s.name), ...cases.map(([stored, gb]) => { const c = cost(s, stored, gb); return c == null ? "—" : F.money(c); })]);
    return { v: { best: ranked[0].s.name, t: F.money(ranked[0].c) }, table: tableOf([T.c_plan, ...cases.map(([a, b]) => `${F.size(a)} · ${F.size(b)}`)], rows) };
  }
  if (k === "vsCdn" || k === "cheapCdn") {
    const cdn = id => D.cdn.services.find(c => c.id === id);
    const cost = (c, aud, gb) => { const r = tiered(Math.max(0, gb - (c.freeBefore || 0)), c.tiers[aud]); return r.over ? null : Math.max(r.cost, c.minMonthly || 0); };
    const list = k === "vsCdn" ? [cdn(page.a), cdn(page.b)] : D.cdn.services;
    const head = [T.th_volume, ...list.flatMap(c => ["na", "ap"].map(a => `${c.name} · ${T["aud_" + a]}`))];
    const rows = VOLS.map(gb => [esc(F.size(gb)), ...list.flatMap(c => ["na", "ap"].map(a => { const x = cost(c, a, gb); return x == null ? "—" : F.money(x); }))]);
    if (k === "vsCdn") return { v: { a: list[0].name, b: list[1].name }, table: tableOf(head, rows) };
    const paid = D.cdn.services.filter(c => c.id !== "cloudflare").map(c => ({ c, x: cost(c, "na", 10240) })).sort((a, b) => a.x - b.x);
    return { v: { best: paid[0].c.name, t: F.money(paid[0].x) }, table: tableOf(head, rows) };
  }
  if (k === "cheapVps") {
    const { rows } = plan(stateOf(page), D);
    const top = table(rows.filter(r => r.m && !r.s && !r.c), 12);
    return { v: { r: page.ram, best: machineName(D, top[0].m), t: F.money(top[0].total) },
      table: tableOf([T.c_plan, T.c_region, T.c_cpu, T.c_total], top.map(x => [esc(machineName(D, x.m)), esc(T["reg_" + x.region]), esc(`${x.m.vcpu} / ${F.num(x.m.ram)} GB · ${T["cpu_" + x.m.cpu]}`), F.money(x.total)])) };
  }
  if (k === "cheapHk") {
    // every Hong Kong plan with 1 TB a month to visitors in mainland China, cheapest first
    const { rows } = plan(stateOf(page), D);
    const seen = new Set(), hk = rows.filter(r => r.m && r.m.cnRoute === "hk" && !r.s && !r.c && !seen.has(r.m.id) && seen.add(r.m.id)).slice(0, 12);
    return { v: { best: machineName(D, hk[0].m), t: F.money(hk[0].total) },
      table: tableOf([T.c_plan, T.c_cpu, T.p_traffic, T.c_total], hk.map(x => [esc(machineName(D, x.m)), esc(`${x.m.vcpu} / ${F.num(x.m.ram)} GB`), esc(F.size(x.m.traffic.includedGB)), F.money(x.total)])) };
  }
  return { v: {}, table: "" };
}
