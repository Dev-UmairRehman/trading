# Product Price Comparison (Batch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An n8n form workflow where a user uploads a products CSV/Excel + an email, and receives an emailed Excel with Google Shopping prices (google price + up to 3 competitor site/price) per product, processed in batches.

**Architecture:** Pure parsing logic in `lib/priceParse.js` (unit-tested), embedded into n8n Code nodes by a `build-price-comparison.js` generator (matches the repo's existing `build-*.js` pattern). Prices come from Apify actor `automation-lab~google-shopping-scraper` (one run per batch of 20 product names). The workflow runs on the n8n **server** (form-triggered), so Wait nodes work.

**Tech Stack:** Node.js (CommonJS), `node:test`, n8n workflow JSON, Apify (`automation-lab~google-shopping-scraper`), Gmail OAuth node.

## Global Constraints

- Plain JavaScript, CommonJS (`module.exports`). NOT TypeScript.
- Tests: `node:test` + `node:assert`; run with `node --test`.
- Secrets via `$env` only — never hardcode. Apify token = `{{ $env.APIFY_API_TOKEN }}` (already in `.env`).
- Apify actor: `automation-lab~google-shopping-scraper`, endpoint `POST https://api.apify.com/v2/acts/automation-lab~google-shopping-scraper/run-sync-get-dataset-items?token={{ $env.APIFY_API_TOKEN }}`, input `{ "queries": [<names>] }`.
- Verified Apify output item fields: `query`, `merchant`, `priceNumeric`, `price`, `currency`, `position`, `title`, `rating`, `reviewCount`.
- Gmail OAuth credential id `RE5KvrcKm8U95iWU` (name "Gmail account").
- Batch size 20; Wait ~3s between batches.
- Generators write pretty JSON to `workflows/<name>.json` and print `wrote <path> - <n> nodes`.

---

## Task 1: Pricing parse library

**Files:**
- Create: `lib/priceParse.js`
- Test: `test/priceParse.test.js`

**Interfaces:**
- Produces: `parseMoney(v)→number|null`, `pickProductName(row)→string`, `groupByQuery(items)→{[query]:item[]}`, `parseShoppingOffers(items)→{googlePrice,lowestPrice,offers:[{site,price,priceStr,currency,position}],count}`, `formatPricesSummary(offers)→string`, `buildRow(originalRow,productName,parsed)→object`.

- [ ] **Step 1: Write the failing test**

```js
// test/priceParse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseMoney, pickProductName, groupByQuery, parseShoppingOffers, formatPricesSummary, buildRow } = require('../lib/priceParse');

test('parseMoney handles numbers, currency strings, commas', () => {
  assert.equal(parseMoney(395.49), 395.49);
  assert.equal(parseMoney('$395.49'), 395.49);
  assert.equal(parseMoney('1,299'), 1299);
  assert.equal(parseMoney('£49.00'), 49);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(null), null);
});
test('pickProductName prefers a product/name column, else first', () => {
  assert.equal(pickProductName({ 'Product Name': 'Widget', sku: 'X' }), 'Widget');
  assert.equal(pickProductName({ foo: 'First', bar: 'Second' }), 'First');
  assert.equal(pickProductName({}), '');
});
test('groupByQuery groups offers by query', () => {
  const g = groupByQuery([{ query: 'A', merchant: 'X' }, { query: 'A', merchant: 'Y' }, { query: 'B', merchant: 'Z' }]);
  assert.equal(g['A'].length, 2);
  assert.equal(g['B'].length, 1);
});
test('parseShoppingOffers sorts by position, dedupes by site, computes prices', () => {
  const items = [
    { merchant: 'Best Buy', priceNumeric: 395.49, price: '$395.49', currency: 'USD', position: 1 },
    { merchant: 'Junk', priceNumeric: 10, price: '$10.00', currency: 'USD', position: 5 },
    { merchant: 'Best Buy', priceNumeric: 399, price: '$399', currency: 'USD', position: 8 },
    { merchant: '', priceNumeric: 50, price: '$50', position: 2 },
  ];
  const r = parseShoppingOffers(items);
  assert.equal(r.count, 2);                 // Best Buy (deduped) + Junk; blank-site dropped
  assert.equal(r.offers[0].site, 'Best Buy'); // best position first
  assert.equal(r.googlePrice, 395.49);      // top-position offer price
  assert.equal(r.lowestPrice, 10);          // min across offers
});
test('parseShoppingOffers empty => zeros', () => {
  const r = parseShoppingOffers([]);
  assert.equal(r.count, 0);
  assert.equal(r.googlePrice, null);
});
test('formatPricesSummary joins site: price', () => {
  assert.equal(formatPricesSummary([{ site: 'Best Buy', priceStr: '$395.49' }, { site: 'Target', priceStr: '$349' }]), 'Best Buy: $395.49 | Target: $349');
});
test('buildRow merges original + pricing columns', () => {
  const parsed = parseShoppingOffers([{ merchant: 'Best Buy', priceNumeric: 300, price: '$300', position: 1 }, { merchant: 'eBay', priceNumeric: 500, price: '$500', position: 2 }]);
  const row = buildRow({ 'Product Name': 'Widget' }, 'Widget', parsed);
  assert.equal(row.product_name, 'Widget');
  assert.equal(row.google_price, 300);
  assert.equal(row.competitor_1_site, 'Best Buy');
  assert.equal(row.competitor_1_price, 300);
  assert.equal(row.competitor_2_site, 'eBay');
  assert.equal(row.status, 'ok');
  assert.match(row.prices_summary, /Best Buy: \$300/);
});
test('buildRow with no offers => no results', () => {
  const row = buildRow({ name: 'X' }, 'X', parseShoppingOffers([]));
  assert.equal(row.status, 'no results');
  assert.equal(row.offers_found, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/priceParse.test.js`
Expected: FAIL — `Cannot find module '../lib/priceParse'`

- [ ] **Step 3: Write the implementation**

```js
// lib/priceParse.js — pure parsing/formatting for Apify Google Shopping offers. No network.
function parseMoney(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}
function pickProductName(row) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  const named = keys.find((k) => /product|name|item|title/i.test(k));
  const key = named || keys[0];
  return key ? String(row[key] == null ? '' : row[key]).trim() : '';
}
function groupByQuery(items) {
  const out = {};
  for (const it of (items || [])) {
    const q = String((it && it.query) || '').trim();
    if (!q) continue;
    (out[q] = out[q] || []).push(it);
  }
  return out;
}
function parseShoppingOffers(items) {
  const rows = (items || []).map((it) => ({
    site: String((it && it.merchant) || '').trim(),
    price: parseMoney(it && (it.priceNumeric != null ? it.priceNumeric : it.price)),
    priceStr: String((it && it.price) || '').trim(),
    currency: String((it && it.currency) || '').trim(),
    position: Number((it && it.position) || 9999),
  })).filter((o) => o.site && o.price != null);
  rows.sort((a, b) => a.position - b.position);
  const seen = new Set();
  const offers = [];
  for (const o of rows) {
    const k = o.site.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    offers.push(o);
  }
  const prices = offers.map((o) => o.price);
  return {
    googlePrice: offers.length ? offers[0].price : null,
    lowestPrice: prices.length ? Math.min.apply(null, prices) : null,
    offers,
    count: offers.length,
  };
}
function formatPricesSummary(offers) {
  return (offers || []).map((o) => o.site + ': ' + (o.priceStr || o.price)).join(' | ');
}
function buildRow(originalRow, productName, parsed) {
  const o = (parsed && parsed.offers) || [];
  const row = Object.assign({}, originalRow || {});
  row.product_name = productName || pickProductName(originalRow);
  row.google_price = parsed && parsed.googlePrice != null ? parsed.googlePrice : '';
  row.lowest_price = parsed && parsed.lowestPrice != null ? parsed.lowestPrice : '';
  for (let i = 0; i < 3; i++) {
    row['competitor_' + (i + 1) + '_site'] = o[i] ? o[i].site : '';
    row['competitor_' + (i + 1) + '_price'] = o[i] ? o[i].price : '';
  }
  row.prices_summary = formatPricesSummary(o);
  row.offers_found = parsed ? parsed.count : 0;
  row.status = (parsed && parsed.count > 0) ? 'ok' : 'no results';
  return row;
}
module.exports = { parseMoney, pickProductName, groupByQuery, parseShoppingOffers, formatPricesSummary, buildRow };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/priceParse.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/priceParse.js test/priceParse.test.js
git commit -m "feat(price): pure Google Shopping offer parsing lib"
```

---

## Task 2: Workflow generator + workflow JSON

**Files:**
- Create: `build-price-comparison.js`
- Create (generated): `workflows/price-comparison.json`

**Interfaces:**
- Consumes: `lib/priceParse.js` (embedded into Code nodes).
- Produces: `workflows/price-comparison.json` (n8n workflow).

**Node graph:**
`Form Upload → Detect Type (Switch: csv|xlsx) → Extract CSV / Extract XLSX → Normalize (add __productName) → Split In Batches(20) →[loop] Build Queries → Apify Shopping → Parse Batch (accumulate to staticData) → Wait 3s → (loop back) ; [done] Assemble Rows (from staticData) → To XLSX → Email File → Done screen`

- [ ] **Step 1: Write the generator**

```js
// build-price-comparison.js — generates the "Product Price Comparison" n8n workflow.
const fs = require('fs');
const path = require('path');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };
function libBody(name) {
  const src = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return src.replace(/^module\.exports\s*=.*$/m, '').trim();
}
const priceParse = libBody('priceParse.js');

const normalizeCode = `${priceParse}
return $input.all().map((it) => {
  const row = it.json || {};
  const name = pickProductName(row);
  return { json: Object.assign({}, row, { __productName: name }) };
}).filter((it) => it.json.__productName);`;

// runOnceForAllItems: aggregate a batch of rows into ONE Apify call payload.
const buildQueriesCode = `const items = $input.all();
const rows = items.map((i) => i.json);
const queries = rows.map((r) => r.__productName).filter(Boolean);
return [{ json: { queries, rows } }];`;

// Parse the Apify offers for this batch and accumulate finished rows into static data.
const parseBatchCode = `${priceParse}
const bq = $('Build Queries').item.json;
const rows = bq.rows || [];
const offers = $input.all().map((i) => i.json);
const grouped = groupByQuery(offers);
const sd = $getWorkflowStaticData('global');
sd.rows = sd.rows || [];
for (const r of rows) {
  const name = r.__productName;
  const parsed = parseShoppingOffers(grouped[name] || []);
  const clean = Object.assign({}, r); delete clean.__productName;
  sd.rows.push(buildRow(clean, name, parsed));
}
return [{ json: { accumulated: sd.rows.length } }];`;

// done branch: pull all accumulated rows out as items, then reset static data.
const assembleCode = `const sd = $getWorkflowStaticData('global');
const rows = sd.rows || [];
sd.rows = [];
if (!rows.length) return [{ json: { product_name: 'No products processed' } }];
return rows.map((r) => ({ json: r }));`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const UA = 'application/json';
const wf = {
  name: 'Product Price Comparison',
  nodes: [
    { parameters: { path: 'price-comparison', formTitle: 'Product Price Comparison',
      formDescription: 'Upload a CSV/Excel of product names and enter your email. You will receive the updated file with competitor prices.',
      formFields: { values: [
        { fieldLabel: 'File', fieldType: 'file', acceptFileTypes: '.csv,.xlsx,.xls', requiredField: true },
        { fieldLabel: 'Email', fieldType: 'email', requiredField: true },
      ] }, options: {} },
      id: id('pcform'), name: 'Form Upload', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 300], webhookId: id('pcwh') },
    { parameters: { rules: { values: [
      { conditions: { options: { caseSensitive: false, version: 2 }, combinator: 'and', conditions: [
        { leftValue: '={{ $binary.File.fileExtension }}', rightValue: 'csv', operator: { type: 'string', operation: 'equals' } },
      ] }, outputKey: 'csv' },
    ] }, options: { fallbackOutput: 'extra' }, },
      id: id('pcsw'), name: 'Detect Type', type: 'n8n-nodes-base.switch', typeVersion: 3, position: [220, 300] },
    { parameters: { operation: 'csv', binaryPropertyName: 'File', options: {} },
      id: id('pccsv'), name: 'Extract CSV', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [440, 200] },
    { parameters: { operation: 'xlsx', binaryPropertyName: 'File', options: {} },
      id: id('pcxlsx'), name: 'Extract XLSX', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [440, 400] },
    { parameters: { jsCode: normalizeCode }, id: id('pcnorm'), name: 'Normalize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300] },
    { parameters: { batchSize: 20, options: {} }, id: id('pcbatch'), name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [880, 300] },
    { parameters: { jsCode: buildQueriesCode }, id: id('pcbq'), name: 'Build Queries', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 200] },
    { parameters: { method: 'POST', url: 'https://api.apify.com/v2/acts/automation-lab~google-shopping-scraper/run-sync-get-dataset-items',
      sendQuery: true, queryParameters: { parameters: [{ name: 'token', value: '={{ $env.APIFY_API_TOKEN }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ queries: $json.queries }) }}',
      options: { timeout: 290000 } },
      id: id('pcapify'), name: 'Apify Shopping', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1320, 200], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { jsCode: parseBatchCode }, id: id('pcparse'), name: 'Parse Batch', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 200] },
    { parameters: { amount: 3, unit: 'seconds' }, id: id('pcwait'), name: 'Wait', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1760, 200] },
    { parameters: { jsCode: assembleCode }, id: id('pcasm'), name: 'Assemble Rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 460] },
    { parameters: { operation: 'xlsx', binaryPropertyName: 'data', options: { fileName: 'price-comparison.xlsx', sheetName: 'Prices' } },
      id: id('pctofile'), name: 'To XLSX', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1, position: [1320, 460] },
    { parameters: { sendTo: '={{ $(\'Form Upload\').item.json.Email }}', subject: 'Your product price comparison is ready',
      emailType: 'text', message: 'Attached is your product list with Google Shopping prices (google price + competitor sites/prices).\\n\\nRehman', options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } } },
      id: id('pcmail'), name: 'Email File', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1540, 460], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
  ],
  connections: {
    'Form Upload': { main: [[{ node: 'Detect Type', type: 'main', index: 0 }]] },
    'Detect Type': { main: [[{ node: 'Extract CSV', type: 'main', index: 0 }], [{ node: 'Extract XLSX', type: 'main', index: 0 }]] },
    'Extract CSV': { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
    'Extract XLSX': { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
    'Normalize': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
    'Split In Batches': { main: [[{ node: 'Assemble Rows', type: 'main', index: 0 }], [{ node: 'Build Queries', type: 'main', index: 0 }]] },
    'Build Queries': { main: [[{ node: 'Apify Shopping', type: 'main', index: 0 }]] },
    'Apify Shopping': { main: [[{ node: 'Parse Batch', type: 'main', index: 0 }]] },
    'Parse Batch': { main: [[{ node: 'Wait', type: 'main', index: 0 }]] },
    'Wait': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
    'Assemble Rows': { main: [[{ node: 'To XLSX', type: 'main', index: 0 }]] },
    'To XLSX': { main: [[{ node: 'Email File', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/price-comparison.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
```

NOTE on Split In Batches wiring: n8n `splitInBatches` v3 output 0 = **done**, output 1 = **loop**. The connections above send output 0 → Assemble Rows (done) and output 1 → Build Queries (loop), which is correct.

- [ ] **Step 2: Build and validate JSON**

Run: `node build-price-comparison.js workflows/price-comparison.json`
Expected: `wrote workflows/price-comparison.json - 13 nodes`

- [ ] **Step 3: Validate structure**

Run:
```
node -e "const w=JSON.parse(require('fs').readFileSync('workflows/price-comparison.json','utf8'));const n=w.nodes.map(x=>x.name);console.log('nodes',w.nodes.length);console.log('hasApify', /automation-lab~google-shopping-scraper/.test(JSON.stringify(w)));console.log('loop', JSON.stringify(w.connections['Split In Batches'].main.map(b=>b.map(c=>c.node))));"
```
Expected: `nodes 13`, `hasApify true`, loop shows `[["Assemble Rows"],["Build Queries"]]`.

- [ ] **Step 4: Commit**

```bash
git add build-price-comparison.js workflows/price-comparison.json
git commit -m "feat(price): batch price-comparison workflow generator"
```

---

## Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests PASS including the 8 new `priceParse` tests.

- [ ] **Step 2: Confirm JSON validity of all workflows**

Run: `node -e "['price-comparison','m1-lead-analysis'].forEach(n=>{JSON.parse(require('fs').readFileSync('workflows/'+n+'.json','utf8'));console.log('ok',n)})"`
Expected: `ok price-comparison`, `ok m1-lead-analysis`.

- [ ] **Step 3: Commit any regenerated JSON**

```bash
git add workflows/price-comparison.json
git commit -m "chore(price): regenerate workflow JSON" || echo "nothing to commit"
```

---

## Deployment notes (manual, after implementation)

1. `APIFY_API_TOKEN` is already in `.env` (verified working, user `grey_jet`).
2. Import into n8n: stamp an id and `n8n import:workflow --input=...` (server must be stopped for CLI import, or import via the n8n UI). Then **activate** it (form-trigger workflows must be active to serve the form URL).
3. Open the form at `http://localhost:5678/form/price-comparison`, upload a small test file (3–5 product names) + your email, and confirm the emailed `.xlsx` has google_price + competitor columns.
4. **Verify at deploy:** the form file-field binary property name (assumed `File`) and the `$binary.File.fileExtension` used by Detect Type — adjust if the uploaded binary lands under a different property. Test with both a `.csv` and a `.xlsx`.
5. **Cost:** Apify FREE plan — 1000 products (~50 runs) may exceed free compute; top up or split across days.

## Self-review notes

- **Spec coverage:** upload+email form (Task 2 Form Upload), Apify Google Shopping source (Task 2 Apify node, verified actor), google_price + 3 competitor site/price + summary + status (Task 1 buildRow), batches of 20 + Wait + error-continue (Task 2), email delivery with attachment (Task 2 Email File), CSV+XLSX (Detect Type + two Extract nodes). Covered.
- **Placeholder scan:** all code complete; no TBD/TODO. The two deploy-time verifications (binary property name, cost) are operational checks, not code placeholders.
- **Type consistency:** `parseShoppingOffers` return shape (`googlePrice`/`lowestPrice`/`offers`/`count`) is used identically in `buildRow` and `parseBatchCode`; `__productName` set in `normalizeCode`, read in `buildQueriesCode`/`parseBatchCode`; `sd.rows` written in `parseBatchCode`, read+reset in `assembleCode`. Consistent.
