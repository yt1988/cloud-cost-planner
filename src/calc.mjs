// The planner's engine: every server plan × object storage × CDN that meets the inputs, priced for one month.
// Pure functions over the price data (data/*.json); the page bundles this file, the tests import it.
// Units: GB = 2^30 bytes, TB = 1024 GB, a month = 730 hours; every total is in US dollars before VAT.

export const HOURS = 730;
export const REGIONS = ["na", "eu", "ap"];
export const AUDIENCES = ["na", "eu", "ap", "cn"];
// visitors in mainland China are served best from Asia-Pacific data centers
export const nearOf = aud => (aud === "cn" ? "ap" : aud);
// what a port can move in a month, in GB: Mbit/s × seconds in 30 days ÷ 8 ÷ 2^30
export const portGB = mbps => (mbps * 1e6 * 2592000) / 8 / 1073741824;
// providers that bill as one vendor (one account, one bill)
const VENDOR = { lightsail: "aws", cloudfront: "aws", "bunny-volume": "bunny" };
// the share of static traffic a CDN fetches from its origin (an 80% cache hit rate)
export const ORIGIN = 0.2;
const vendorOf = id => VENDOR[id] || id;

// Cost of `gb` under tiers [[upTo, price], …] counted from 0. A finite last limit means "contact sales" above it:
// the last price is used, and `over` reports it.
export function tiered(gb, tiers) {
  let cost = 0, from = 0;
  for (const [upTo, price] of tiers) {
    const to = upTo == null ? Infinity : upTo;
    if (gb > from) cost += (Math.min(gb, to) - from) * price;
    from = to;
    if (gb <= to) return { cost, over: false };
  }
  const last = tiers[tiers.length - 1];
  return { cost: cost + (gb - from) * last[1], over: true };
}

// Flatten the price data into server candidates, one per plan, region and (for clouds) egress profile.
export function machines(D) {
  const usd = (amount, cur) => amount * (D.rates.usdPer[cur] ?? NaN);
  const egress = Object.fromEntries(D.egress.profiles.map(p => [p.id, p]));
  const out = [];
  for (const o of D.vps.offers) {
    const regs = o.region ? { [o.region]: o.loc } : o.regions;
    for (const [region, loc] of Object.entries(regs)) for (const p of o.plans) {
      const [plan, vcpu, ram, disk, price, includedGB, portMbps] = p;
      const base = {
        offer: o.id, provider: o.provider, line: o.line, plan, region, loc, vcpu, ram, disk, cpu: o.cpu, arch: o.arch || "x86",
        diskType: o.disk, note: o.note || null, source: o.source,
        monthly: usd(o.per === "hour" ? price * HOURS : price, o.currency),
        extras: o.extras ? {
          ipv4: usd((o.extras.ipv4PerHour || 0) * HOURS, o.currency), diskPerGB: usd(o.extras.diskPerGB || 0, o.currency), minDisk: o.extras.minDiskGB || 0,
        } : null,
        alwaysFree: o.alwaysFree || null,
      };
      if (o.egress) for (const id of o.egress) out.push({ ...base, id: `${o.id}:${plan}:${region}:${id}`, egress: egress[id] });
      else out.push({
        ...base, id: `${o.id}:${plan}:${region}`,
        traffic: { scope: o.traffic.scope, includedGB, portMbps: portMbps || null, overage: usd(o.traffic.overagePerGB || 0, o.currency), accountFreeGB: o.traffic.accountFreeGB || 0 },
      });
    }
  }
  return out;
}

export function storages(D) {
  const usd = (a, cur) => a * D.rates.usdPer[cur];
  return D.storage.services.map(s => ({
    ...s, storage: s.storage.map(([u, p]) => [u, usd(p, s.currency)]),
    egressPerGB: s.egress.perGB != null ? usd(s.egress.perGB, s.currency) : null,
    baseMonthly: s.base ? usd(s.base.monthly, s.currency) : 0,
  }));
}

