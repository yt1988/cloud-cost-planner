// HTML for the results: the three picks, the one-line verdict, the comparison table and the cost curve.
// Pure string builders: the build prerenders a page's default result with them (crawlers and first paint see real
// numbers), and the page redraws with the same code on every input change. T: the language's strings.
import { nearOf, POINTS, curve, crossings, table } from "./calc.mjs";

export const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
export const ext = (href, text, attrs = "") => `<a class="ext"${href ? ` href="${esc(href)}"` : ""} target="_blank" rel="noopener"${attrs}><span>${esc(text)}</span>${EXT}</a>`;

// money and sizes in the page's language and currency
export function formats(lang, cur, rates) {
  const k = rates.perUsd[cur] || 1;
  const nf = (d) => new Intl.NumberFormat(lang, { style: "currency", currency: cur, maximumFractionDigits: d, minimumFractionDigits: d });
  const f0 = nf(0), f2 = nf(2);
  const money = usd => { const v = usd * k; return (Math.abs(v) >= 100 ? f0 : f2).format(Math.abs(v) < 0.005 ? 0 : v); };
  const compact = new Intl.NumberFormat(lang, { style: "currency", currency: cur, notation: "compact", maximumFractionDigits: 0 });
  const num = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const size = gb => (gb >= 1048576 ? num.format(gb / 1048576) + " PB" : gb >= 1024 ? num.format(gb / 1024) + " TB" : num.format(gb) + " GB");
  return { money, short: usd => compact.format(usd * k), size, num: v => num.format(v) };
}

const providerName = (D, id) => D.vps.providers[id]?.name || id;
export const machineName = (D, m) => `${providerName(D, m.provider)} ${m.plan}`;
export const comboName = (D, r) => [r.m && machineName(D, r.m), r.s && r.s.name, r.c && r.c.name].filter(Boolean).join(" + ");

function trafficText(r, q, T, F, D) {
  const m = r.m;
  if (!m) return "—";
  if (m.egress) {
    const prod = m.egress.product, free = m.egress.freeBefore || (m.egress.tiers[r.region].global[0][1] === 0 ? m.egress.tiers[r.region].global[0][0] : 0);
    return fill(T.tr_cloud, { gb: F.size(r.serverGB), tier: prod }) + (free ? " · " + fill(T.tr_free, { gb: F.size(free) }) : "");
  }
  const t = m.traffic;
  if (t.scope === "unlimited") return fill(T.tr_unlim, { gb: F.size(r.serverGB) });
  const inc = t.includedGB * q.count + t.accountFreeGB;
  return fill(r.serverGB > inc ? T.tr_over : T.tr_incl, { inc: F.size(inc), gb: F.size(r.serverGB), x: F.size(r.serverGB - inc) });
}

