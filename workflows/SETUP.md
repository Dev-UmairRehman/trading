# n8n Workflows — Setup Guide

Three production-ready workflows. Import each JSON file into n8n, set env vars, activate.

## 1. Revoke the exposed key first

The n8n API key shared in chat is public. Go to **n8n → Settings → n8n API → Delete**, then create a new one and paste into `.env`.

## 2. Fill in `.env`

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `APOLLO_API_KEY` | apollo.io → Settings → Integrations → API |
| `LINKEDIN_ACCESS_TOKEN` | linkedin.com/developers → Create App → OAuth 2.0 token (w_member_social scope) |
| `LINKEDIN_PERSON_ID` | curl https://api.linkedin.com/v2/me with your token → use `id` field |
| `LEADS_SHEET_ID` / `POSTS_SHEET_ID` / `REPLIES_SHEET_ID` | Create 3 Google Sheets, copy ID from URL `/d/THIS_PART/edit` |

In n8n: **Settings → Variables** → add each one (n8n reads `$env.VAR_NAME` from these).

## 3. Import workflows

For each file in `workflows/`:
1. n8n → **Workflows → Import from File**
2. Pick the `.json`
3. Open each node with a red icon → connect credentials (Gmail OAuth, Google Sheets OAuth, Apollo Header Auth, LinkedIn Header Auth)
4. Toggle **Active** in the top right

## 4. What each one does

### `1-cold-email-outreach.json`
Every 6 hours → pulls 10 leads from Apollo (real estate CEOs by default — edit the query params) → Claude writes a personalized 4-sentence email → Gmail sends → logs to sheet.

**Tweak:** the Apollo query params node to change target industry/title.

### `2-linkedin-daily-poster.json`
Every day 9 AM → picks topic from a 7-day rotation → Claude writes a 150-220 word post → publishes to LinkedIn → logs to sheet.

**Tweak:** the `topics` array in the "Pick Topic" node.

### `3-auto-reply-proposal.json`
Every minute → checks new unread Gmail → Claude classifies intent (PROPOSAL_REQUEST / INTERESTED / QUESTION / etc.) → drafts the right reply → saves as Gmail **draft** (you review before sending).

**Safety:** drafts only, never auto-sends. Flip the node from `draft` to `send` once you trust it.

## 5. First-week checklist

- [ ] All env vars filled
- [ ] All 3 workflows imported and active
- [ ] Manually run workflow 1 once → check email landed
- [ ] Manually run workflow 2 once → check LinkedIn post
- [ ] Send yourself a test inquiry → check workflow 3 created a Gmail draft
- [ ] Watch the 3 Google Sheets fill up over 48 hours

## 6. Realistic targets

- **Week 1:** 50–100 emails sent, 7 daily LinkedIn posts, 5–10 inbound replies handled
- **Month 1:** 1–2 paying clients ($3K–$5K each) from outreach
- **Month 3:** 5–10 retainers if you keep the funnel running

This is the actual machine. Run it daily, refine the prompts, and the money compounds.

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

---

## Milestone 2 — Email Outreach Engine

**What it does:** every day at 10:00, `M2 - Outreach Sender` emails Warm/Hot leads that have an email
(initial → FU#1 +3d → FU#2 +6d → FU#3 +10d), AI-personalized from M1's analysis, sent from
`muhammadshahkar1912@gmail.com`. `M2 - Reply Watcher` watches the inbox; any reply marks the lead
**Replied + Hot** (which halts its sequence) and emails you a summary + suggested reply at
`rehmanumair1912@gmail.com`. Reply-only tracking (no pixels).

### GO LIVE = one checkbox
Outreach is OFF by default. In Airtable → **Config** table → the single row → tick **send_enabled**.
That's the master switch (kill switch). Untick it to instantly pause all sending.

### Daily cap + warm-up
**Config.daily_cap** caps sends/day (counted from `last_email_at`). It's seeded at **10** for sender
warm-up — raise to **30** after ~a week of clean sending. The Sender sends at most `cap - sentToday`.

### What gets emailed
Only leads where `classification` is Warm/Hot, `has_email` is true, `replied` is false, and
`email_stage < 4`. Cold leads and leads with no email are never emailed.

### Workflows / credentials
- `M2 - Outreach Sender` (id schedule 10:00) and `M2 - Reply Watcher` (Gmail trigger, polls 1/min).
- Both use the n8n **Gmail OAuth2** credential "Gmail account". If you ever re-create it, update the
  credential id in `build-m2-sender.js` / `build-m2-reply-watcher.js` (`GMAIL_CRED`) and rebuild.
- Airtable + Groq auth via `$env` (no UI credential needed), same as M1.

### Verified
Dry-run (switch off) sends nothing. A single self-test to the operator's own inbox sent exactly one
real email and advanced the lead to `email_stage=1`, `next_email_at` +3 days. Cap + kill switch enforced.

---

## Milestones 3 + 4 — Email Discovery / Manual Queue + Hot-Lead Notifications

**No Telegram** — all operator alerts go by email to `rehmanumair1912@gmail.com` (`NOTIFY_EMAIL`).

### `M3 - Email Finder` (daily 11:00)
For leads M1 stored with `has_website` but no email and `email_finder_done` unset: fetches the site's
`/contact` page, scrapes an email (role-based, de-obfuscated). If found → sets `email`, `has_email=true`
(so M2 then emails them). If not → sets `manual_outreach=true` + a `linkedin_search_url`. Marks
`email_finder_done=true` so leads aren't reprocessed. **Verified:** recovered emails for 3 of 5 test
dentists; the other 2 queued for manual outreach.

**Manual Outreach view:** in Airtable create a view filtered `manual_outreach = true`. Work those by
hand — the `website` is the contact-form target, `linkedin_search_url` opens a LinkedIn people search.

### `M4 - Hot Lead Notifier` (every 2h)
Emails `NOTIFY_EMAIL` whenever a lead is `classification = Hot` and not yet `notified` (then sets
`notified=true`). Replies are separately alerted by `M2 - Reply Watcher`. **Verified:** a test Hot lead
produced exactly one alert email and was de-duplicated on re-run.

### Still pending (need credentials)
- **M5 WhatsApp/WAPI** — provide the provider + API key. Approval gate will be an Airtable
  `wapi_approved` checkbox + email alert (not Telegram). Fires only when lead score > 80 / engaged.
- **M6 VAPI voice** — provide the VAPI phone-number ID. Gated score > 90 after email + WhatsApp fail.
