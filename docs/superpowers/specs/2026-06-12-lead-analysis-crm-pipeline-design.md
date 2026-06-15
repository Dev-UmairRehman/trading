# Lead Generation & Client Acquisition System — Design Spec

**Date:** 2026-06-12
**Status:** Approved for Milestone 1 build
**Owner:** Rehman (Umair)

---

## 1. Vision

A cost-optimized, **guarded-autonomous** lead-generation and client-acquisition system built in n8n.
It finds local businesses, analyzes their online presence, scores them, contacts them through the
cheapest viable channel, escalates only when ROI justifies it, and notifies the operator only when a
lead is genuinely likely to convert. The operator manually closes deals.

**Services being sold:** Website Development, AI Automation, n8n Automation, Business Process
Automation, AI Agents, CRM Automation.

### Core principles
- **Cost minimization is a hard rule.** Channel priority: free analysis → email → contact form →
  LinkedIn → WhatsApp (WAPI) → AI voice. Each downward step fires only when the cheaper step is
  unavailable or the lead has *earned* the spend.
- **Guarded autonomy.** Find/analyze/score/store and email+follow-ups run fully unattended (with
  daily caps + kill switch). WhatsApp and voice are money-spending and irreversible, so they require a
  **one-tap Telegram approval** before firing.
- **Minimum nodes, no overengineering.** Prefer free APIs and in-workflow logic over paid services.

---

## 2. Identities & Accounts

| Purpose | Value |
|---|---|
| Outreach **sending** inbox | `muhammadshahkar1912@gmail.com` |
| Operator **notification / identity** inbox | `rehmanumair1912@gmail.com` |
| CRM / dashboard | Airtable (free tier; NocoDB self-hosted is the $0 migration path if outgrown) |
| AI | Groq (primary, free/cheap) + Anthropic (fallback for harder reasoning) |
| Lead discovery | Google Places API (primary, local businesses) |
| Contact enrichment | Apollo API (domain → owner email/name, best-effort) |
| Performance/SEO audit | Google PageSpeed Insights API (free) |

Separating the sending inbox from the operator inbox means a sender-reputation hit never touches the
operator's main inbox.

### Required new credentials (operator action)
1. **Google Cloud API key** with **Places API** + **PageSpeed Insights API** enabled.
2. **Airtable** account + **Personal Access Token**.

---

## 3. The Full System — Cost-Gated Escalation Ladder

```
FREE TIER  (every lead, autonomous):   Find → Analyze → Score → Classify → Store in CRM
                                                  │
EMAIL TIER (Warm+Hot, score ≥40,        Personalized email → FU#1 → FU#2 → FU#3
            autonomous, capped):           (stop sequence on reply)
                                                  │
CONTACT-FORM TIER (no email found):     auto-submit the site's contact form
                                                  │
LINKEDIN TIER (still no contact path):  LinkedIn touch
                                                  │
WAPI TIER  (GATED — Telegram approval): WhatsApp outreach
   Gate: score > 80  OR positive reply  OR multiple email opens
         OR booking/proposal page revisited OR business highly valuable
                                                  │
VOICE TIER (GATED — Telegram approval): AI voice call
   Gate: score > 90 AND email+WhatsApp failed AND phone verified
```

This document fully specifies the **FREE TIER (Milestone 1)**. Email, WAPI, and Voice tiers are
roadmapped here but each gets its own spec → plan → build → test cycle.

---

## 4. Lead Scoring Model (operator-defined, sums to 100)

| Factor | Points | Detection rule (measurable) |
|---|---|---|
| No website | +25 | Google Places returns no `website` field |
| Website outdated | +20 | AI verdict + signals: no viewport meta, table-based layout, old copyright year, no SSL |
| Poor SEO | +15 | Missing `<title>` / meta description / `<h1>`, **or** PageSpeed SEO score < 70 |
| Poor mobile experience | +15 | PageSpeed mobile performance < 70, **or** no viewport meta |
| Large business | +10 | Google review count ≥ 100 |
| Active social presence | +5 | Social links found on site or in Places result |
| Multiple locations | +10 | Same brand returns ≥ 2 Places results |

**Classification:** `0–39 = Cold`, `40–69 = Warm`, `70–100 = Hot`.

The AI also writes, per lead: **why** it scored that way, an **expected conversion probability**, and a
**recommended next action**. Scoring lives in a single transparent Code node so weights are tunable.

---

## 5. Milestone 1 — Free-Tier Pipeline (this build)

### 5.1 Purpose
Autonomously discover local service businesses, analyze each website, compute the full lead score +
classification + AI rationale, enrich contact info, and store everything in Airtable — producing a CRM
full of **fully-scored, classified, channel-routed, but not-yet-contacted** leads. No outreach fires in
Milestone 1, which keeps the Gmail account safe while the foundation is proven.

### 5.2 Trigger
- **Schedule** (e.g. daily) + **Manual** trigger for testing.

