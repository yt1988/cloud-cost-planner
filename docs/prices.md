# Price data: sources and checks

Every entry in `data/*.json` records its `source` (the provider's own pricing page or price API) and a `verifiedAt`
date. The footer shows the oldest of those dates. Prices exclude VAT. The workflow for a failed weekly check is in
`AGENTS.md`.

## Checked automatically every week (`scripts/prices.mjs`)

These providers publish prices as data, so the script compares them with `data/*.json` and prints `DIFF` on any mismatch:

| What | API |
|---|---|
| AWS internet egress, by source region | Price List API, `AWSDataTransfer` |
| CloudFront, by edge region | Price List API, `AmazonCloudFront` |
| S3 Standard (us-east-1) | Price List API, `AmazonS3` |
| Lightsail Linux bundles and overage | Price List API, per region (hourly × 744 = the monthly price) |
| EC2 t4g | the price map that AWS's on-demand pricing page loads |
| Azure B-series, Azure egress (Microsoft network and internet routing) | Azure Retail Prices API |
| Vultr Cloud Compute and High Performance | Vultr's public plans API |

The script never edits the data. When a provider changes its API, it reports "could not check" instead of guessing.

## Checked by hand (no price API)

Hetzner (Cloud and Object Storage), DigitalOcean (Droplets and Spaces), Linode / Akamai, Oracle Cloud, Google Cloud
(Compute and network tiers), Tencent Cloud Lighthouse, Alibaba Cloud Simple Application Server, Cloudflare (R2 and CDN),
Backblaze B2, Wasabi and Bunny CDN. The weekly run lists any of these whose `verifiedAt` is more than 90 days old, and
`npm test` warns about them too. Re-check them against the `source` page in each entry.

Things to watch when re-checking by hand:

- **Included transfer and overage** are part of the plan (a plan's last field is its included GB, or `null` when it is
  billed through a cloud egress profile).
- **Region differences**: some providers charge more, or include less transfer, outside their home region. Each region
  is its own offer in `vps.json`.
- **Sold-out plans** are kept with `soldOut` and a `soldOutSource`. They are shown in the table but never recommended.
- **Terms that change the answer** are encoded as flags, not prices: Cloudflare's free plan isn't for video or large
  downloads, Wasabi's egress is free only up to the amount stored, and the free plan has no edge inside mainland China.
  Re-read those terms when you check the prices.
- **Currency**: EUR prices are stored in EUR (`currency`) and converted at `data/rates.json`.

## Exchange rates

`data/rates.json` holds fixed ECB euro reference rates (USD→CNY is derived from them), with the rate `date`. They are
updated by hand. Fixed rates keep the same inputs giving the same answer, so prerendered pages, shared links and the
snapshot test stay consistent.

## The data is open

The build copies `data/*.json` to `/data/*.json` with CORS open, so anyone can reuse it. Keep the `about` field at the top
of each file accurate when you change its shape.