// one recommendation card; links to other tools carry data-tool and are filled in by the page from the shell's metas
export function pickCard(p, q, T, F, D, aws) {
  const r = p.r, m = r.m;
  const regionName = T["reg_" + r.region];
  const parts = [
    [T.p_machine, m ? `${machineName(D, m)}${q.count > 1 ? " ×" + q.count : ""} · ${regionName} ${m.loc}` : T.none, m ? r.cost.machine : null],
    [T.p_traffic, trafficText(r, q, T, F, D), m ? r.cost.traffic : null],
    [T.p_storage, r.s ? `${r.s.name} · ${F.size(q.storeGB)}${r.bucketGB > 0 ? " · " + fill(T.st_out, { gb: F.size(r.bucketGB) }) : ""}` : T.none, r.s ? r.cost.storage : null],
    [T.p_cdn, r.c ? `${r.c.name} · ${F.size(r.cdnGB)}` : r.s && r.s.cdn ? T.cdn_builtin : T.none, r.c ? r.cost.cdn : null],
  ];
  const why = [];
  if (p.tags.includes("far")) why.push(fill(T.why_far, { region: regionName }));
  if (r.s && q.staticPct > 0 && m) why.push(fill(T.why_store, { s: r.s.name, gb: F.size(r.serverGB) }));
  else if (r.c && m) why.push(fill(T.why_cdn, { c: r.c.name, gb: F.size(r.serverGB) }));
  if (r.flags.includes("free")) why.push(T.why_free);
  if (p.tags.includes("simple") && !p.tags.includes("cheapest")) why.push(fill(T.why_simple, { n: r.vendors }));
  const notes = noteList(r, T);
  const save = aws && aws !== r && aws.total > r.total * 1.05 ? fill(T.vs_aws, { aws: F.money(aws.total), k: F.num(aws.total / Math.max(r.total, 0.01)) }) : "";
  const links = [];
  if (m) links.push(ext(m.source, T.l_src));
  if (m && D.vps.providers[m.provider].m2c) links.push(ext(null, T.l_m2c, ` data-tool="m2c" data-p="${D.vps.providers[m.provider].m2c}" data-pend`));
  if (m && D.vps.providers[m.provider].ls) links.push(ext(null, T.l_ls, ` data-tool="ls" data-pend`));
  return `<article class="pick${p.tags.includes("cheapest") ? " best" : ""}">
<div class="pk-tags">${p.tags.map(t => `<span class="tag t-${t}">${esc(T["tag_" + t])}</span>`).join("")}</div>
<p class="pk-name">${esc(comboName(D, r))}</p>
<p class="pk-total"><b>${F.money(r.total)}</b><small>${esc(T.per_month)}</small></p>
<p class="pk-save">${esc(save)}</p>
<dl class="pk-parts">${parts.map(([k, v, c]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd><dd class="n">${c == null ? "—" : F.money(c)}</dd></div>`).join("")}</dl>
<p class="pk-why">${esc(why.join(" "))}</p>
${notes.length ? `<ul class="pk-notes">${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<p class="links">${links.join("")}</p>
</article>`;
}

// caveats for one combination: from the data (out of stock, fair use…) and from the result (near the port limit…)
export function noteList(r, T) {
  const keys = new Set([r.m && r.m.note, r.s && r.s.note, r.c && r.c.note && r.c.note !== "cloudflare" ? r.c.note : null, ...r.flags.filter(f => f !== "free")].filter(Boolean));
  return [...keys].map(k => T["n_" + k]).filter(Boolean);
}

export function verdict(rec, T, F, D) {
  const q = rec.q, best = rec.picks[0]?.r;
  if (!best) return T.v_none;
  const spec = q.vcpu > 0 ? fill(T.spec, { c: q.vcpu, r: F.num(q.ram) }) : T.spec_none;
  const v = { spec, gb: F.size(q.gb), aud: T["aud_" + q.aud], best: comboName(D, best), t: F.money(best.total) };
  if (rec.aws && rec.aws !== best && rec.aws.total > best.total * 1.05) return fill(T.v_aws, { ...v, aws: F.money(rec.aws.total), k: F.num(rec.aws.total / Math.max(best.total, 0.01)) });
  return fill(T.v_plain, v);
}

export function picksHTML(rec, T, F, D) {
  if (!rec.picks.length) return `<p class="empty">${esc(T.v_none)}</p>`;
  return rec.picks.map(p => pickCard(p, rec.q, T, F, D, rec.aws)).join("");
}

export function tableHTML(rec, T, F, D) {
  const rows = table(rec.rows, 40);
  const near = nearOf(rec.q.aud);
  return `<table class="tbl"><thead><tr><th>${esc(T.c_plan)}</th><th>${esc(T.c_region)}</th><th>${esc(T.c_cpu)}</th><th class="n">${esc(T.p_machine)}</th><th class="n">${esc(T.p_traffic)}</th><th class="n">${esc(T.p_storage)} + ${esc(T.p_cdn)}</th><th class="n">${esc(T.c_total)}</th><th>${esc(T.c_src)}</th></tr></thead><tbody>` +
    rows.map(r => {
      const notes = noteList(r, T);
      const bad = r.flags.some(f => f === "sales" || f === "cfTos" || f === "fair");
      return `<tr${bad ? ' class="bad"' : ""}><td><b>${esc(r.m ? machineName(D, r.m) : r.s.name)}</b>${r.m && r.m.egress ? `<small>${esc(r.m.egress.product)}</small>` : ""}${r.m && (r.s || r.c) ? `<small>+ ${esc([r.s && r.s.name, r.c && r.c.name].filter(Boolean).join(" + "))}</small>` : ""}${notes.length ? `<small class="warn">${esc(notes.join(" "))}</small>` : ""}</td>` +
        `<td${r.region === near ? ' class="near"' : ""}>${esc(T["reg_" + r.region])}${r.m ? `<small>${esc(r.m.loc)}</small>` : ""}</td>` +
        `<td>${r.m ? `${r.m.vcpu} / ${F.num(r.m.ram)} GB<small>${esc(T["cpu_" + r.m.cpu])}${r.m.arch === "arm" ? " · Arm" : ""}</small>` : "—"}</td>` +
        `<td class="n">${r.m ? F.money(r.cost.machine) : "—"}</td><td class="n">${r.m ? F.money(r.cost.traffic) : "—"}</td>` +
        `<td class="n">${r.s || r.c ? F.money(r.cost.storage + r.cost.cdn) : "—"}</td><td class="n"><b>${F.money(r.total)}</b></td>` +
        `<td>${ext(r.m ? r.m.source : r.s.source, T.l_src)}</td></tr>`;
    }).join("") + `</tbody></table>`;
}

