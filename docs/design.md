# Design notes

Why the planner works the way it does. Code comments explain individual lines; this file collects the assumptions and the
reasons behind them that you need before changing the engine or the pages.

## The engine (`src/calc.mjs`)

- **One month, in USD, before VAT.** 1 GB = 2^30 bytes, 1 TB = 1024 GB, and a month is 730 hours (hourly prices × 730).
  Lightsail is the exception: AWS publishes its hourly rate as the monthly price ÷ 744, so `scripts/prices.mjs` multiplies
  by 744 to get the monthly price back. Prices in EUR are converted at fixed ECB reference rates (`data/rates.json`). Live
  rates would make the same inputs give different answers from day to day, and the page's numbers would stop matching
  the prerendered HTML.
- **Every combination is priced**: server plan × object storage × CDN, each optional as long as the job still gets done
  (dynamic traffic needs a server; a CDN needs an origin). The table and the picks are both views of one sorted list.
- **CDN cache hit rate 80%** (`ORIGIN = 0.2`). A CDN still fetches what it hasn't cached from its origin, and that
  traffic is billed by the origin's own rules. The exception is pairs where the origin sends to the CDN for free:
  S3 → CloudFront, anything on AWS → CloudFront, and B2 → Cloudflare or Bunny. 80% is a deliberately ordinary figure;
  the real rate for static sites is often higher, so the planner errs on the expensive side.
- **A server carries about 1 Gbit/s month-round** (`SERVER_MBPS`), or the plan's own port speed when it names one. More
  traffic than that adds servers (the result is flagged "scaled"), each holding a copy of the files it serves, instead
  of pretending one VPS can push a petabyte.
- **Cloud egress is pooled per account.** Several servers on the same cloud share one set of tiers and one free
  allowance, as on the real bill.
- **Always-free offers** count only when the "free tiers" option is ticked (it is off by default). There is one per
  account, and it may already be in use.
- **Tiers with a finite last limit** mean "contact sales" above it. The last published price is used, and the result is
  flagged.

## The picks

All picks are near the visitors (`nearOf`: visitors in mainland China count as Asia-Pacific) unless stated otherwise:

- **Cheapest.** If a setup with fewer vendors costs about the same (within $1 or 5%), that one wins: one bill is worth
  more than a few cents.
- **Fewest vendors**, as long as it costs at most 1.5× the cheapest or $10 more. Fewer vendors is worth a little more,
  not ten times more.
- **Hong Kong**, for visitors in mainland China only: the cheapest server there, since it is the closest place outside
  the mainland's licensing rules. Routes into China vary too much to rank on price alone, so the page measures latency
  from the visitor's own browser.
- **Another continent**, only when it is at least 15% cheaper. The visitor chose a region, so the headline respects it.
- **The AWS reference** ("n times cheaper than AWS"): the cheapest setup built only from AWS's own cloud (EC2, with S3 and
  CloudFront where they help), near the visitors.

Some setups are listed but never recommended (`BLOCKING`): above the published tiers (contact sales), against the
provider's terms (video or large files on Cloudflare's free plan; Wasabi egress beyond the amount stored, its fair-use
rule), or sold out. Showing them is honest; recommending them would not be.

## Pages and links

- **Every page is prerendered with its default result**, so the numbers are in the HTML: search engines and people with
  JavaScript off see real prices, and the browser redraws only when the inputs change.
- **The Worker runs only for what no file answers.** Static assets are free and unmetered on Cloudflare. Shared results
  (`/r/<code>`) go through the Worker so that a chat app's link preview shows the recommendation in its title. A code that
  doesn't parse is a 404, never the bare page passed off as a result.
- **Result codes are versioned** (the first field). A link that was shared once has to keep opening with the same
  meaning, so a format change means a new version number, and the old decoders stay.
- **No prices on the og images.** The build doesn't redraw images, so a price on a card would go stale the day the data
  changes.
- **Units follow the language**: Go/To/Po in French, ГБ/ТБ/ПБ in Russian (`formats` in `src/view.mjs`).

## Measured in the browser

- **Latency to each data center** uses the endpoints and method of the companion latency tool (when its address is
  injected): one warm-up request, then the median of three on the reused connection. Data centers are measured one at a
  time, the picks first. Parallel requests slow each other down and make every number worse, and a cold first request
  mostly measures DNS and the TLS handshake. A server-side measurement from one fixed location would say nothing about the
  visitor's own network, so it isn't done.

## Share card

The share image is 1200 px wide, and its height follows the content. Text is never cut off with "…". Each block tries
sizes from largest to smallest and keeps the largest that fits in its line budget; CJK text breaks between characters.
Before changing it, check the longest real results in de, ru and fr (`window.__msShareClips` logs anything the share
widget had to clip, and it should stay empty).
