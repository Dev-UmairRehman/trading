# Milestone 1 — Lead → Analysis → Score → CRM Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an autonomous n8n workflow that discovers local businesses via Google Places, analyzes each website (PageSpeed + AI), computes the operator's 100-point lead score + Cold/Warm/Hot classification, enriches contact info, and upserts everything into Airtable — with no outreach.

**Architecture:** All non-trivial logic lives in plain, unit-tested CommonJS modules under `lib/`. A builder script (`build-m1-workflow.js`) embeds those module sources into n8n Code nodes and emits `workflows/m1-lead-analysis.json`. The workflow is pushed to n8n via its REST API and executed for verification. Airtable is the CRM; its tables are created by a setup script. This mirrors the existing `build-workflow.js` pattern in this repo.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert` (zero-dependency testing), n8n (`n8n-nodes-base` nodes, REST API at `http://localhost:5678/api/v1`), Google Places API (New) + PageSpeed Insights, Groq (AI), Apollo (enrichment), Airtable (CRM).

**Spec:** `docs/superpowers/specs/2026-06-12-lead-analysis-crm-pipeline-design.md`

---

## File Structure

```
N8N/
  package.json                         # Create: type=commonjs, test script
  lib/
    htmlSignals.js                     # Create: parse raw HTML → SEO/mobile/social/form/age signals
    placesParser.js                    # Create: Places API place → normalized lead fields
    scoring.js                         # Create: signals → website/automation/lead score + class (THE formula)
    aiReview.js                        # Create: build Groq prompt + parse Groq JSON reply
  test/
    htmlSignals.test.js                # Create
    placesParser.test.js               # Create
    scoring.test.js                    # Create
    aiReview.test.js                   # Create
  scripts/
    create-airtable-tables.js          # Create: idempotently create Leads + Errors tables
    push-workflow.js                   # Create: push a built workflow JSON to n8n
    run-workflow.js                    # Create: trigger a manual execution + print result
  build-m1-workflow.js                 # Create: assemble + embed lib → workflows/m1-lead-analysis.json
  workflows/m1-lead-analysis.json      # Generated artifact (committed)
  workflows/m1-error-handler.json      # Generated artifact (committed)
```

**Boundary rationale:** `htmlSignals`, `placesParser`, `scoring`, `aiReview` are each pure (no I/O) so they unit-test in isolation. All network calls (Places, PageSpeed, Groq, Apollo, Airtable) stay in n8n nodes — never duplicated in JS — so there is exactly one place each integration is configured.

---

## Conventions

- Run all commands from `c:/Users/Zahid Micro Tech/Desktop/N8N`.
- Node test runner: `node --test` (Node 18+, already used by `build-workflow.js`).
- Commit after every green step. Commit messages use `feat:`/`test:`/`chore:` prefixes and end with the repo's co-author trailer.
- `.env` is gitignored and already holds: `GOOGLE_API_KEY`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID=appq4ty5pPOftbXbN`, `APOLLO_API_KEY`, `GROQ_API_KEY`, `N8N_API_KEY`, `N8N_GROQ_CREDENTIAL_ID`.

---

## Task 0: Project scaffolding

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "leadgen-n8n",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test",
    "build:m1": "node build-m1-workflow.js workflows/m1-lead-analysis.json",
    "airtable:setup": "node scripts/create-airtable-tables.js",
    "push:m1": "node scripts/push-workflow.js workflows/m1-lead-analysis.json"
  }
}
```

- [ ] **Step 2: Verify Node runs the test runner**

Run: `node --test` (from repo root)
Expected: exits 0 with "tests 0 / pass 0" (no test files yet) — confirms the runner works.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: scaffold package.json for M1 lead pipeline

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Airtable schema (Leads + Errors tables)

**Files:**
- Create: `scripts/create-airtable-tables.js`

This is integration setup (talks to Airtable), not unit-tested. It is idempotent: if a table with the name exists, it is skipped.

- [ ] **Step 1: Write the table-creation script**

```js
// scripts/create-airtable-tables.js
// Idempotently create the Leads and Errors tables in the configured Airtable base.
const fs = require('fs');
const path = require('path');

function readEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv();
const BASE = env.AIRTABLE_BASE_ID;
const PAT = env.AIRTABLE_PAT;
const API = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;

const LEADS_FIELDS = [
  { name: 'business_name', type: 'singleLineText' },
  { name: 'place_id', type: 'singleLineText' },
  { name: 'owner_name', type: 'singleLineText' },
  { name: 'email', type: 'email' },
  { name: 'phone', type: 'singleLineText' },
  { name: 'website', type: 'url' },
  { name: 'category', type: 'singleLineText' },
  { name: 'location', type: 'singleLineText' },
  { name: 'lead_source', type: 'singleSelect', options: { choices: [{ name: 'google_places' }] } },
  { name: 'has_website', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  { name: 'review_count', type: 'number', options: { precision: 0 } },
  { name: 'website_score', type: 'number', options: { precision: 0 } },
  { name: 'automation_score', type: 'number', options: { precision: 0 } },
  { name: 'lead_score', type: 'number', options: { precision: 0 } },
  { name: 'classification', type: 'singleSelect', options: { choices: [{ name: 'Cold' }, { name: 'Warm' }, { name: 'Hot' }] } },
  { name: 'pagespeed_mobile', type: 'number', options: { precision: 0 } },
  { name: 'ai_findings', type: 'multilineText' },
  { name: 'ai_rationale', type: 'multilineText' },
  { name: 'has_email', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  { name: 'has_phone', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  { name: 'has_social', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
  { name: 'status', type: 'singleSelect', options: { choices: [{ name: 'New' }, { name: 'Contacted' }, { name: 'Replied' }, { name: 'Qualified' }, { name: 'Closed' }] } },
];

const ERRORS_FIELDS = [
  { name: 'workflow', type: 'singleLineText' },
  { name: 'node', type: 'singleLineText' },
  { name: 'message', type: 'multilineText' },
  { name: 'payload', type: 'multilineText' },
  { name: 'at', type: 'singleLineText' },
];

async function listTables() {
  const r = await fetch(API, { headers: { Authorization: `Bearer ${PAT}` } });
  if (!r.ok) throw new Error(`list tables failed: ${r.status} ${await r.text()}`);
  return (await r.json()).tables;
}

async function createTable(name, fields, description) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, fields }),
  });
  if (!r.ok) throw new Error(`create ${name} failed: ${r.status} ${await r.text()}`);
  console.log(`created table: ${name}`);
}

(async () => {
  const existing = (await listTables()).map((t) => t.name);
  if (!existing.includes('Leads')) await createTable('Leads', LEADS_FIELDS, 'Scored leads');
  else console.log('Leads already exists — skipped');
  if (!existing.includes('Errors')) await createTable('Errors', ERRORS_FIELDS, 'Pipeline errors');
  else console.log('Errors already exists — skipped');
  console.log('done');
})().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `node scripts/create-airtable-tables.js`
Expected: prints `created table: Leads`, `created table: Errors`, `done`.

- [ ] **Step 3: Verify idempotency**

Run again: `node scripts/create-airtable-tables.js`
Expected: prints `Leads already exists — skipped`, `Errors already exists — skipped`, `done`. (Confirms re-runs are safe.)

- [ ] **Step 4: Commit**

```bash
git add scripts/create-airtable-tables.js
git commit -m "feat: idempotent Airtable schema setup for Leads + Errors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/htmlSignals.js` (TDD)

