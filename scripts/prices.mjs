#!/usr/bin/env node
// Checks data/*.json against the providers that publish their prices as data: AWS (Price List API: data transfer,
// CloudFront, S3, Lightsail; EC2 from the map behind its pricing page), Azure (Retail Prices API) and Vultr (its
// public plans API). It never edits the data: it lists what differs, and what has not been re-checked by hand for
// 90 days (Hetzner, DigitalOcean, Linode, Oracle, Google Cloud, R2, B2, Wasabi, Spaces, Bunny have no price API).
// Exit 1 when anything needs a look; the weekly GitHub workflow runs it and fails loudly.
// Usage: node scripts/prices.mjs
import { loadData } from "./data.mjs";

const D = loadData();
const problems = [];
const say = (what, ok, detail) => { console.log(`${ok ? "  ok  " : "  DIFF"} ${what}${ok ? "" : "  " + detail}`); if (!ok) problems.push(what); };
const json = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const close = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
const sameTiers = (a, b) => a.length === b.length && a.every(([u, p], i) => (u ?? null) === (b[i][0] ?? null) && close(p, b[i][1]));
const fmt = t => t.map(([u, p]) => `${u ?? "∞"}:${p}`).join(" ");
const AWS = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws";
const AWS_REGION = { na: "us-east-1", eu: "eu-central-1", ap: "ap-northeast-1" };
const AWS_NAME = { na: "US East (N. Virginia)", eu: "EU (Frankfurt)", ap: "Asia Pacific (Tokyo)" };
const dims = (offer, sku) => Object.values(offer.terms.OnDemand[sku] || {}).flatMap(t => Object.values(t.priceDimensions)).sort((x, y) => x.beginRange - y.beginRange);
const toTiers = ds => ds.map(d => [d.endRange === "Inf" ? null : +d.endRange, +d.pricePerUnit.USD]);

async function step(name, fn) {
  try { await fn(); } catch (e) { say(name, false, "could not check: " + e.message); }
}

// AWS internet egress, per source region
await step("AWS egress", async () => {
  const prof = D.egress.profiles.find(p => p.id === "aws");
  for (const [r, id] of Object.entries(AWS_REGION)) {
    const o = await json(`${AWS}/AWSDataTransfer/current/${id}/index.json`);
    const [sku] = Object.entries(o.products).find(([, p]) => p.attributes.transferType === "AWS Outbound" && p.attributes.toLocation === "External" && p.attributes.fromLocation !== "Global");
    const live = toTiers(dims(o, sku));
    say(`AWS egress ${r}`, sameTiers(live, prof.tiers[r].global), `live ${fmt(live)} · data ${fmt(prof.tiers[r].global)}`);
  }
});

// CloudFront, by edge region (US for North America, Europe, Japan for Asia-Pacific, Asia Pacific for mainland China visitors)
await step("CloudFront", async () => {
  const cf = D.cdn.services.find(c => c.id === "cloudfront");
  const o = await json(`${AWS}/AmazonCloudFront/current/index.json`);
  for (const [aud, prefix] of Object.entries({ na: "US", eu: "EU", ap: "JP", cn: "AP" })) {
    const [sku] = Object.entries(o.products).find(([, p]) => p.attributes.usagetype === `${prefix}-DataTransfer-Out-Bytes`);
    const live = toTiers(dims(o, sku));
    say(`CloudFront ${aud}`, sameTiers(live, cf.tiers[aud]), `live ${fmt(live)} · data ${fmt(cf.tiers[aud])}`);
  }
});

// S3 Standard storage in us-east-1
await step("S3", async () => {
  const s3 = D.storage.services.find(s => s.id === "s3");
  const o = await json(`${AWS}/AmazonS3/current/us-east-1/index.json`);
  const [sku] = Object.entries(o.products).find(([, p]) => p.attributes.usagetype === "TimedStorage-ByteHrs" && p.attributes.volumeType === "Standard");
  const live = toTiers(dims(o, sku));
  say("S3 Standard storage", sameTiers(live, s3.storage), `live ${fmt(live)} · data ${fmt(s3.storage)}`);
});

// Lightsail Linux bundles (dual-stack monthly price, allowance) and overage, per region
await step("Lightsail", async () => {
  const index = await json(`${AWS}/AmazonLightsail/current/region_index.json`);
  for (const [r, id] of Object.entries(AWS_REGION)) {
    const offer = D.vps.offers.find(o => o.id === `lightsail-${r}`);
    const o = await json(`https://pricing.us-east-1.amazonaws.com${index.regions[id].currentVersionUrl}`);
    const price = sku => { const d = dims(o, sku)[0]; return d ? +d.pricePerUnit.USD : null; };
    let over = null; const bundles = {};
    for (const [sku, p] of Object.entries(o.products)) {
      const a = p.attributes, ut = a.usagetype || "";
      const m = /-BundleUsage:([\d.]+)GB$/.exec(ut);
      if (p.productFamily === "Lightsail Instance" && a.operatingSystem === "Linux" && !a.instancefamily && m) bundles[+m[1]] = Math.round(price(sku) * 744 * 10) / 10;   // the hourly rate is the monthly price ÷ 744, rounded
      if (/-DataXfer-Out-Overage-Bytes$/.test(ut) && !/Storage|Container|CDN|Database/i.test(ut)) over = price(sku);
    }
    const bad = offer.plans.filter(([, , ram, , monthly]) => bundles[ram] != null && !close(bundles[ram], monthly)).map(([n, , ram, , monthly]) => `${n}: live $${bundles[ram]} data $${monthly}`);
    say(`Lightsail ${r} bundles`, !bad.length, bad.join(", "));
    say(`Lightsail ${r} overage`, close(over, offer.traffic.overagePerGB), `live ${over} · data ${offer.traffic.overagePerGB}`);
  }
});

