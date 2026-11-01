// Loads the price data (data/*.json) into the shape src/calc.mjs reads: { vps, egress, storage, cdn, rates }.
import { readFileSync } from "node:fs";
const read = f => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), "utf8"));
export const loadData = () => ({ vps: read("vps"), egress: read("egress"), storage: read("storage"), cdn: read("cdn"), rates: read("rates") });