**Files:**
- Create: `lib/htmlSignals.js`
- Test: `test/htmlSignals.test.js`

Pure function: given raw HTML + the final URL, return measurable signals used by scoring.

- [ ] **Step 1: Write the failing test**

```js
// test/htmlSignals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractHtmlSignals } = require('../lib/htmlSignals');

test('detects modern, well-built page', () => {
  const html = `<!doctype html><html><head>
    <title>Acme Dental</title>
    <meta name="description" content="Best dentist">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    </head><body><h1>Welcome</h1>
    <form action="/contact"><input name="email"></form>
    <a href="https://facebook.com/acme">fb</a>
    <footer>© 2026 Acme</footer></body></html>`;
  const s = extractHtmlSignals(html, 'https://acme.com');
  assert.equal(s.hasTitle, true);
  assert.equal(s.hasMetaDescription, true);
  assert.equal(s.hasViewport, true);
  assert.equal(s.hasH1, true);
  assert.equal(s.hasContactForm, true);
  assert.equal(s.hasSSL, true);
  assert.deepEqual(s.socialLinks, ['https://facebook.com/acme']);
  assert.equal(s.copyrightYear, 2026);
  assert.deepEqual(s.emails, []);
});

test('extracts mailto and inline emails', () => {
  const html = `<a href="mailto:info@acme.com">mail</a> contact us at hello@acme.com`;
  const s = extractHtmlSignals(html, 'https://acme.com');
  assert.deepEqual(s.emails, ['info@acme.com', 'hello@acme.com']);
});

test('detects bare/outdated page over http', () => {
  const html = `<html><head></head><body><table><tr><td>old</td></tr></table>
    <p>Copyright 2009</p></body></html>`;
  const s = extractHtmlSignals(html, 'http://old.com');
  assert.equal(s.hasTitle, false);
  assert.equal(s.hasMetaDescription, false);
  assert.equal(s.hasViewport, false);
  assert.equal(s.hasH1, false);
  assert.equal(s.hasContactForm, false);
  assert.equal(s.hasSSL, false);
  assert.deepEqual(s.socialLinks, []);
  assert.equal(s.copyrightYear, 2009);
});

test('handles empty/garbage input safely', () => {
  const s = extractHtmlSignals('', 'https://x.com');
  assert.equal(s.hasTitle, false);
  assert.equal(s.copyrightYear, null);
  assert.deepEqual(s.socialLinks, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/htmlSignals.test.js`
Expected: FAIL — `Cannot find module '../lib/htmlSignals'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/htmlSignals.js
// Pure HTML signal extraction. No network, no DOM — regex over a string.
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'youtube.com'];

function extractHtmlSignals(html, finalUrl) {
  const h = String(html || '');
  const lower = h.toLowerCase();

  const hasTitle = /<title[^>]*>\s*\S/i.test(h);
  const hasMetaDescription = /<meta[^>]+name=["']description["'][^>]*>/i.test(h);
  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(h);
  const hasH1 = /<h1[\s>]/i.test(h);
  const hasContactForm = /<form[\s>]/i.test(h);
  const hasSSL = String(finalUrl || '').toLowerCase().startsWith('https://');

  const socialLinks = [];
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(h)) !== null) {
    const url = m[1];
    if (SOCIAL_HOSTS.some((host) => url.toLowerCase().includes(host)) && !socialLinks.includes(url)) {
      socialLinks.push(url);
    }
  }

  let copyrightYear = null;
  const yearRe = /(?:©|&copy;|copyright)\s*[^0-9]{0,8}((?:19|20)\d{2})/gi;
  while ((m = yearRe.exec(lower)) !== null) {
    const y = parseInt(m[1], 10);
    if (copyrightYear === null || y > copyrightYear) copyrightYear = y;
  }

  const emails = [];
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  while ((m = emailRe.exec(h)) !== null) {
    const e = m[0].toLowerCase();
    // skip asset filenames that look like emails are rare; skip obvious non-contact
    if (!e.endsWith('.png') && !e.endsWith('.jpg') && !emails.includes(e)) emails.push(e);
  }

  return { hasTitle, hasMetaDescription, hasViewport, hasH1, hasContactForm, hasSSL, socialLinks, copyrightYear, emails };
}

module.exports = { extractHtmlSignals };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/htmlSignals.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/htmlSignals.js test/htmlSignals.test.js
git commit -m "feat: HTML signal extraction with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `lib/placesParser.js` (TDD)

**Files:**
- Create: `lib/placesParser.js`
- Test: `test/placesParser.test.js`

Normalizes one Google Places API (New) place object, and provides a batch helper that flags brands appearing ≥2 times (the "multiple locations" signal).

- [ ] **Step 1: Write the failing test**

```js
// test/placesParser.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePlace, flagMultipleLocations } = require('../lib/placesParser');