// EC2 t4g hourly prices, from the map AWS's on-demand pricing page loads
await step("EC2", async () => {
  for (const r of Object.keys(AWS_REGION)) {
    const offer = D.vps.offers.find(o => o.id === `aws-t4g-${r}`);
    const o = await json(`https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(AWS_NAME[r])}/Linux/index.json`);
    const live = {};
    for (const v of Object.values(Object.values(o.regions)[0])) live[v["Instance Type"]] = +v.price;
    const bad = offer.plans.filter(([n, , , , h]) => live[n] != null && !close(live[n], h)).map(([n, , , , h]) => `${n}: live ${live[n]} data ${h}`);
    say(`EC2 t4g ${r}`, !bad.length, bad.join(", "));
  }
});

// Azure: B-series VMs and both egress routings, per region
await step("Azure", async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = async f => { await wait(1500); let url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(f)}`, out = []; while (url) { const r = await json(url); out.push(...r.Items); url = r.NextPageLink; } return out; };
  const REG = { na: "eastus", eu: "westeurope", ap: "japaneast" };
  for (const [r, reg] of Object.entries(REG)) {
    const offer = D.vps.offers.find(o => o.id === `azure-b-${r}`);
    const skus = offer.plans.map(([n]) => `skuName eq '${n}'`).join(' or ');
    const vms = await q(`serviceName eq 'Virtual Machines' and armRegionName eq '${reg}' and priceType eq 'Consumption' and (${skus})`);
    const live = {};
    for (const i of vms) if (!/Windows|Spot|Low Priority|Cloud Services/.test(i.productName + i.skuName + i.meterName)) live[i.skuName] = i.retailPrice;
    const bad = offer.plans.filter(([n, , , , h]) => live[n] != null && !close(live[n], h)).map(([n, , , , h]) => `${n}: live ${live[n]} data ${h}`);
    say(`Azure B-series ${r}`, !bad.length, bad.join(", "));
    for (const [id, product] of [["azure-internet", "Bandwidth - Routing Preference: Internet"], ["azure-mgn", "Rtn Preference: MGN"]]) {
      const items = (await q(`armRegionName eq '${reg}' and productName eq '${product}'`)).filter(i => i.meterName === "Standard Data Transfer Out").sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits);
      const prof = D.egress.profiles.find(p => p.id === id).tiers[r].global;
      // adjacent tiers at the same price are one tier
      const live2 = items.map((i, k) => [items[k + 1] ? items[k + 1].tierMinimumUnits : null, i.retailPrice])
        .reduce((acc, t) => { const last = acc[acc.length - 1]; if (last && last[1] === t[1]) last[0] = t[0]; else acc.push([...t]); return acc; }, []);
      say(`Azure ${id} ${r}`, sameTiers(live2, prof), `live ${fmt(live2)} · data ${fmt(prof)}`);
    }
  }
});

// Vultr plans (price and transfer) from its public API
await step("Vultr", async () => {
  for (const [type, offerId] of [["vc2", "vultr-vc2"], ["vhp", "vultr-vhp"]]) {
    const { plans } = await json(`https://api.vultr.com/v2/plans?type=${type}&per_page=500`);
    const offer = D.vps.offers.find(o => o.id === offerId);
    const bad = [];
    for (const [name, vcpu, ram, disk, price, gb] of offer.plans) {
      const p = plans.find(x => x.vcpu_count === vcpu && x.ram === ram * 1024 && x.disk === disk && (type !== "vhp" || /amd$/.test(x.id)));
      if (!p) bad.push(`${name}: gone`);
      else if (!close(p.monthly_cost, price) || p.bandwidth !== gb) bad.push(`${name}: live $${p.monthly_cost} ${p.bandwidth} GB · data $${price} ${gb} GB`);
    }
    say(`Vultr ${type}`, !bad.length, bad.join(", "));
  }
});

// what can only be checked by hand: anything not re-verified in 90 days
const all = [...D.vps.offers, ...D.egress.profiles, ...D.storage.services, ...D.cdn.services, D.rates];
const old = all.filter(e => (Date.now() - new Date(e.verifiedAt)) / 864e5 > 90);
say("checked by hand within 90 days", !old.length, old.map(e => `${e.id || "rates"} (${e.verifiedAt})`).join(", "));

console.log(problems.length ? `\n${problems.length} to look at` : "\nall prices match");
process.exit(problems.length ? 1 : 0);
