// The engine against prices worked out by hand, and a snapshot of every scenario's recommendation
// (UPDATE=1 node --test test/ rewrites test/snapshot.json after a deliberate data change).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { loadData } from "../scripts/data.mjs";
import { tiered, machines, storages, price, normalize, recommend, crossings, portGB, toQuery, fromQuery } from "../src/calc.mjs";
import { SCENES } from "../src/scenes.mjs";

const D = loadData();
const M = machines(D), S = storages(D);
const m = id => M.find(x => x.id === id) || assert.fail("no machine " + id);
const s = id => S.find(x => x.id === id);
const c = id => D.cdn.services.find(x => x.id === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≠ ${b}`);
const q = o => normalize({ vcpu: 1, ram: 1, disk: 25, gb: 0, staticPct: 0, storeGB: 0, aud: "na", ...o });

test("tiered pricing", () => {
  const t = [[100, 0], [1000, 0.1], [null, 0.05]];
  near(tiered(50, t).cost, 0);
  near(tiered(600, t).cost, 50);
  near(tiered(2000, t).cost, 90 + 50);
  const capped = tiered(3000, [[1000, 0.01], [2000, 0.005]]);
  assert.equal(capped.over, true);
  near(capped.cost, 10 + 5 + 5);
});

test("EC2 in Tokyo, 1000 GB to mainland China: instance + IPv4 + disk + egress after the 100 GB free", () => {
  const r = price(m("aws-t4g-ap:t4g.small:ap:aws"), null, null, q({ gb: 1000, aud: "cn" }), D);
  near(r.cost.machine, 0.0216 * 730 + 0.005 * 730 + 25 * 0.08);
  near(r.cost.traffic, 900 * 0.114);
});

test("GCP Premium from Iowa, 5000 GB: 1 GB free, then 0.12 to 1 TB, 0.11 after", () => {
  const r = price(m("gcp-e2-na:e2-medium:na:gcp-premium"), null, null, q({ gb: 5000 }), D);
  near(r.cost.traffic, 1023 * 0.12 + (5000 - 1024) * 0.11);
  near(r.cost.machine, 0.03350571 * 730 + 3.65 + 2.5);
});

test("GCP Standard: 200 GB free, the tiers count from zero", () => {
  const r = price(m("gcp-e2-na:e2-medium:na:gcp-standard"), null, null, q({ gb: 5000 }), D);
  near(r.cost.traffic, (5000 - 200) * 0.085);
});

test("Hetzner CPX11 in the US: euros, 1 TB included, €1 per extra TB", () => {
  const r = price(m("hetzner-cpx-na:CPX11:na"), null, null, q({ gb: 3000 }), D);
  near(r.cost.machine, 17.99 * 1.1172);
  near(r.cost.traffic, ((3000 - 1024) / 1024) * 1.1172);
});

test("Vultr: plan transfer plus the account's free 2 TB, pooled; three servers triple the plan part", () => {
  const vm = m("vultr-vc2:Regular 1 vCPU / 1 GB:na");
  near(price(vm, null, null, q({ gb: 4000 }), D).cost.traffic, (4000 - 1024 - 2048) * 0.01);
  const three = price(vm, null, null, q({ gb: 6000, count: 3 }), D);
  near(three.cost.machine, 15);
  near(three.cost.traffic, (6000 - 3 * 1024 - 2048) * 0.01);
});

test("a server's disk must hold the files it serves", () => {
  const vm = m("hetzner-cx-eu:CX23:eu");                               // 40 GB
  assert.ok(price(vm, null, null, q({ gb: 100, staticPct: 50, storeGB: 10 }), D));
  assert.equal(price(vm, null, null, q({ gb: 100, staticPct: 50, storeGB: 100 }), D), null);
  assert.ok(price(vm, s("r2"), null, q({ gb: 100, staticPct: 50, storeGB: 100 }), D));
});

test("Always Free: one e2-micro in a US region costs only its IPv4 address", () => {
  const vm = m("gcp-e2-na:e2-micro:na:gcp-standard");
  near(price(vm, null, null, q({ gb: 100, free: true }), D).cost.machine, 3.65);
  near(price(vm, null, null, q({ gb: 100 }), D).cost.machine, 0.008376428 * 730 + 3.65 + 2.5);
});

test("object storage: B2 egress free up to 3× stored, Wasabi bills at least 1 TB, Spaces has a base fee", () => {
  const back = q({ vcpu: 0, ram: 0, gb: 500, staticPct: 100, storeGB: 5120 });
  near(price(null, s("b2"), null, back, D).cost.storage, (5120 - 10) * 0.0067871);
  near(price(null, s("b2"), null, { ...back, gb: 20000 }, D).cost.storage, (5120 - 10) * 0.0067871 + (20000 - 15360) * 0.01);
  near(price(null, s("wasabi"), null, { ...back, storeGB: 100 }, D).cost.storage, 1024 * 0.0078027);
  near(price(null, s("spaces"), null, { ...back, storeGB: 300, gb: 1500 }, D).cost.storage, 5 + 50 * 0.02 + (1500 - 1024) * 0.01);
});

test("R2 behind Cloudflare: storage and GET requests only", () => {
  const r = price(m("hetzner-cx-eu:CX23:eu"), s("r2"), null, q({ gb: 10000, staticPct: 100, storeGB: 1000, objKB: 100 }), D);
  const reqM = 10000 * 1048576 / 100 / 1e6;
  near(r.cost.storage, (1000 - 10) * 0.015 + (reqM - 10) * 0.36);
});

test("CloudFront: 1 TB free, then the visitors' region tiers, plus HTTPS requests after 10 million", () => {
  const r = price(m("aws-t4g-na:t4g.small:na:aws"), s("s3"), c("cloudfront"), q({ gb: 5000, staticPct: 100, storeGB: 100, objKB: 1000 }), D);
  const reqM = 5000 * 1048576 / 1000 / 1e6;
  near(r.cost.cdn, (5000 - 1024) * 0.085 + Math.max(0, reqM - 10) * 1);
  near(r.cost.traffic, 0);                                              // S3 → CloudFront is free, the server sends nothing
});

test("a cheaper line overtakes as traffic grows", () => {
  const pts = [10, 100, 1000, 10000];
  const x = crossings(pts, [5, 5, 5, 5], [1, 2, 10, 100]);
  assert.equal(x.length, 1);
  assert.ok(x[0].gb > 100 && x[0].gb < 1000);
});

test("state survives the link", () => {
  const st = { scene: "blog", vcpu: 1, ram: 2, disk: 25, count: 1, gb: 100, staticPct: 80, storeGB: 10, aud: "cn", shared: true, free: false, objKB: 100 };
  assert.deepEqual(fromQuery(toQuery(st)), st);
  assert.equal(fromQuery("gb=5"), null);
});

// the picks for every scenario and audience, against test/snapshot.json
test("scenario snapshot", () => {
  const snap = {};
  for (const sc of SCENES) for (const aud of ["na", "eu", "ap", "cn"]) {
    const r = recommend({ ...sc, aud }, D);
    const name = x => [x.m ? `${x.m.offer} ${x.m.plan}${x.m.egress ? " " + x.m.egress.id : ""} @${x.region}` : "-", x.s ? x.s.id : "-", x.c ? x.c.id : "-"].join(" + ");
    snap[`${sc.id}/${aud}`] = { picks: r.picks.map(p => `${p.tags.join(",")}: ${name(p.r)} = ${p.r.total.toFixed(2)}`), aws: r.aws ? r.aws.total.toFixed(2) : null };
  }
  const file = new URL("snapshot.json", import.meta.url);
  if (process.env.UPDATE) writeFileSync(file, JSON.stringify(snap, null, 2) + "\n");
  assert.deepEqual(snap, JSON.parse(readFileSync(file, "utf8")));
});

test("a shared result's code round-trips, and bad codes are refused", async () => {
  const { toCode, fromCode } = await import("../src/calc.mjs");
  const st = { scene: "", vcpu: 2, ram: 0.5, disk: 50, count: 3, gb: 20480, staticPct: 95, storeGB: 2048, aud: "cn", shared: false, free: true, objKB: 50000 };
  assert.equal(toCode(st), "1_-_2_0.5_50_3_20480_95_2048_cn_2_50000");
  assert.deepEqual(fromCode(toCode(st)), st);
  for (const bad of ["", "2_-_2_4_50_1_1_1_1_na_1_1", "1_-_2_4_50_1_1_101_1_na_1_1", "1_-_2_4_50_0_1_1_1_na_1_1", "1_x_2_4_50_1_1_1_1_mars_1_1", "1_<b>_2_4_50_1_1_1_1_na_1_1"])
    assert.equal(fromCode(bad), null, bad);
});

test("the Worker's preview: the page, the cheapest setup in the title, the verdict as description", async () => {
  const { resultMeta } = await import("../src/worker.js");
  const m = resultMeta("/zh-cn/download-site-cost/r/1_download_2_4_50_1_20480_95_2048_na_1_50000");
  assert.equal(m.page, "/zh-cn/download-site-cost/");
  assert.match(m.title, /Hetzner|Vultr|Oracle|DigitalOcean|Tencent|Alibaba/);
  assert.match(m.title, /云成本规划器$/);
  assert.match(m.desc, /20 TB/);
  assert.equal(resultMeta("/r/1_-_1_2_25_1_100_0_0_na_1_500").page, "/");
  for (const bad of ["/ja/r/garbage", "/download-site-cost/r/zz", "/r/2_-_1_2_25_1_100_0_0_na_1_500", "/r/1_-_1_2_25_1_100_0_0_na", "/r/1_%E0"]) assert.equal(resultMeta(bad), null, bad);
  assert.equal(resultMeta("/zh-cn/no-such-page/r/1_-_1_2_25_1_100_0_0_na_1_500"), null);
  assert.equal(resultMeta("/zh-cn/download-site-cost/"), null);
});

test("a plan marked sold out is priced but never recommended", () => {
  const r = price(m("hetzner-cx-eu:CX23:eu"), null, null, q({ gb: 100 }), D);
  assert.ok(r.flags.includes("soldOut"));
  const rec = recommend({ vcpu: 1, ram: 2, disk: 20, gb: 100, staticPct: 0, storeGB: 0, aud: "eu" }, D);
  assert.ok(rec.picks.every(p => !p.r.flags.includes("soldOut")));
  assert.ok(rec.rows.some(x => x.flags.includes("soldOut")));
});

test("traffic beyond what one server carries adds servers", () => {
  const vm = m("hetzner-cpx-na:CPX21:na");
  const one = price(vm, null, null, q({ gb: 100000 }), D);
  assert.equal(one.count, 1);
  const big = price(vm, null, null, q({ gb: 512000 }), D);
  assert.equal(big.count, Math.ceil(512000 / portGB(1000)));
  assert.ok(big.flags.includes("scaled"));
  near(big.cost.machine, 32.49 * 1.1172 * big.count);
  near(big.cost.traffic, ((512000 - 2048 * big.count) / 1024) * 1.1172);
});

test("about the same price with fewer vendors wins; the AWS reference may use S3 and CloudFront", () => {
  for (const sc of SCENES) for (const aud of ["na", "eu", "ap", "cn"]) {
    const rec = recommend({ ...sc, aud }, D), top = rec.picks[0].r;
    const ok = rec.rows.filter(r => r.region === top.region && !r.flags.some(f => ["sales", "cfTos", "fair", "soldOut"].includes(f)));
    const cheapest = ok[0];
    // nothing near the visitors with fewer vendors costs about the same as the pick, and the pick is no dearer than that
    assert.ok(top.total <= cheapest.total + Math.max(1, cheapest.total * 0.05) + 1e-9, `${sc.id}/${aud}`);
    assert.ok(!ok.some(r => r.vendors < top.vendors && r.total <= cheapest.total + Math.max(1, cheapest.total * 0.05)), `${sc.id}/${aud} fewer vendors`);
  }
  const dl = recommend({ vcpu: 2, ram: 4, disk: 20, gb: 20480, staticPct: 95, storeGB: 2048, aud: "na", objKB: 50000 }, D);
  assert.equal(dl.aws.m.provider, "aws");
  assert.ok(!dl.aws.s || dl.aws.s.id === "s3");
  assert.ok(!dl.aws.c || dl.aws.c.id === "cloudfront");
});