### 5.3 Architecture / data flow
```
[Schedule / Manual Trigger]
  → [Set: search config — city, business types[], max results]
  → [Google Places: Text Search]                       (discover businesses)
  → [Split Out items]
  → [Filter: dedupe vs existing Airtable place_id]
  → [Google Places: Place Details]                     (website, phone, address, rating, reviews)
  → IF (has website?)
       ├─ YES → [PageSpeed Insights API] → [HTTP: fetch HTML] → [Groq AI review]
       └─ NO  → [Set: has_website=false, website_score=0, big automation opportunity]
  → [Code: compute factor signals → Website Score + Automation Score + Lead Score + class]
  → [Groq AI: rationale + conversion prob + next action]
  → [Apollo enrich: domain → owner email/name]  (best-effort; fallback: scrape mailto/contact email)
  → [Set: channel-routing flags for later tiers]
  → [Airtable: upsert Lead by place_id]
  (Separate [Error Trigger] sub-workflow logs failures + emails operator)
```

### 5.4 Node configuration notes
- **Google Places Text Search:** query built from `business_type in {city}`; iterate business types.
- **Place Details:** request fields `website, formatted_phone_number, formatted_address,
  user_ratings_total, rating, url`.
- **PageSpeed:** call mobile strategy; read `categories.performance/seo/best-practices` + `viewport`
  audit. Free quota; add retry.
- **HTTP fetch HTML:** for tag/SSL/social/form/copyright-year signal extraction (Code node parses).
- **AI review (Groq):** input = trimmed HTML + Places metadata; output = JSON
  `{outdated:bool, automation_opportunities:[], missing_lead_capture:[], summary}`.
- **Scoring Code node:** pure function over the collected signals → all scores + class. Tunable weights.
- **Apollo enrich:** People/Org enrichment by domain; best-effort, `continueOnFail`.

### 5.5 Airtable `Leads` table
| Field | Type | Source |
|---|---|---|
| business_name | text | Places |
| place_id | text (unique key) | Places — dedupe key |
| owner_name | text | Apollo |
| email | email | Apollo / site scrape |
| phone | phone | Places |
| website | url | Places |
| category | text | Places types |
| location | text | Places |
| lead_source | single select | "google_places" |
| has_website | checkbox | derived |
| review_count | number | Places |
| website_score | number 0–100 | computed |
| automation_score | number 0–100 | computed |
| lead_score | number 0–100 | computed (factor sum) |
| classification | single select | Cold / Warm / Hot |
| pagespeed_mobile | number | PageSpeed |
| ai_findings | long text | Groq |
| ai_rationale | long text | Groq (why + conversion prob + next action) |
| has_email / has_phone / has_social | checkbox | routing flags |
| status | single select | default "New" |
| created_at | created time | Airtable |

A small `Errors` table logs failures (workflow, node, message, timestamp, payload).

### 5.6 Error handling
- Each external API node: **retry on fail** (3×, 5s back-off) + **continueOnFail** so one bad business
  never kills the batch.
- PageSpeed / Apollo failures **degrade gracefully** (score from available signals, set
  `analysis_partial`).
- Dedicated **Error Trigger** sub-workflow → log to `Errors` table → email operator (Telegram added in a
  later milestone).

### 5.7 Testing plan (run it; do not assume)
1. Pin to **one city + one business type, max 5 results** → 5 rows land in Airtable with correct fields.
2. Known business **without a website** → `has_website=false`, `website_score=0`, lead_score includes +25.
3. One **modern** site vs one **old** site → scores diverge sensibly; classifications differ.
4. Force an API-key error → Error workflow fires and emails operator.
5. Re-run same search → **dedupe** verified (no duplicate `place_id` rows).

### 5.8 Optimization / scope guardrails (YAGNI)
- Milestone 1 sends **no** email and triggers **no** paid channel.
- Apify deferred — Places covers local discovery; add Apify only if Places coverage proves thin.
- Apollo enrichment is best-effort; site-scrape fallback keeps it free when Apollo misses.

---

## 6. Roadmap (post-M1, each its own spec/plan/build/test)

- **M2 — Email engine:** personalized initial + 3 follow-ups from `muhammadshahkar1912@gmail.com`,
  open/click/reply tracking, **stop-on-reply**, hard **daily cap + kill switch**. Fires for Warm+Hot.
- **M3 — Contact-form + LinkedIn fallback tiers** for leads with no email.
- **M4 — Qualification + Notifications:** AI Hot/Warm/Cold re-scoring on engagement; **Telegram/email
  notify** on positive reply, meeting request, hot detection, with full lead context + recommended reply.
- **M5 — WAPI tier (gated):** WhatsApp outreach behind one-tap Telegram approval; gate = score>80 OR
  reply OR multi-open OR page revisit OR high-value.
- **M6 — Voice tier (gated):** AI voice call behind approval; gate = score>90 AND email+WA failed AND
  phone verified.

### Voice-tier call script assets (captured for M6)
- **Cold/first-touch variant** (operator-supplied, verbatim): consultative discovery, no hard pitch,
  closes by asking for the best email.
- **Warm re-engagement variant** (to be written): used at the actual voice tier where email is already
  known and prior channels failed — close shifts to **booking a call / proposal review**, not collecting
  an email.

---

## 7. Open assumptions to confirm before build
1. Operator can create a Google Cloud API key with Places + PageSpeed enabled.
2. Operator has/can create an Airtable PAT.
3. Default schedule cadence = daily (adjustable).
