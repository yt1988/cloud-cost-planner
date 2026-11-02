# Cloud Cost Planner

[简体中文](README.zh-CN.md) · Live: **https://cost.1ms.dog**

Tell it what you run and how much traffic it serves; it prices every VPS and cloud plan together with object storage and
CDNs for one month and recommends the cheapest setup.

- **Servers**: Hetzner, DigitalOcean, Vultr, Linode (Akamai), AWS Lightsail, Tencent Cloud Lighthouse, Alibaba Cloud Simple
  Application Server (Hong Kong, Singapore, Tokyo, Frankfurt, Virginia), Oracle Cloud, AWS EC2, Google Cloud, Azure
- **Object storage**: Cloudflare R2, Amazon S3, Backblaze B2, Wasabi, DigitalOcean Spaces, Hetzner Object Storage
- **CDN**: Cloudflare (Free), Amazon CloudFront, Bunny CDN
- Included traffic and overage, per-GB cloud egress with its tiers and free allowances, Premium/Standard network tiers,
  traffic to mainland China, request fees, minimum charges, fair-use and terms limits (video on Cloudflare Free,
  Wasabi egress above what is stored)
- Latency from your own browser to every data center on the page (Me2Cloud's endpoints and method)
- Servers scale with traffic (about 1 Gbit/s each, or the plan's port speed); sold-out plans are shown, never recommended
- Picks: cheapest near your visitors, fewest vendors, Hong Kong for visitors in mainland China, and another continent when
  it is clearly cheaper; a cost curve as traffic grows and where
  the lines cross; every provider in a table
- 10 languages, 25 prerendered pages per language (scenarios, egress cost, comparisons, cheapest of a kind)
- Everything runs in the browser; no backend, nothing uploaded

## Price data

`data/*.json` holds every price, each entry with its `source` (the provider's pricing page or price API) and
`verifiedAt` date. The build copies it to `/data/*.json` (CORS open) for anyone to use.

| File | What |
|---|---|
| `vps.json` | server plans per provider line and region: vCPU, RAM, disk, price, included transfer |
| `egress.json` | public clouds' internet egress tiers, by source region and destination |
| `storage.json` | object storage: storage, egress, requests, minimums |
| `cdn.json` | CDN tiers by visitor region |
| `rates.json` | fixed exchange rates (ECB) |

Prices exclude VAT. 1 TB = 1024 GB, a month = 730 hours. `npm test` checks that every entry has a source and date,
that tiers only go up, and the engine against hand-worked prices and a snapshot of every scenario; an entry older than
90 days prints a warning.

Found a wrong price? Open an issue with the provider's page.

## Develop

```bash
npm ci
npm run build      # public/ from src/ and data/
npm test           # build is up to date, data checks, engine tests
npm run dev        # http://localhost:8799/
npm run og         # link-preview images (uses system fonts; commit the output)
```

`npm run prices` compares the data with the price APIs of AWS, Azure and Vultr and lists entries not re-checked by hand
for 90 days; a GitHub workflow runs it every Monday and fails when something needs a look. After a deliberate price
change, refresh the snapshot: `UPDATE=1 node --test "test/*.test.mjs"`.

| Path | What |
|---|---|
| `src/calc.mjs` | the engine: every server × storage × CDN combination, priced; the picks |
| `src/view.mjs` | HTML for picks, verdict, table and curve (build and browser share it) |
| `src/pages.mjs` | the long-tail pages and their tables |
| `src/scenes.mjs` | scenario presets |
| `src/i18n/*.mjs` | strings, one file per language (a missing key fails the build) |
| `scripts/build.mjs` | writes `public/` |

## Deploy

`npx wrangler deploy` uploads `public/` as Cloudflare Worker static assets plus `src/worker.js`. Files are served without
running the Worker (free); it only answers shared result links (`/r/<code>`), giving them the recommendation as their
preview title, and 404s. Set `SITE_URL` when building for another domain. On a plain static host everything works except the per-result preview title.

## License

MIT
