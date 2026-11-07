# AGENTS.md

For people and AI agents taking over this repository. The README describes the product; this file covers how to work on it.
Operating notes for 1ms.dog itself are kept in the private repository 1ms-shell.

## What it is

A static calculator: you say what you run and how much traffic it serves, and it prices every VPS and cloud plan, plus
object storage and CDNs, for one month, then recommends the cheapest setup. Everything is computed in the browser from
the price data in `data/*.json`. There is no backend or database, and nothing is uploaded. A small Cloudflare Worker
(`src/worker.js`) answers only shared result links (`/r/<code>`) and 404s.

- `src/calc.mjs`: the engine (pure functions; the browser bundle and the tests both use it)
- `src/view.mjs`: HTML for the picks, verdict, table and curve (shared by the build and the browser)
- `src/pages.mjs`, `src/scenes.mjs`: the prerendered long-tail pages and the scenario presets
- `src/i18n/*.mjs`: 10 languages, one file each (a key missing in any language fails the build)
- `scripts/build.mjs`: writes `public/`, which is committed (hashed asset names, 25 pages per language)
- `public/assets/share/`: a copied share widget (button, QR code, image card). Update it by replacing the files
  as a set; don't edit them by hand.
- `docs/design.md`: the engine's assumptions, and why things are the way they are
- `docs/prices.md`: where every price comes from, and how to update it

## Run locally

```bash
npm ci
npm run build      # public/ from src/ and data/
npm run dev        # http://localhost:8799/ with the production headers (public/_headers, including the CSP)
```

After any change to `src/` or `data/`, run `npm run build` again: `public/` is what gets deployed, and CI fails if it is
out of date.

## Test (pick by what changed)

- **Copy or style only** (an i18n string, CSS): `npm run build`, then look at the page in `npm run dev`, on a phone width too.
  Long languages (de, ru, fr) are the ones that wrap or overflow.
- **Anything else**: `npm test`. It checks that the build is up to date, the data's sources, dates and tiers, the engine
  against hand-worked prices, and a snapshot of every scenario's recommendation.
- **A deliberate price or engine change** that moves a recommendation: check that the diff makes sense, then refresh the
  snapshot with `UPDATE=1 node --test "test/*.test.mjs"` and commit `test/snapshot.json` with the change.
- **Link-preview images** (name, subtitle or logo changed): `npm run og`, then commit `public/og/`. It uses system fonts.

## Deploy

`npx wrangler deploy` uploads `public/` as Worker static assets, plus `src/worker.js` (see `wrangler.toml`). On another
domain, set `SITE_URL=https://<your-domain>` when you build (canonical URLs, sitemap, og tags), and bind the domain to the
Worker in the Cloudflare dashboard. A plain static host also works, apart from the preview title on shared result links.
If you connect the repository to Workers Builds, use the build command `npm ci && npm test` so a stale `public/` never ships.

Optional `<meta>` tags that a hosting shell may inject (`m2c`, `ls`, `v2c`: https addresses of companion tools) turn on
extras such as browser-to-data-center latency. Without them the page works the same, and those slots stay empty.

## When the weekly price check fails

`.github/workflows/prices.yml` runs `npm run prices` (`scripts/prices.mjs`) every Monday. It never edits data; it fails
when something needs a person. Read the job's log:

1. **`DIFF <name>  …`**: a provider's price API now disagrees with `data/*.json`. The log prints both values. Open the
   entry's `source` to confirm, then update the numbers in the data file.
2. **`could not check`**: the API failed or changed shape. Rerun the workflow; if it keeps failing, fix the parser in
   `scripts/prices.mjs`, not the data.
3. **Not re-checked for 90 days**: providers without a price API (see `docs/prices.md`). Open the `source` page, compare
   it with the entry, and correct it if needed.

In every case, set the entry's `verifiedAt` to today, and then:

```bash
npm run prices     # now clean
npm test           # if a recommendation moved, check it, then UPDATE=1 node --test "test/*.test.mjs"
npm run build
```

Commit `data/`, `test/snapshot.json` and `public/` together. The footer's "prices checked" date is the oldest `verifiedAt`
in the data. For exchange rates, update `data/rates.json` from the ECB reference rates (its `date` and `verifiedAt`).

## Conventions

- Prices are USD before VAT (EUR prices are converted at the fixed ECB rates in `data/rates.json`). 1 TB = 1024 GB, and a
  month is 730 hours.
- Every data entry needs a `source` URL (the provider's own page or API) and a `verifiedAt` date.
- Never fall back to a cut-off "…" in UI text or on the share card: let it wrap, or pick a smaller size that fits.
- Shared result links (`/r/<code>`) begin with a format version. Never change what an existing version means: add a new
  version instead, and keep the old ones opening.
- Comments explain why, not what. Keep the README (English and `README.zh-CN.md`) in step with features.
  The README block between `<!-- 1ms-repos … -->` and `<!-- /1ms-repos -->` is generated elsewhere, so don't edit it.
