# Milestones 3 + 4 — Email Discovery / Manual Queue + Notifications — Design Spec

**Date:** 2026-06-12
**Status:** Approved (operator chose: find-email + manual queue; email notifications, NO Telegram)

## Decisions
- **No Telegram.** All operator notifications go by **email to `rehmanumair1912@gmail.com`** (`NOTIFY_EMAIL`).
- **M3 = find-email + manual queue** (no auto contact-form submit, no LinkedIn automation — both unsafe/ToS).
- Both M3 + M4 use existing credentials only (Airtable `$env`, Groq `$env`, Gmail OAuth `RE5KvrcKm8U95iWU`).

## M3 — Email Finder & Manual Queue
**Purpose:** recover an email for leads M1 stored without one; if none can be found, queue them for manual outreach with everything the operator needs.

**Workflow `M3 - Email Finder` (schedule daily 11:00):**
```
Schedule → HTTP GET Leads (has_website, NOT has_email, NOT email_finder_done)
  → Split per lead → Code "Candidate URLs" (homepage + /contact + /contact-us + /about)
  → HTTP GET contact page (onError continue) → Code "Scrape Email" (reuse htmlSignals emails)
  → IF email found
       yes → HTTP PATCH Lead (email, has_email=true, email_finder_done=true)   # M2 will pick it up
       no  → HTTP PATCH Lead (manual_outreach=true, linkedin_search_url, email_finder_done=true)
```
- Email scraping reuses `lib/htmlSignals.extractHtmlSignals(...).emails` (role-based first, de-obfuscated).
- `linkedin_search_url` = a Google/LinkedIn people-search link built from business name + location (for manual lookup — no automation).
- `email_finder_done` prevents reprocessing the same lead daily.

**New `Leads` fields:** `email_finder_done` (checkbox), `manual_outreach` (checkbox), `linkedin_search_url` (url), `notified` (checkbox — used by M4).

**Airtable view (manual):** operator creates a "Manual Outreach" view filtered `manual_outreach = true` to work those leads by hand (contact-form = the `website`, plus `linkedin_search_url`).

## M4 — Hot Lead Notifier (email)
**Purpose:** alert the operator the moment a lead is Hot, so they can jump in.

**Workflow `M4 - Hot Lead Notifier` (schedule every 2h):**
```
Schedule → HTTP GET Leads (classification='Hot', NOT notified)
  → Split per lead → Code "Compose" (subject + body: business, score, findings, recommended action)
  → Gmail Send to NOTIFY_EMAIL (cred RE5KvrcKm8U95iWU) → HTTP PATCH Lead (notified=true)
```
- Replies are already notified by `M2 - Reply Watcher` (emails `NOTIFY_EMAIL` + suggested reply). M4 covers the "new Hot lead detected" trigger from the original notification spec.
- `notified` flag prevents duplicate alerts.

## Error handling
Reuse the `M1 - Error Handler` (`errorWorkflow` set on both). External nodes retry + `continueRegularOutput`.

## Testing
1. Unit: `lib/emailFinder.js` (candidate URL builder, LinkedIn search URL) — TDD.
2. M3 live: run against the 5 no-email dentists → each either gains an email or gets `manual_outreach=true` + `linkedin_search_url`; all get `email_finder_done=true`. Re-run = no reprocessing.
3. M4 live: insert a test Hot lead → one alert email to `rehmanumair1912@gmail.com`, lead marked `notified`. Re-run sends nothing.

## Out of scope (still blocked)
- **M5 WhatsApp/WAPI** — needs provider + API key; approval gate to be an Airtable `wapi_approved` checkbox + email alert (not Telegram).
- **M6 VAPI voice** — needs phone-number ID; gated score>90 + prior channels failed; same Airtable-checkbox approval.