// The inputs, with defaults. vcpu 0 means no server at all (backups: only storage).
export function normalize(q) {
  const n = v => (Number.isFinite(+v) ? +v : 0);
  return {
    vcpu: Math.max(0, n(q.vcpu)), ram: Math.max(0, n(q.ram)), disk: Math.max(0, n(q.disk)), count: Math.max(1, Math.round(n(q.count) || 1)),
    gb: Math.max(0, n(q.gb)), staticPct: Math.min(100, Math.max(0, n(q.staticPct))), storeGB: Math.max(0, n(q.storeGB)),
    aud: AUDIENCES.includes(q.aud) ? q.aud : "na", shared: q.shared !== false, free: !!q.free, objKB: Math.max(1, n(q.objKB) || 500),
  };
}

// one month of one combination; null when it can't do the job
export function price(m, s, c, q, D) {
  const dyn = q.gb * (1 - q.staticPct / 100), stat = q.gb - dyn;
  const useStore = !!s && q.storeGB > 0;
  const region = m ? m.region : nearOf(q.aud);
  const dst = q.aud === "cn" ? "cn" : "global";
  const flags = [];
  const cost = { machine: 0, traffic: 0, storage: 0, cdn: 0 };
  const pools = new Map();                                              // egress profile usage, summed per account
  const pool = (prof, gb) => { const k = prof.id; pools.set(k, { prof, gb: (pools.get(k)?.gb || 0) + gb }); };

  // What leaves the server, the bucket and the CDN. A CDN still fetches what it has not cached from its origin:
  // ORIGIN of the static traffic (an 80% cache hit rate), billed by the origin's own rules, unless the origin sends to
  // that CDN for free (S3 → CloudFront, B2 → Cloudflare or Bunny, anything on AWS → CloudFront).
  let serverGB = q.gb, bucketGB = 0, cdnGB = 0;
  if (useStore) { serverGB = dyn; if (c) { cdnGB = stat; if (!(s.freeTo || []).includes(c.id)) bucketGB = stat * ORIGIN; } else bucketGB = stat; }
  else if (c) { serverGB = dyn; cdnGB = stat; if (!(m && vendorOf(m.provider) === "aws" && c.id === "cloudfront")) serverGB += stat * ORIGIN; }
  if (!m && (!useStore || dyn > 0)) return null;                        // dynamic traffic and a CDN's origin need a server
  if (!m) serverGB = 0;

  if (m) {
    const need = q.disk + (useStore ? 0 : q.storeGB);                  // files served by the server live on its disk
    if (m.disk != null && m.disk < need) return null;
    let each = m.monthly;
    if (m.extras) each += m.extras.ipv4 + Math.max(need, m.extras.minDisk) * m.extras.diskPerGB;
    let total = each * q.count;
    if (q.free && m.alwaysFree) {
      const f = m.alwaysFree;
      if (f.plan ? f.plan === m.plan && m.region === "na" : m.vcpu * q.count <= f.vcpu && m.ram * q.count <= f.ram) {
        const diskFree = Math.min(f.diskGB || 0, Math.max(need, m.extras.minDisk) * q.count);
        total -= (f.plan ? m.monthly : m.monthly * q.count) + diskFree * m.extras.diskPerGB;
        flags.push("free");
      }
    }
    cost.machine = total;
    if (m.traffic) {
      const t = m.traffic;
      if (t.scope === "unlimited") {
        if (t.portMbps && serverGB / q.count > portGB(t.portMbps)) return null;
        if (t.portMbps && serverGB / q.count > portGB(t.portMbps) * 0.5) flags.push("port");
      } else {
        const included = t.includedGB * q.count + t.accountFreeGB;
        cost.traffic += Math.max(0, serverGB - included) * t.overage;
      }
    } else pool(m.egress, serverGB);
  }

  if (useStore) {
    if (s.regions && !s.regions.includes(region)) return null;
    const billed = Math.max(q.storeGB - (s.freeStorageGB || 0) - (s.base ? s.base.storageGB : 0), 0);
    let st = s.baseMonthly + tiered(Math.max(billed, (s.minStorageGB || 0) - (s.base ? s.base.storageGB : 0)), s.storage).cost;
    // egress from the bucket: direct to visitors, or through its own CDN
    if (bucketGB > 0) {
      if (s.egress.egressRef) pool(D.egress.profiles.find(p => p.id === s.egress.egressRef), bucketGB);
      else {
        const free = (s.egress.freeRatio ? s.egress.freeRatio * q.storeGB : 0) + (s.base ? s.base.egressGB : 0);
        st += Math.max(0, bucketGB - free) * s.egressPerGB;
      }
      const reqM = bucketGB * 1048576 / q.objKB / 1e6;
      st += Math.max(0, reqM - (s.get.freeM || 0)) * s.get.perM;
    }
    if (s.egress.fairUse && Math.max(bucketGB, cdnGB) > q.storeGB) flags.push("fair");
    cost.storage = st;
  }

  if (c && cdnGB > 0) {
    const tiers = c.tiers[q.aud];
    const r = tiered(Math.max(0, cdnGB - (c.freeBefore || 0)), tiers);
    if (r.over) flags.push("sales");
    let cc = r.cost;
    if (c.requests) cc += Math.max(0, cdnGB * 1048576 / q.objKB / 1e6 - c.requests.freeM) * c.requests[q.aud];
    cost.cdn = Math.max(cc, c.minMonthly || 0);
    if (c.note === "cloudflare" && q.objKB >= 1000) flags.push("cfTos");  // video and large downloads: see its terms
  } else if (c) return null;                                            // a CDN with nothing to carry

  for (const { prof, gb } of pools.values()) {
    const src = prof.tiers[region], tiers = src[dst] || src.global;
    const r = tiered(Math.max(0, gb - (prof.freeBefore || 0)), tiers);
    cost.traffic += r.cost;
    if (r.over || (prof.salesAboveGB && gb > prof.salesAboveGB)) flags.push("sales");
  }

  const total = cost.machine + cost.traffic + cost.storage + cost.cdn;
  const vendors = new Set([m && vendorOf(m.provider), useStore && vendorOf(s.provider), c && vendorOf(c.id)].filter(Boolean));
  return { m, s: useStore ? s : null, c, region, cost, total, flags, vendors: vendors.size, serverGB, bucketGB, cdnGB };
}

