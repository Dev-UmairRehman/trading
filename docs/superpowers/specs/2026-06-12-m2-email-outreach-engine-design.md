# Milestone 2 — Email Outreach Engine — Design Spec

**Date:** 2026-06-12
**Status:** Draft for approval
**Depends on:** M1 (Lead Analysis Pipeline) — live, Airtable `Leads` populated with scored/classified leads.

---

## 1. Purpose

Autonomously contact Warm + Hot leads by email, run a 3-step follow-up sequence, stop instantly on
any reply, and flag replied leads as Hot — all while protecting the sending Gmail with a hard daily
cap and a kill switch. Cold leads are never emailed (stored only). No paid channels.

**Locked decisions (operator):**
- **Send mode:** auto-send via Gmail node from `muhammadshahkar1912@gmail.com`, with caps + kill switch.
- **Daily cap:** 30 sends/day.
- **Cadence:** Initial → FU#1 (+3d) → FU#2 (+6d) → FU#3 (+10d). Any reply stops the sequence.
- **Tracking:** reply-only (no open/click pixels — protects deliverability).

## 2. The one unavoidable manual step

Auto-sending from a personal Gmail requires an OAuth2 refresh token, which can only be minted through
Google's browser consent flow. So **once**, the operator links a **Gmail OAuth2 credential** in the
n8n UI for `muhammadshahkar1912@gmail.com` (scopes `gmail.send`, `gmail.modify`). Everything else stays
autonomous. Until this is done and the operator flips the kill switch on, **zero emails send**.

## 3. Architecture — two workflows

### 3.1 `M2 - Outreach Sender` (schedule, daily 10:00 — after M1's 09:00 discovery)
```
[Schedule 10:00] → [HTTP: read Config row] → IF send_enabled
  → [HTTP: count Leads emailed today]  → compute remaining = cap - sentToday; stop if <= 0
  → [HTTP: query DUE leads]  (Warm/Hot, has_email, not replied, email_stage<4,
                              email_stage=0 OR next_email_at <= now)  limit = remaining
  → [Split] per lead:
      → [Code: pick template for email_stage] → [Groq: personalize copy]
      → [Gmail: send] → [HTTP: update Lead]  (email_stage++, last_email_at, next_email_at, email_status)
```

### 3.2 `M2 - Reply Watcher` (Gmail Trigger, polling every minute)
```
[Gmail Trigger: new inbound] → [Code: extract from-address]
  → [HTTP: find Lead by email] → IF found
      → [HTTP: update Lead]  (replied=true, email_status='Replied', classification='Hot')
      → [Groq: summarize + suggest reply] → [Gmail: notify operator at NOTIFY_EMAIL]
```
Because the Sender filters `replied=false`, marking a lead replied **halts its sequence** automatically.

## 4. CRM changes — new fields on `Leads`
| Field | Type | Meaning |
|---|---|---|
| email_stage | number (0–4) | 0 not started, 1 initial sent, 2 FU#1, 3 FU#2, 4 FU#3/done |
| last_email_at | dateTime | when the last send happened |
| next_email_at | dateTime | when the next step is due |
| email_status | single select | Not contacted / Sent / Replied / Completed |
| replied | checkbox | inbound reply received (stops sequence) |
| last_email_subject | text | audit |
| last_email_body | long text | audit |

New **`Config`** table (single row): `send_enabled` (checkbox — the **kill switch**), `daily_cap` (number, default 30).

## 5. Daily cap + kill switch (safety)
- **Kill switch:** Sender's first step reads `Config.send_enabled`; if false, it exits before sending anything. Operator flips it in Airtable to instantly pause all outreach.
- **Daily cap:** Sender counts `Leads` with `last_email_at` = today, sends at most `daily_cap - sentToday`. Cap enforced per run; the daily schedule + the count make it self-limiting even across manual runs.
- **Warm-up ramp (recommended):** start `daily_cap` at 10 for the first week, then raise to 30, to build sender reputation. Operator-controlled via the Config row.

## 6. AI personalization
One Groq call per send, stage-aware prompt. Inputs: `business_name`, `category`, `location`,
`website`/`has_website`, `ai_findings`, `ai_rationale`, `classification`. Output: `{subject, body}`.
- **Initial:** lead with the specific observation from M1's analysis (e.g. "your site isn't mobile-friendly" / "you have no website"), one concrete value offer, soft CTA. Plain text, 4–6 sentences, no spammy phrasing, signed as Rehman.
- **FU#1:** short bump, new angle (a second opportunity).
- **FU#2:** social-proof / case-style one-liner.
- **FU#3:** brief breakup email ("should I close your file?").
Every email personalized; a tested `lib/emailCopy.js` builds the prompts + parses `{subject, body}`.

## 7. Error handling
Reuse M1's `M2`-shared error pattern: each external node retries (3×) + `continueRegularOutput`; the
existing `M1 - Error Handler` (or an M2 equivalent) logs failures to Airtable `Errors`. A Gmail send
failure for one lead must not halt the batch. Bounces (5xx) → set `email_status` accordingly, stop that
lead's sequence.

## 8. Credentials (mostly reused; one new)
- **Gmail OAuth2** (NEW, manual, one-time) — send + read for reply watcher.
- Airtable (`$env.AIRTABLE_PAT`), Groq (`$env.GROQ_API_KEY`) — reused, credential-free via HTTP nodes as in M1.
- Sender/notify inboxes unchanged (`muhammadshahkar1912@` sends; `rehmanumair1912@` notified).

## 9. Testing plan (no real sends until the end)
1. **Unit:** `lib/emailCopy.js` — prompt builder per stage + `{subject,body}` parser (TDD, like M1).
2. **Cap logic (unit):** a pure `lib/sendPlan.js` that, given (cap, sentToday, dueLeads), returns who to send — test the math.
3. **Dry-run:** run Sender with `send_enabled=false` → verify it exits sending nothing.
4. **Single live test:** add ONE test lead with the operator's own email, `send_enabled=true`,
   `daily_cap=1` → confirm exactly one real email arrives, Airtable updates `email_stage=1`/`next_email_at`.
5. **Stop-on-reply:** reply to that email → Reply Watcher marks the lead `replied`, Sender skips it next run.
6. **Cap enforcement:** set cap=1, two due leads → only one sends.

## 10. Scope guardrails (YAGNI)
- No WhatsApp/voice/LinkedIn (M3/M5/M6). No open/click tracking. No dashboard (later).
- Notifications here are minimal (operator email on reply); the full multi-channel notification system is M4.
- Contact-form / LinkedIn fallback for leads with no email is M3 — M2 only emails leads that HAVE an email.

## 11. Definition of done
- Unit tests green for `emailCopy` + `sendPlan`.
- Dry-run sends nothing with kill switch off.
- One controlled live email verified to the operator's own address; Airtable state advances.
- Reply detection flips the lead to Replied/Hot and halts the sequence.
- Cap respected. No sends to Cold leads or leads without an email.
