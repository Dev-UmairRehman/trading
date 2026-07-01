# Product Price Comparison (Batch) — Design Spec

**Date:** 2026-06-21
**Project:** n8n automation suite (Desktop\N8N, repo: trading.git)

## Goal

A user uploads a CSV/Excel of products (product names) and an email address. The
workflow searches Google Shopping for each product via Apify, captures the Google
price plus 2–3 competitor site+price offers, builds an updated spreadsheet, and
emails the finished file to the address provided. Large lists (~1000 products) are
processed in batches.

## Non-goals (YAGNI)

- No live synchronous download (1000 products take too long); delivery is by email.
- No Bright Data (explicitly excluded by the user).
- No historical price tracking / dashboards — one file in, one file out.
- No per-product AI extraction — structured Apify offers only.

## Price source

**Apify actor `automation-lab~google-shopping-scraper`** (verified against the live
token), called via `POST /v2/acts/automation-lab~google-shopping-scraper/run-sync-get-dataset-items`
with `token = {{ $env.APIFY_API_TOKEN }}`. Input: `{ "queries": [<product names>] }`
(accepts an ARRAY → **one Apify run per batch** of 20 products). Output dataset items
(verified) have: `query` (which product — group key), `merchant` (retailer/site),
`priceNumeric` (number), `price` (display string e.g. "$395.49"), `currency`,
`position` (Google relevance rank), `title`, `rating`, `reviewCount`.

Dependency: `APIFY_API_TOKEN` must be present in `.env` (user adds it; copied from the
existing Google-Maps scraper workflow). The security policy prevents the agent from
scavenging it from other workflows.

**Why not query Google directly:** Google has no official API returning competitor
shopping prices. The Custom Search JSON API (`GOOGLE_API_KEY`) returns only web
results (titles/snippets/links), not structured prices; the Shopping Content API is
for a merchant's own products. Getting "Site A = 300, Site B = 500" therefore requires
scraping Google Shopping, which Apify does. (Optional future fallback: Custom Search +
AI price extraction from snippets for products Apify returns nothing for — excluded
from v1.)

## Trigger & input

- **n8n Form Trigger** with two fields:
  - `File` — file upload, accepts `.csv` / `.xlsx` (binary).
  - `Email` — required text field; where the finished file is sent.
- **Extract From File** node reads the uploaded spreadsheet into rows.
- A **Code node** normalizes the product-name column: use the column whose header
  matches `/product|name|item|title/i` (case-insensitive); if none matches, use the
  first column. Emits `{ productName }` per row, preserving the original row for output.

## Processing (batched)

- **Split In Batches**, batch size **20**.
- Per batch: build the Apify input `{ queries: [<20 product names>], resultsPerQuery: 5, country: 'us'/'nl' }`
  (exact param names per chosen actor), call the Apify run-sync endpoint.
- **Wait** node ~3s between batches (rate-limit safety). Runs on the n8n **server**
  (form-triggered), so Wait nodes resume normally — unlike CLI execution.
- Apify HTTP node uses `onError: continueRegularOutput`, `retryOnFail`, so a failed
  batch doesn't kill the run.

## Parsing (pure, testable) — `lib/priceParse.js`

- `parseShoppingOffers(items)` → from Apify dataset items for one product, return
  `{ googlePrice, offers: [{ site, price, link }], count }`. `googlePrice` = the top
  (first / most representative) offer price. Offers sorted by price ascending.
- `formatPricesSummary(offers)` → `"Amazon: 300 | eBay: 500 | Walmart: 450"`.
- `buildRow(originalRow, parsed)` → merges the original row with the new columns.
- Money parsing: strip currency symbols/commas → number; keep a display string too.

## Output columns (added per product row)

`product_name`, `google_price`, `competitor_1_site`, `competitor_1_price`,
`competitor_2_site`, `competitor_2_price`, `competitor_3_site`, `competitor_3_price`,
`prices_summary`, `offers_found`, `status` (`ok` / `no results` / `error`).

Original input columns are preserved to the left.

## Assemble & deliver

- Collect all processed rows (across batches).
- **Convert To File** → `.xlsx` (filename `price-comparison-<uploadname>.xlsx`).
- **Gmail** node (OAuth credential `RE5KvrcKm8U95iWU`) sends to the form's `Email`
  with the `.xlsx` attached. Subject: "Your product price comparison is ready".
- Also write a copy to an `output/` folder as a backup (best-effort; email is primary).
- Form completion screen: "Thanks — your file is being processed and will be emailed
  to <email> shortly." (Not a live download.)

## Components & boundaries

- **lib/priceParse.js** (new, pure, unit-tested) — all parsing/formatting logic.
- **build-price-comparison.js** (new) — generator that embeds `priceParse` into Code
  nodes and writes `workflows/price-comparison.json`, following the existing
  `build-*.js` pattern.
- **test/priceParse.test.js** (new) — `node:test` cases for parse/format/edge cases.

## Error handling

- Missing/empty product name → row `status = no results`, skipped from Apify query.
- Apify batch error → each product in that batch marked `status = error`; run continues.
- No offers for a product → `status = no results`, price columns blank.
- Empty upload or unreadable file → form shows a clear error; no email sent.

## Testing

- Unit tests for `priceParse.js`: multi-offer parse, price sorting, currency/comma
  stripping, empty/no-offers, summary formatting, column building.
- Build validation: `node build-price-comparison.js` generates valid workflow JSON
  (node/connection counts) — consistent with existing build scripts.

## Cost note

Token is on Apify's **FREE** plan. Each run consumes compute units; ~50 runs for 1000
products may exceed the free monthly allowance — a small paid top-up (or splitting the
file across days) may be needed. Flagged to the operator, not blocking.

## Ordering & fields (resolved)

Offers per product are ordered by `position` (Google relevance). `google_price` = the
top-position offer's `priceNumeric`. `lowest_price` = min `priceNumeric` across offers.
Competitor columns take the first 3 distinct `merchant`s by position.