const fits = (m, q) => m.vcpu >= q.vcpu && m.ram >= q.ram && (q.shared || m.cpu !== "shared");

// Every combination, cheapest first.
export function plan(input, D) {
  const q = normalize(input);
  const ms = q.vcpu > 0 || q.ram > 0 ? machines(D).filter(m => fits(m, q)) : [null];
  const ss = [null, ...storages(D)], cs = [null, ...D.cdn.services];
  const rows = [];
  for (const m of ms) for (const s of q.storeGB > 0 ? ss : [null]) for (const c of q.staticPct > 0 ? cs : [null]) {
    if (s && s.cdn && c) continue;                                      // Spaces has its own CDN
    const r = price(m, s, c, q, D);
    if (r) rows.push(r);
  }
  // ties (the same price in every region): fewer vendors, then the region near the visitors
  const far = r => (r.region === nearOf(q.aud) ? 0 : 1);
  rows.sort((a, b) => a.total - b.total || a.vendors - b.vendors || far(a) - far(b));
  return { q, rows };
}

// The picks, all in the visitors' region: the cheapest, and the one with the fewest vendors. A data center on another
// continent only when it is clearly cheaper (15% or more): the visitor asked for a region, so the headline respects it.
// Plus the all-AWS reference (EC2 serving everything, or S3 alone) for the "n times" line.
export function recommend(input, D) {
  const { q, rows } = plan(input, D);
  // not recommended: above the published tiers (contact sales), or against the terms (video on Cloudflare Free, Wasabi egress above what is stored)
  const ok = rows.filter(r => !r.flags.some(f => f === "sales" || f === "cfTos" || f === "fair"));
  const near = ok.filter(r => r.region === nearOf(q.aud));
  const close = near[0] || ok[0] || null;
  const far = ok[0] && close && ok[0] !== close && ok[0].total < close.total * 0.85 ? ok[0] : null;
  // fewer vendors is worth a little more, not ten times more
  const cap = close ? Math.max(close.total * 1.5, close.total + 10) : 0;
  const simple = near.filter(r => r.total <= cap).sort((a, b) => a.vendors - b.vendors || a.total - b.total)[0] || null;
  const picks = [];
  for (const [tag, r] of [["cheapest", close], ["simple", simple], ["far", far]]) {
    if (!r) continue;
    const same = picks.find(p => p.r === r);
    if (same) same.tags.push(tag); else picks.push({ tags: [tag], r });
  }
  const aws = rows.filter(r => r.region === nearOf(q.aud) && (r.m ? r.m.provider === "aws" && !r.s && !r.c : r.s && r.s.id === "s3" && !r.c));
  return { q, rows, picks, aws: aws[0] || null };
}

