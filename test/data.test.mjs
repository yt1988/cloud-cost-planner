// The price data: every entry says where it came from and when it was checked, tiers only go up, plans are well formed.
// A check older than 90 days prints a warning (re-verify against the source) but does not fail.
import test from "node:test";
import assert from "node:assert/strict";
import { loadData } from "../scripts/data.mjs";

const D = loadData();
const today = new Date();
const entries = [...D.vps.offers, ...D.egress.profiles, ...D.storage.services, ...D.cdn.services, D.rates];

test("every entry has a source and a check date", () => {
  for (const e of entries) {
    assert.match(e.source, /^https:\/\//, `${e.id || "rates"}: source`);
    assert.match(e.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${e.id || "rates"}: verifiedAt`);
    for (const k of ["trafficSource", "diskSource"]) if (e[k]) assert.match(e[k], /^https:\/\//, `${e.id}: ${k}`);
  }
});

test("checks older than 90 days are flagged", () => {
  const old = entries.filter(e => (today - new Date(e.verifiedAt)) / 864e5 > 90);
  if (old.length) console.warn(`\n⚠ price data not re-verified for 90+ days: ${old.map(e => e.id || "rates").join(", ")}\n`);
});

// [[upTo, price], …]: limits strictly increasing; the last is null, or (CDN volume plans) a "contact sales" limit
function checkTiers(name, tiers) {
  assert.ok(Array.isArray(tiers) && tiers.length, `${name}: tiers`);
  let prev = 0;
  tiers.forEach(([upTo, price], i) => {
    assert.ok(price >= 0, `${name}: price ${price}`);
    if (upTo == null) assert.equal(i, tiers.length - 1, `${name}: only the last tier is open-ended`);
    else { assert.ok(upTo > prev, `${name}: limits go up (${prev} → ${upTo})`); prev = upTo; }
  });
}

test("tiers are monotonic", () => {
  for (const p of D.egress.profiles) for (const [src, by] of Object.entries(p.tiers)) for (const [dst, t] of Object.entries(by)) checkTiers(`${p.id} ${src}→${dst}`, t);
  for (const c of D.cdn.services) for (const [aud, t] of Object.entries(c.tiers)) checkTiers(`${c.id} ${aud}`, t);
  for (const s of D.storage.services) checkTiers(`${s.id} storage`, s.storage);
});

test("egress profiles cover every region", () => {
  for (const p of D.egress.profiles) for (const r of ["na", "eu", "ap"]) assert.ok(p.tiers[r]?.global, `${p.id}: ${r}`);
  for (const c of D.cdn.services) for (const a of ["na", "eu", "ap", "cn"]) assert.ok(c.tiers[a], `${c.id}: ${a}`);
});

test("server plans are well formed", () => {
  const profiles = new Set(D.egress.profiles.map(p => p.id));
  for (const o of D.vps.offers) {
    assert.ok(D.vps.providers[o.provider], `${o.id}: provider`);
    assert.ok(o.region ? ["na", "eu", "ap"].includes(o.region) : Object.keys(o.regions).every(r => ["na", "eu", "ap"].includes(r)), `${o.id}: region`);
    assert.ok(D.rates.usdPer[o.currency], `${o.id}: currency`);
    assert.ok(["shared", "dedicated"].includes(o.cpu), `${o.id}: cpu`);
    if (o.egress) for (const e of o.egress) assert.ok(profiles.has(e), `${o.id}: egress ${e}`);
    else assert.ok(["instance", "pooled", "unlimited"].includes(o.traffic.scope), `${o.id}: traffic scope`);
    for (const [name, vcpu, ram, disk, price, gb] of o.plans) {
      assert.ok(vcpu > 0 && ram > 0 && price > 0, `${o.id} ${name}: numbers`);
      assert.ok(disk == null ? !!o.extras : disk > 0, `${o.id} ${name}: disk`);
      if (!o.egress && o.traffic.scope !== "unlimited") assert.ok(gb > 0, `${o.id} ${name}: included transfer`);
    }
  }
});