// cost as traffic grows, log-log: the picks and the all-AWS reference; where one line overtakes another
export function curveHTML(rec, T, F, D, input) {
  const lines = rec.picks.map((p, i) => ({ name: comboName(D, p.r), cls: "l" + i, v: curve(p.r, input, D, POINTS) }));
  if (rec.aws && !rec.picks.some(p => p.r === rec.aws)) lines.push({ name: T.aws_ref, cls: "la", v: curve(rec.aws, input, D, POINTS) });
  if (!lines.length) return "";
  const W = 760, H = 240, L = 58, R = 10, Tp = 10, B = 28;
  const xs = gb => L + (Math.log10(gb) - 1) / (Math.log10(POINTS[POINTS.length - 1]) - 1) * (W - L - R);
  const all = lines.flatMap(l => l.v).filter(v => v != null && v > 0);
  const y0 = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.min(...all))))), y1 = Math.pow(10, Math.ceil(Math.log10(Math.max(...all))));
  const ys = v => Tp + (1 - (Math.log10(Math.max(v, y0)) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * (H - Tp - B);
  const grid = [];
  for (let e = Math.log10(y0); e <= Math.log10(y1); e++) grid.push(`<line x1="${L}" x2="${W - R}" y1="${ys(10 ** e)}" y2="${ys(10 ** e)}"/><text x="${L - 6}" y="${ys(10 ** e) + 4}" text-anchor="end">${esc(F.short(10 ** e))}</text>`);
  for (const gb of [10, 100, 1024, 10240, 102400, 1048576]) grid.push(`<line x1="${xs(gb)}" x2="${xs(gb)}" y1="${Tp}" y2="${H - B}"/><text x="${xs(gb)}" y="${H - 8}" text-anchor="${gb === 1048576 ? "end" : "middle"}">${esc(F.size(gb))}</text>`);
  const path = v => { let d = "", pen = false; v.forEach((y, i) => { if (y == null) { pen = false; return; } d += `${pen ? "L" : "M"}${xs(POINTS[i]).toFixed(1)},${ys(y).toFixed(1)}`; pen = true; }); return d; };
  const at = Math.min(Math.max(input.gb || 10, 10), POINTS[POINTS.length - 1]);
  const cross = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (const x of crossings(POINTS, lines[i].v, lines[j].v)) cross.push(fill(T.cross, { gb: F.size(Math.round(x.gb)), b: x.cheaper === "b" ? lines[j].name : lines[i].name, a: x.cheaper === "b" ? lines[i].name : lines[j].name }));
  return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T.curve_h)}"><g class="grid">${grid.join("")}</g>` +
    `<line class="now" x1="${xs(at)}" x2="${xs(at)}" y1="${Tp}" y2="${H - B}"/>` +
    lines.map(l => `<path class="${l.cls}" d="${path(l.v)}"/>`).join("") + `</svg>` +
    `<ul class="legend">${lines.map(l => `<li class="${l.cls}"><i></i>${esc(l.name)}</li>`).join("")}</ul>` +
    `<ul class="cross">${cross.slice(0, 4).map(c => `<li>${esc(c)}</li>`).join("")}</ul>`;
}