// The best combination of each product line (any region: the cheapest, near the visitors on a tie), for the table.
export function table(rows, limit = 40) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const k = r.m ? `${r.m.offer.replace(/-(na|eu|ap)$/, "")}:${r.m.egress ? r.m.egress.id : ""}` : `-${r.s && r.s.id}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// The same combination at other traffic volumes, for the cost curve; null where it stops working.
export function curve(r, input, D, points) {
  const q = normalize(input);
  return points.map(gb => { const x = price(r.m, r.s, r.c, { ...q, gb }, D); return x ? x.total : null; });
}

// Where line b becomes cheaper than line a (or the other way), as traffic grows: [{ gb, from, to }]
export function crossings(points, a, b) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const d0 = a[i - 1] != null && b[i - 1] != null ? a[i - 1] - b[i - 1] : null, d1 = a[i] != null && b[i] != null ? a[i] - b[i] : null;
    if (d0 == null || d1 == null || Math.sign(d0) === Math.sign(d1) || d0 === 0) continue;
    const t = d0 / (d0 - d1), gb = Math.exp(Math.log(points[i - 1]) + t * (Math.log(points[i]) - Math.log(points[i - 1])));
    out.push({ gb, cheaper: d1 > 0 ? "b" : "a" });
  }
  return out;
}

// log-spaced traffic points from 10 GB to 1 PB
export const POINTS = Array.from({ length: 41 }, (_, i) => Math.round(10 * Math.pow(10, i / 8)));

// the oldest check date in the data, shown in the footer
export function verifiedAt(D) {
  const all = [...D.vps.offers, ...D.egress.profiles, ...D.storage.services, ...D.cdn.services, D.rates].map(x => x.verifiedAt);
  return all.sort()[0];
}

// state ⇄ the code of a shared result link, /<lang>/[<page>/]r/<code>: "1_<scene>_<vcpu>_<ram>_<disk>_<servers>_<GB>_
// <static %>_<stored GB>_<na|eu|ap|cn>_<flags: 1 shared CPU, 2 free tiers>_<file KB>". The first field is the format's
// version: a new format gets a new number, and this one keeps opening.
export function toCode(s) {
  return ["1", s.scene || "-", s.vcpu, s.ram, s.disk, s.count, s.gb, s.staticPct, s.storeGB, s.aud, (s.shared ? 1 : 0) + (s.free ? 2 : 0), s.objKB].join("_");
}
export function fromCode(code) {
  const p = String(code || "").split("_");
  if (p[0] !== "1" || p.length !== 12 || !AUDIENCES.includes(p[9]) || !/^[a-z-]{1,20}$/.test(p[1])) return null;
  const n = [2, 3, 4, 5, 6, 7, 8, 11, 10].map(i => (/^\d+(\.\d+)?$/.test(p[i]) ? +p[i] : NaN));
  if (n.some(v => !Number.isFinite(v)) || n[5] > 100 || n[3] < 1) return null;
  return { scene: p[1] === "-" ? "" : p[1], vcpu: n[0], ram: n[1], disk: n[2], count: n[3], gb: n[4], staticPct: n[5], storeGB: n[6], aud: p[9], shared: !!(n[8] & 1), free: !!(n[8] & 2), objKB: n[7] };
}

// state ⇄ query string (?v=1&…), the page's own address while you edit: short keys, so links stay short
export const PARAMS = { s: "scene", c: "vcpu", r: "ram", d: "disk", n: "count", gb: "gb", st: "staticPct", sg: "storeGB", a: "aud", sh: "shared", f: "free", o: "objKB" };
export function toQuery(state) {
  const p = new URLSearchParams({ v: "1" });
  for (const [k, name] of Object.entries(PARAMS)) {
    const v = state[name];
    if (v == null || v === "") continue;
    p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return p.toString();
}
export function fromQuery(search) {
  const p = new URLSearchParams(search), out = {};
  if (p.get("v") !== "1") return null;
  for (const [k, name] of Object.entries(PARAMS)) if (p.has(k)) {
    const v = p.get(k);
    out[name] = name === "shared" || name === "free" ? v === "1" : name === "aud" || name === "scene" ? v : +v;
  }
  return out;
}