const PLACE = {
  id: 'ChIJ123',
  displayName: { text: 'Deansgate Dental Studio' },
  websiteUri: 'http://deansgatedentalstudio.co.uk/',
  nationalPhoneNumber: '0161 912 6200',
  userRatingCount: 976,
  rating: 4.8,
  formattedAddress: '1 Deansgate, Manchester',
  types: ['dentist', 'health'],
};

test('parsePlace normalizes fields', () => {
  const p = parsePlace(PLACE);
  assert.equal(p.business_name, 'Deansgate Dental Studio');
  assert.equal(p.place_id, 'ChIJ123');
  assert.equal(p.website, 'http://deansgatedentalstudio.co.uk/');
  assert.equal(p.phone, '0161 912 6200');
  assert.equal(p.review_count, 976);
  assert.equal(p.category, 'dentist');
  assert.equal(p.location, '1 Deansgate, Manchester');
  assert.equal(p.has_website, true);
});

test('parsePlace handles missing website/phone', () => {
  const p = parsePlace({ id: 'x', displayName: { text: 'No Site Cafe' }, types: ['cafe'] });
  assert.equal(p.has_website, false);
  assert.equal(p.website, '');
  assert.equal(p.phone, '');
  assert.equal(p.review_count, 0);
});

test('flagMultipleLocations marks repeated brand names', () => {
  const set = flagMultipleLocations([
    { displayName: { text: 'Joe Pizza' } },
    { displayName: { text: 'Joe Pizza' } },
    { displayName: { text: 'Solo Cafe' } },
  ]);
  assert.equal(set.has('joe pizza'), true);
  assert.equal(set.has('solo cafe'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/placesParser.test.js`
Expected: FAIL — `Cannot find module '../lib/placesParser'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/placesParser.js
// Pure normalization of Google Places API (New) responses.
function parsePlace(place) {
  const p = place || {};
  const website = p.websiteUri || '';
  return {
    business_name: (p.displayName && p.displayName.text) || '',
    place_id: p.id || '',
    website,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    review_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    rating: typeof p.rating === 'number' ? p.rating : null,
    category: Array.isArray(p.types) && p.types.length ? p.types[0] : '',
    location: p.formattedAddress || '',
    has_website: Boolean(website),
  };
}

function flagMultipleLocations(places) {
  const counts = new Map();
  for (const p of places || []) {
    const name = ((p.displayName && p.displayName.text) || '').trim().toLowerCase();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const repeated = new Set();
  for (const [name, n] of counts) if (n >= 2) repeated.add(name);
  return repeated;
}

module.exports = { parsePlace, flagMultipleLocations };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/placesParser.test.js`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/placesParser.js test/placesParser.test.js
git commit -m "feat: Places API parser + multi-location flag with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/scoring.js` (TDD) — the core 100-point formula

**Files:**
- Create: `lib/scoring.js`
- Test: `test/scoring.test.js`

Implements the spec's exact factor weights. Inputs are already-extracted signals (no I/O). `currentYear` is injected so tests are deterministic.

Factor weights (sum to 100): no website +25, outdated +20, poor SEO +15, poor mobile +15, large business +10, active social +5, multiple locations +10.

- [ ] **Step 1: Write the failing test**

```js
// test/scoring.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeScores } = require('../lib/scoring');

const YEAR = 2026;

test('no-website business scores Hot with full opportunity', () => {
  const r = computeScores({
    hasWebsite: false, html: null, pagespeed: null,
    reviewCount: 120, hasSocial: false, multipleLocations: true, aiOutdated: false,
  }, YEAR);
  // +25 no website, +15 SEO (no site), +15 mobile (no site), +10 large, +10 multi = 75
  assert.equal(r.lead_score, 75);
  assert.equal(r.classification, 'Hot');
  assert.equal(r.website_score, 0);
  assert.ok(r.automation_score >= 70);
});

test('modern site scores Cold', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: true, hasH1: true, hasViewport: true, hasContactForm: true, hasSSL: true, socialLinks: ['x'], copyrightYear: YEAR },
    pagespeed: { mobilePerf: 92, seo: 95 },
    reviewCount: 10, hasSocial: true, multipleLocations: false, aiOutdated: false,
  }, YEAR);
  // active social +5 only
  assert.equal(r.lead_score, 5);
  assert.equal(r.classification, 'Cold');
  assert.ok(r.website_score >= 85);
});

test('old site over http scores Warm/Hot', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: false, hasH1: false, hasViewport: false, hasContactForm: false, hasSSL: false, socialLinks: [], copyrightYear: 2010 },
    pagespeed: { mobilePerf: 40, seo: 55 },
    reviewCount: 150, hasSocial: false, multipleLocations: false, aiOutdated: true,
  }, YEAR);
  // +20 outdated, +15 SEO, +15 mobile, +10 large = 60
  assert.equal(r.lead_score, 60);
  assert.equal(r.classification, 'Warm');
});

test('lead_score never exceeds 100', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: false, hasMetaDescription: false, hasH1: false, hasViewport: false, hasContactForm: false, hasSSL: false, socialLinks: ['x'], copyrightYear: 2005 },
    pagespeed: { mobilePerf: 5, seo: 5 },
    reviewCount: 999, hasSocial: true, multipleLocations: true, aiOutdated: true,
  }, YEAR);
  // 20+15+15+10+5+10 = 75 (no-website not applicable since hasWebsite true)
  assert.ok(r.lead_score <= 100);
  assert.equal(r.lead_score, 75);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scoring.test.js`
Expected: FAIL — `Cannot find module '../lib/scoring'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/scoring.js
// Pure scoring. `signals` is fully pre-extracted; `currentYear` injected for testability.
const LARGE_BUSINESS_REVIEWS = 100;
const OUTDATED_YEAR_GAP = 3; // copyright older than (currentYear - 3) => outdated

function isOutdated(html, aiOutdated, currentYear) {
  if (aiOutdated) return true;
  if (!html) return false;
  if (!html.hasViewport) return true;
  if (!html.hasSSL) return true;
  if (html.copyrightYear && html.copyrightYear < currentYear - OUTDATED_YEAR_GAP) return true;
  return false;
}

function isPoorSeo(html, pagespeed) {
  if (!html) return false; // handled by no-website branch
  const missingBasics = !html.hasTitle || !html.hasMetaDescription || !html.hasH1;
  const lowScore = pagespeed && typeof pagespeed.seo === 'number' && pagespeed.seo < 70;
  return Boolean(missingBasics || lowScore);
}

function isPoorMobile(html, pagespeed) {
  if (!html) return false;
  const noViewport = !html.hasViewport;
  const lowPerf = pagespeed && typeof pagespeed.mobilePerf === 'number' && pagespeed.mobilePerf < 70;
  return Boolean(noViewport || lowPerf);
}

function computeWebsiteScore(html, pagespeed) {
  if (!html) return 0;
  let score = 0;
  const mobile = pagespeed && typeof pagespeed.mobilePerf === 'number' ? pagespeed.mobilePerf : 50;
  score += 0.40 * mobile;                     // 40% performance
  score += html.hasViewport ? 15 : 0;         // 15% mobile-ready
  score += html.hasSSL ? 10 : 0;              // 10% SSL
  const seoBasics = [html.hasTitle, html.hasMetaDescription, html.hasH1].filter(Boolean).length;
  score += (seoBasics / 3) * 20;              // 20% SEO basics
  score += html.hasContactForm ? 15 : 0;      // 15% lead capture
  return Math.round(Math.min(100, score));
}

function computeAutomationScore(signals) {
  if (!signals.hasWebsite) return 80; // no site = huge automation/build opportunity
  let score = 0;
  if (!signals.html || !signals.html.hasContactForm) score += 30; // no lead capture
  if (!signals.hasSocial) score += 15;                            // no social funnel
  if (signals.reviewCount >= LARGE_BUSINESS_REVIEWS) score += 25; // busy but underserved
  if (signals.aiOutdated) score += 30;                            // AI flagged manual/old
  return Math.round(Math.min(100, score));
}

function classify(leadScore) {
  if (leadScore >= 70) return 'Hot';
  if (leadScore >= 40) return 'Warm';
  return 'Cold';
}

function computeScores(signals, currentYear) {
  const s = signals || {};
  let lead = 0;
  if (!s.hasWebsite) {
    lead += 25;       // no website
    lead += 15;       // poor SEO (none exists)
    lead += 15;       // poor mobile (none exists)
  } else {
    if (isOutdated(s.html, s.aiOutdated, currentYear)) lead += 20;
    if (isPoorSeo(s.html, s.pagespeed)) lead += 15;
    if (isPoorMobile(s.html, s.pagespeed)) lead += 15;
  }
  if (s.reviewCount >= LARGE_BUSINESS_REVIEWS) lead += 10; // large business
  if (s.hasSocial) lead += 5;                              // active social
  if (s.multipleLocations) lead += 10;                     // multiple locations

  const lead_score = Math.min(100, lead);
  return {
    website_score: computeWebsiteScore(s.html, s.pagespeed),
    automation_score: computeAutomationScore(s),
    lead_score,
    classification: classify(lead_score),
  };
}

module.exports = { computeScores, classify };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scoring.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring.js test/scoring.test.js
git commit -m "feat: 100-point lead scoring + classification with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `lib/aiReview.js` (TDD)

**Files:**
- Create: `lib/aiReview.js`
- Test: `test/aiReview.test.js`

Two pure functions: `buildReviewPrompt(lead, htmlSnippet)` → a Groq chat-messages array; `parseReview(content)` → `{ outdated, opportunities, missingLeadCapture, summary }`, tolerant of code fences / extra prose.

- [ ] **Step 1: Write the failing test**

```js
// test/aiReview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReviewPrompt, parseReview } = require('../lib/aiReview');

test('buildReviewPrompt returns system+user messages mentioning the business', () => {
  const msgs = buildReviewPrompt({ business_name: 'Acme Dental', website: 'https://acme.com' }, '<h1>Hi</h1>');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /Acme Dental/);
  assert.match(msgs[1].content, /JSON/i);
});

test('parseReview reads clean JSON', () => {
  const r = parseReview('{"outdated":true,"opportunities":["chatbot"],"missingLeadCapture":["no form"],"summary":"old site"}');
  assert.equal(r.outdated, true);
  assert.deepEqual(r.opportunities, ['chatbot']);
  assert.equal(r.summary, 'old site');
});

test('parseReview tolerates code fences and prose', () => {
  const r = parseReview('Here is the result:\n```json\n{"outdated":false,"opportunities":[],"missingLeadCapture":[],"summary":"fine"}\n```');
  assert.equal(r.outdated, false);
  assert.equal(r.summary, 'fine');
});

test('parseReview returns safe defaults on garbage', () => {
  const r = parseReview('the model refused to answer');
  assert.equal(r.outdated, false);
  assert.deepEqual(r.opportunities, []);
  assert.equal(r.summary, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aiReview.test.js`
Expected: FAIL — `Cannot find module '../lib/aiReview'`.

- [ ] **Step 3: Write the implementation**

```js
// lib/aiReview.js
// Pure: build the Groq prompt and parse its JSON reply. No network here.
function buildReviewPrompt(lead, htmlSnippet) {
  const system = 'You are a web/automation consultant. Reply with ONLY a JSON object, no prose. '
    + 'Schema: {"outdated":boolean,"opportunities":string[],"missingLeadCapture":string[],"summary":string}. '
    + '"outdated" = is the site visually/technically dated. "opportunities" = automation/AI wins (max 4). '
    + '"missingLeadCapture" = absent ways to capture leads. "summary" = one sentence.';
  const user = `Business: ${lead.business_name || 'Unknown'}\nWebsite: ${lead.website || 'NONE'}\n`
    + `HTML excerpt (truncated):\n${String(htmlSnippet || '').slice(0, 4000)}\n\n`
    + 'Return the JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseReview(content) {
  const fallback = { outdated: false, opportunities: [], missingLeadCapture: [], summary: '' };
  if (!content) return fallback;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return fallback;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      outdated: Boolean(obj.outdated),
      opportunities: Array.isArray(obj.opportunities) ? obj.opportunities : [],
      missingLeadCapture: Array.isArray(obj.missingLeadCapture) ? obj.missingLeadCapture : [],
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    };
  } catch {
    return fallback;
  }
}

module.exports = { buildReviewPrompt, parseReview };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aiReview.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/aiReview.js test/aiReview.test.js
git commit -m "feat: AI review prompt builder + tolerant JSON parser with tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `build-m1-workflow.js` — assemble the workflow JSON

**Files:**
- Create: `build-m1-workflow.js`
- Generated: `workflows/m1-lead-analysis.json`

The builder embeds each `lib/` module's body (with `module.exports` stripped) into the relevant Code node, so there is one source of truth. Node graph:

```
Manual Trigger ─┐
Schedule Trigger ┴→ Set Config → HTTP Places Search → Code "Normalize+Flag" (Split)
  → Airtable "Dedup Lookup" is replaced by Airtable upsert at the end (key=place_id)
  → IF has_website
       true → HTTP PageSpeed → HTTP Fetch HTML → Code "HTML Signals"
              → HTTP Groq Review → Code "Parse AI" ─┐
       false → Set "No-site defaults" ──────────────┤
  → Merge → Code "Compute Scores" → HTTP Apollo Enrich (continueOnFail)
  → Code "Assemble Record" → Airtable Upsert (Leads, key=place_id)
```

Auth: Google key via header/query expression `={{ $env.GOOGLE_API_KEY }}`; Apollo via header `={{ $env.APOLLO_API_KEY }}`; Groq via its existing n8n credential; Airtable via an Airtable Token credential linked in the UI after import.

- [ ] **Step 1: Write the builder**

```js
// build-m1-workflow.js
const fs = require('fs');
const path = require('path');

// Read a lib module's source and strip its CommonJS export line so it can be
// pasted into an n8n Code node (which has no module system).
function libBody(name) {
  const src = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return src.replace(/^module\.exports\s*=.*$/m, '').trim();
}

const placesParser = libBody('placesParser.js');
const htmlSignals = libBody('htmlSignals.js');
const scoring = libBody('scoring.js');
const aiReview = libBody('aiReview.js');

// ---- Code node bodies (lib + glue) ----
const normalizeCode = `${placesParser}
const resp = $input.first().json;
const places = Array.isArray(resp.places) ? resp.places : [];
const multi = flagMultipleLocations(places);
return places.map((pl) => {
  const lead = parsePlace(pl);
  lead.lead_source = 'google_places';
  lead.multipleLocations = multi.has((lead.business_name || '').trim().toLowerCase());
  return { json: lead };
});`;

const htmlSignalsCode = `${htmlSignals}
${aiReview}
const lead = $('Normalize+Flag').item.json;
const html = $input.first().json.data || $input.first().json.body || $input.first().json || '';
const finalUrl = lead.website || '';
let pagespeed = null;
try {
  const ps = $('PageSpeed').item.json;
  const cats = ps.lighthouseResult && ps.lighthouseResult.categories;
  if (cats) pagespeed = {
    mobilePerf: Math.round((cats.performance && typeof cats.performance.score === 'number' ? cats.performance.score : 0.5) * 100),
    seo: Math.round((cats.seo && typeof cats.seo.score === 'number' ? cats.seo.score : 0.7) * 100),
  };
} catch (e) { pagespeed = null; }
const sig = extractHtmlSignals(html, finalUrl);
const htmlRaw = String(html).slice(0, 4000);
const messages = buildReviewPrompt(lead, htmlRaw);
return [{ json: { ...lead, html: sig, htmlRaw, pagespeed, messages } }];`;

const parseAiCode = `${aiReview}
const prev = $('HTML Signals').item.json;
const content = $input.first().json.choices?.[0]?.message?.content || '';
const ai = parseReview(content);
return [{ json: { ...prev, ai } }];`;

const noSiteCode = `const lead = $('Normalize+Flag').item.json;
return [{ json: { ...lead, html: null, ai: { outdated: false, opportunities: [], missingLeadCapture: [], summary: 'No website found.' }, pagespeed: null } }];`;

const computeCode = `${scoring}
const d = $input.first().json;
const pagespeed = d.pagespeed || null;
const signals = {
  hasWebsite: Boolean(d.has_website),
  html: d.html || null,
  pagespeed,
  reviewCount: d.review_count || 0,
  hasSocial: Boolean(d.html && d.html.socialLinks && d.html.socialLinks.length) ,
  multipleLocations: Boolean(d.multipleLocations),
  aiOutdated: Boolean(d.ai && d.ai.outdated),
};
const year = new Date().getFullYear();
const scores = computeScores(signals, year);
const rationale = [
  d.ai && d.ai.summary,
  'Opportunities: ' + ((d.ai && d.ai.opportunities) || []).join(', '),
  'Conversion estimate: ' + (scores.classification === 'Hot' ? 'high' : scores.classification === 'Warm' ? 'medium' : 'low'),
  'Next action: ' + (scores.classification === 'Cold' ? 'store only' : 'queue for email outreach'),
].filter(Boolean).join('\\n');
return [{ json: { ...d, ...scores, has_social: signals.hasSocial, ai_findings: ((d.ai && d.ai.opportunities) || []).join('; '), ai_rationale: rationale } }];`;

const assembleCode = `const d = $input.first().json;
const enrich = (() => { try { return $('Apollo Enrich').item.json; } catch (e) { return {}; } })();
const person = (enrich.person) || (Array.isArray(enrich.matches) ? enrich.matches[0] : null) || {};
const scrapedEmail = (d.html && Array.isArray(d.html.emails) && d.html.emails[0]) || '';
const email = person.email || scrapedEmail || '';   // Apollo first, site-scrape fallback
const owner = [person.first_name, person.last_name].filter(Boolean).join(' ');
return [{ json: {
  business_name: d.business_name, place_id: d.place_id, owner_name: owner || '',
  email, phone: d.phone || '', website: d.website || '', category: d.category || '',
  location: d.location || '', lead_source: 'google_places', has_website: Boolean(d.has_website),
  review_count: d.review_count || 0, website_score: d.website_score, automation_score: d.automation_score,
  lead_score: d.lead_score, classification: d.classification,
  pagespeed_mobile: d.pagespeed ? d.pagespeed.mobilePerf : 0,
  ai_findings: d.ai_findings || '', ai_rationale: d.ai_rationale || '',
  has_email: Boolean(email), has_phone: Boolean(d.phone), has_social: Boolean(d.has_social),
  status: 'New',
} }];`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M1 - Lead Analysis Pipeline',
  nodes: [
    { parameters: {}, id: id('manual-1'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'days', daysInterval: 1 }] } }, id: id('sched-1'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { assignments: { assignments: [
      { id: 'a1', name: 'textQuery', type: 'string', value: 'dentist in Manchester' },
      { id: 'a2', name: 'maxResultCount', type: 'number', value: 5 },
    ] }, options: {} }, id: id('cfg-1'), name: 'Set Config', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 300] },
    { parameters: { method: 'POST', url: 'https://places.googleapis.com/v1/places:searchText',
      sendHeaders: true, headerParameters: { parameters: [
        { name: 'X-Goog-Api-Key', value: '={{ $env.GOOGLE_API_KEY }}' },
        { name: 'X-Goog-FieldMask', value: 'places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.userRatingCount,places.rating,places.formattedAddress,places.types' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ textQuery: $json.textQuery, maxResultCount: $json.maxResultCount }) }}',
      options: { response: { response: { neverError: false } } } },
      id: id('places-1'), name: 'Places Search', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [460, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { jsCode: normalizeCode }, id: id('norm-1'), name: 'Normalize+Flag', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'c1', leftValue: '={{ $json.has_website }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
    ] } }, id: id('if-1'), name: 'Has Website?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [900, 300] },
    { parameters: { url: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
      sendQuery: true, queryParameters: { parameters: [
        { name: 'url', value: '={{ $json.website }}' },
        { name: 'strategy', value: 'mobile' },
        { name: 'key', value: '={{ $env.GOOGLE_API_KEY }}' },
      ] }, options: {} },
      id: id('ps-1'), name: 'PageSpeed', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 200], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { url: '={{ $json.website }}', options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 } },
      id: id('html-1'), name: 'Fetch HTML', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1340, 200], onError: 'continueRegularOutput' },
    { parameters: { jsCode: htmlSignalsCode }, id: id('hsig-1'), name: 'HTML Signals', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1560, 200] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.2, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} },
      id: id('groq-1'), name: 'Groq Review', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1780, 200], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { jsCode: parseAiCode }, id: id('pai-1'), name: 'Parse AI', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2000, 200] },
    { parameters: { jsCode: noSiteCode }, id: id('nosite-1'), name: 'No-site Defaults', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1120, 420] },
    { parameters: { numberInputs: 2 }, id: id('merge-1'), name: 'Merge', type: 'n8n-nodes-base.merge', typeVersion: 3, position: [2220, 300] },
    { parameters: { jsCode: computeCode }, id: id('comp-1'), name: 'Compute Scores', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2440, 300] },
    { parameters: { method: 'POST', url: 'https://api.apollo.io/api/v1/people/match',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Api-Key', value: '={{ $env.APOLLO_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ domain: ($json.website || "").replace(/^https?:\\\\/\\\\//,"").replace(/\\\\/.*$/,"") }) }}',
      options: {} },
      id: id('apollo-1'), name: 'Apollo Enrich', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2660, 300], onError: 'continueRegularOutput' },
    { parameters: { jsCode: assembleCode }, id: id('asm-1'), name: 'Assemble Record', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2880, 300] },
    { parameters: { resource: 'record', operation: 'upsert',
      base: { __rl: true, value: '={{ $env.AIRTABLE_BASE_ID }}', mode: 'id' },
      table: { __rl: true, value: 'Leads', mode: 'name' },
      columns: { mappingMode: 'autoMapInputData', matchingColumns: ['place_id'], value: {} },
      options: {} },
      id: id('air-1'), name: 'Airtable Upsert', type: 'n8n-nodes-base.airtable', typeVersion: 2.1, position: [3100, 300] },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Set Config', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Set Config', type: 'main', index: 0 }]] },
    'Set Config': { main: [[{ node: 'Places Search', type: 'main', index: 0 }]] },
    'Places Search': { main: [[{ node: 'Normalize+Flag', type: 'main', index: 0 }]] },
    'Normalize+Flag': { main: [[{ node: 'Has Website?', type: 'main', index: 0 }]] },
    'Has Website?': { main: [
      [{ node: 'PageSpeed', type: 'main', index: 0 }],
      [{ node: 'No-site Defaults', type: 'main', index: 0 }],
    ] },
    'PageSpeed': { main: [[{ node: 'Fetch HTML', type: 'main', index: 0 }]] },
    'Fetch HTML': { main: [[{ node: 'HTML Signals', type: 'main', index: 0 }]] },
    'HTML Signals': { main: [[{ node: 'Groq Review', type: 'main', index: 0 }]] },
    'Groq Review': { main: [[{ node: 'Parse AI', type: 'main', index: 0 }]] },
    'Parse AI': { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
    'No-site Defaults': { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
    'Merge': { main: [[{ node: 'Compute Scores', type: 'main', index: 0 }]] },
    'Compute Scores': { main: [[{ node: 'Apollo Enrich', type: 'main', index: 0 }]] },
    'Apollo Enrich': { main: [[{ node: 'Assemble Record', type: 'main', index: 0 }]] },
    'Assemble Record': { main: [[{ node: 'Airtable Upsert', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = process.argv[2] || 'workflows/m1-lead-analysis.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
```

> **Data flow note:** `HTML Signals` reads the PageSpeed node output, reduces the Lighthouse JSON to `{mobilePerf, seo}`, extracts HTML signals, and builds the Groq `messages` — all in one node. `Parse AI` spreads that forward (carrying `pagespeed`), and `Compute Scores` reads `d.pagespeed`. The `No-site Defaults` branch sets `pagespeed: null`, which `computeWebsiteScore`/`isPoorSeo` handle.

- [ ] **Step 2: Build the workflow**

Run: `node build-m1-workflow.js workflows/m1-lead-analysis.json`
Expected: `wrote workflows/m1-lead-analysis.json - 17 nodes`.

- [ ] **Step 3: Validate the JSON parses and has connections**

Run: `node -e "const w=require('./workflows/m1-lead-analysis.json'); if(!w.nodes.length||!w.connections['Places Search']) throw new Error('bad workflow'); console.log('valid:', w.nodes.length, 'nodes')"`
Expected: `valid: 17 nodes`.

- [ ] **Step 4: Commit**

```bash
git add build-m1-workflow.js workflows/m1-lead-analysis.json
git commit -m "feat: build M1 lead-analysis workflow JSON from tested lib modules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Push + execute + verify (integration test from the spec)

**Files:**
- Create: `scripts/push-workflow.js`
- Create: `scripts/run-workflow.js`

Implements the spec's testing plan steps 1, 2, 3, 5.

- [ ] **Step 1: Write the push script**

```js
// scripts/push-workflow.js
const fs = require('fs');
const path = require('path');
function env(k){ const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8'); const m=t.match(new RegExp('^'+k+'=(.*)$','m')); return m?m[1]:''; }
const KEY = env('N8N_API_KEY');
const BASE = 'http://localhost:5678/api/v1';
const file = process.argv[2];
(async () => {
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const r = await fetch(`${BASE}/workflows`, { method: 'POST', headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { console.error('push failed:', r.status, JSON.stringify(j)); process.exit(1); }
  console.log('created workflow id:', j.id);
})();
```

- [ ] **Step 2: Push the workflow**

Run: `node scripts/push-workflow.js workflows/m1-lead-analysis.json`
Expected: `created workflow id: <id>`. (If it fails on credentials, that's expected — link them in Step 3.)

- [ ] **Step 3: Link credentials in the n8n UI (one-time)**

Open `http://localhost:5678` → open **M1 - Lead Analysis Pipeline**:
- **Groq Review** node → if it shows an auth prompt, set Header Auth `Authorization: Bearer <GROQ_API_KEY>` (or attach existing Groq credential `N8N_GROQ_CREDENTIAL_ID`).
- **Airtable Upsert** node → create/select an **Airtable Personal Access Token** credential using `AIRTABLE_PAT` from `.env`.
- Ensure n8n process has `GOOGLE_API_KEY`, `APOLLO_API_KEY`, `AIRTABLE_BASE_ID` in its environment (the `$env.*` expressions read these). If n8n can't see `$env`, replace those expressions with n8n **Variables** (`$vars.*`) set under Settings → Variables.

Save the workflow.

- [ ] **Step 4: Execute manually and verify 5 rows (spec test #1)**

In the n8n UI, open the workflow → click **Execute Workflow** (Manual Trigger). Watch each node go green.
Expected: 5 items flow to **Airtable Upsert**. Then check Airtable base `appq4ty5pPOftbXbN` → **Leads** table: 5 rows with `business_name`, `lead_score`, `classification` populated.

- [ ] **Step 5: Verify no-website + modern/old divergence (spec tests #2, #3)**

In **Set Config**, temporarily set `textQuery` to a term you know includes a business with no website (e.g. a small local trade). Execute.
Expected: at least one row with `has_website` unchecked, `website_score = 0`, `lead_score ≥ 65`, `classification` Warm/Hot. Rows with modern sites show higher `website_score` and lower `lead_score`.

- [ ] **Step 6: Verify dedupe (spec test #5)**

Re-run **Execute Workflow** with the original `dentist in Manchester` query.
Expected: Leads table still has the same rows (updated, not duplicated) — confirms `upsert` on `place_id` works. Row count unchanged for those 5 places.

- [ ] **Step 7: Commit the push script**

```bash
git add scripts/push-workflow.js
git commit -m "feat: n8n workflow push script

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Error-handler workflow + failure notification (spec §5.6, test #4)

**Files:**
- Create: `build-error-workflow.js`
- Generated: `workflows/m1-error-handler.json`

A separate workflow with an **Error Trigger** that logs to the Airtable `Errors` table and emails the operator.

- [ ] **Step 1: Write the error-workflow builder**

```js
// build-error-workflow.js
const fs = require('fs');
const id = (s) => s.padEnd(36, '0').slice(0, 36);
const logCode = `const e = $input.first().json;
return [{ json: {
  workflow: e.workflow?.name || 'unknown',
  node: e.execution?.lastNodeExecuted || '',
  message: (e.execution?.error?.message) || JSON.stringify(e.execution?.error || {}).slice(0,500),
  payload: JSON.stringify(e).slice(0, 1000),
  at: new Date().toISOString(),
} }];`;
const wf = {
  name: 'M1 - Error Handler',
  nodes: [
    { parameters: {}, id: id('errtrig-1'), name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 300] },
    { parameters: { jsCode: logCode }, id: id('errfmt-1'), name: 'Format Error', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 300] },
    { parameters: { resource: 'record', operation: 'create',
      base: { __rl: true, value: '={{ $env.AIRTABLE_BASE_ID }}', mode: 'id' },
      table: { __rl: true, value: 'Errors', mode: 'name' },
      columns: { mappingMode: 'autoMapInputData', value: {} }, options: {} },
      id: id('errair-1'), name: 'Log to Airtable', type: 'n8n-nodes-base.airtable', typeVersion: 2.1, position: [480, 300] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '=n8n pipeline error: {{ $json.workflow }}',
      emailType: 'text', message: '={{ $json.node }}: {{ $json.message }}', options: {} },
      id: id('errmail-1'), name: 'Email Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [720, 300] },
  ],
  connections: {
    'Error Trigger': { main: [[{ node: 'Format Error', type: 'main', index: 0 }]] },
    'Format Error': { main: [[{ node: 'Log to Airtable', type: 'main', index: 0 }]] },
    'Log to Airtable': { main: [[{ node: 'Email Operator', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};
fs.writeFileSync(process.argv[2] || 'workflows/m1-error-handler.json', JSON.stringify(wf, null, 2));
console.log('wrote error handler -', wf.nodes.length, 'nodes');
```

- [ ] **Step 2: Build + push**

Run:
```bash
node build-error-workflow.js workflows/m1-error-handler.json
node scripts/push-workflow.js workflows/m1-error-handler.json
```
Expected: `wrote error handler - 4 nodes`, then `created workflow id: <id>`.

- [ ] **Step 3: Wire the error workflow + Gmail credential**

In the n8n UI: open **M1 - Lead Analysis Pipeline** → **Settings (⋮) → Error Workflow → select "M1 - Error Handler"**. On the error handler, link a **Gmail OAuth2** credential for `muhammadshahkar1912@gmail.com` and ensure `NOTIFY_EMAIL` is available. Save both.

- [ ] **Step 4: Force a failure and verify notification (spec test #4)**

Temporarily break the Places auth: in **Set Config** add an assignment `textQuery = ''` (invalid → Places 400), Execute.
Expected: main workflow errors → **M1 - Error Handler** runs → a new row appears in Airtable **Errors** table AND an email arrives at `rehmanumair1912@gmail.com`. Then revert `textQuery`.

- [ ] **Step 5: Commit**

```bash
git add build-error-workflow.js workflows/m1-error-handler.json
git commit -m "feat: error-handler workflow logs to Airtable + emails operator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full regression + documentation

**Files:**
- Modify: `workflows/SETUP.md` (append M1 section)

- [ ] **Step 1: Run the full unit suite**

Run: `node --test`
Expected: all tests across `test/` PASS (htmlSignals 4, placesParser 3, scoring 4, aiReview 4 = 15 tests).

- [ ] **Step 2: Rebuild both workflows from source (confirms builders are reproducible)**

Run:
```bash
node build-m1-workflow.js workflows/m1-lead-analysis.json
node build-error-workflow.js workflows/m1-error-handler.json
git diff --stat
```
Expected: either no diff, or only intentional changes — confirms the JSON is generated, not hand-edited.

- [ ] **Step 3: Append the M1 runbook to SETUP.md**

Append exactly this section to `workflows/SETUP.md`:

```markdown

---

## Milestone 1 — Lead Analysis Pipeline

**What it does:** every day (and on demand) it discovers local businesses via Google Places,
analyzes each website (PageSpeed + Groq AI), scores them 0–100, classifies Cold/Warm/Hot, enriches
contact info via Apollo (site-scrape fallback), and upserts into the Airtable `Leads` table. No
outreach is sent.

### Required `.env` vars
`GOOGLE_API_KEY`, `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`, `APOLLO_API_KEY`, `GROQ_API_KEY`,
`N8N_API_KEY`, `NOTIFY_EMAIL`.

### One-time setup
1. `npm run airtable:setup` — creates the `Leads` + `Errors` tables (idempotent).
2. `npm run build:m1` — generates `workflows/m1-lead-analysis.json`.
3. `npm run push:m1` — creates the workflow in n8n.
4. In the n8n UI, link credentials: **Airtable PAT** (Airtable Upsert node), **Gmail OAuth2** for
   `muhammadshahkar1912@gmail.com` (Email Operator node, error workflow). Ensure the n8n process sees
   `GOOGLE_API_KEY`/`APOLLO_API_KEY`/`AIRTABLE_BASE_ID` as env (or mirror them in Settings → Variables
   and switch the `$env.*` expressions to `$vars.*`).
5. Set **M1 - Error Handler** as the workflow's Error Workflow (Settings → Error Workflow).

### Changing the target market
Open the **Set Config** node → edit `textQuery` (e.g. `"plumber in Leeds"`) and `maxResultCount`.

### Schedule
The **Schedule Trigger** runs daily. Change the interval in that node. Toggle the workflow **Active**
to enable the schedule; use **Execute Workflow** for manual test runs.
```

- [ ] **Step 4: Commit**

```bash
git add workflows/SETUP.md
git commit -m "docs: M1 lead-analysis pipeline runbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of Done

- [ ] `node --test` → 14 passing unit tests.
- [ ] `npm run airtable:setup` created `Leads` + `Errors` tables (idempotent).
- [ ] `npm run build:m1` regenerates `workflows/m1-lead-analysis.json` deterministically.
- [ ] Manual execution writes 5 scored, classified rows to Airtable.
- [ ] No-website lead scores Warm/Hot with `website_score=0`; modern site scores lower.
- [ ] Re-run does not duplicate rows (upsert on `place_id`).
- [ ] Forced failure logs to `Errors` table and emails the operator.
- [ ] No outreach is sent (no email/WhatsApp/voice nodes exist in M1).
