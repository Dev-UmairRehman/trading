# Global Lead Outreach + Human Handoff — Design Spec

**Date:** 2026-06-15
**Project:** Lead-gen n8n system (Desktop\N8N)
**Operator email (handoff target):** rehmanumair1912@gmail.com

## Goal

Turn the existing lead pipeline into a "machine qualifies → human closes" system:
find contactable leads globally (any business type, any region), email them
automatically, and hand the warm/actionable ones to the operator for a personal
close — while protecting email deliverability.

## Non-goals (YAGNI)

- No region targeting or per-country logic — search is global by design.
- No CRM beyond Airtable.
- No automated phone/WhatsApp *sending* — phone follow-up is manual by the operator.
- No dedicated sending-domain migration in this phase (flagged as a recommendation only).

## Contactability model

Every lead is routed by what we can reach it on. M1 already captures `has_email`
and `has_phone`; we make these drive routing and scoring.

| email | phone | Route |
|-------|-------|-------|
| ✅ | ✅ | **Full pipeline** — email now; if no reply, hand phone to operator |
| ✅ | ❌ | Email pipeline only (no phone fallback) |
| ❌ | ✅ | Straight to operator manual list (cannot email) |
| ❌ | ❌ | Stored only, no action (low priority) |

**Scoring:** leads with both email + phone get a priority boost so the pipeline
spends effort where conversion is possible. Leads with neither are deprioritized.

## Pipeline stages

### Stage 1 — Capture (M1 - Lead Analysis Pipeline, revised)
- Replace the single hardcoded query (`dentist in Manchester`) with a **rotating
  target list** of `{business_type} in {city}` combinations spanning many verticals
  and global cities. One (or a few) combos run per scheduled execution, cycling
  through the list over days.
- Keep the existing scrape → PageSpeed → HTML signals → AI review → scoring →
  Apollo enrich → Airtable upsert flow.
- Add `contactability` derivation (both/email/phone/none) to the assembled record.
- Boost `lead_score` when `has_email && has_phone`.

### Stage 2 — Cold email (M2 - Outreach Sender, revised)
- Select from Airtable only leads where `has_email = true` AND status = `New`
  (respecting the daily cap, see Deliverability).
- Compose with existing stage-aware `emailCopy` (personalized to the gap M1 found,
  plain text, one CTA, no hype words).
- Send, then set status = `Contacted` and stamp `last_contacted_at`.
- Follow-up sequence (initial / +3d / +6d / +10d breakup) continues while status
  stays `Contacted` and no reply arrives.

### Stage 3 — Reply handling (M2 - Reply Watcher + AI classifier)
- Reply Watcher polls the inbox for replies tied to contacted leads.
- Each reply is passed to an **AI classifier** → label `Interested` /
  `NotInterested` / `Question`.
- Set status = `Replied` and store the classification + reply text on the lead.
- **If `Interested`** → email the operator (rehmanumair1912@gmail.com) with:
  business name, the reply text, classification, contact details, lead score.
  This is the "they want the product — go close" alert.
- `NotInterested` / `Question` are recorded but do **not** alert (per decision:
  AI classifies, only Interested alerts).

### Stage 4 — Manual handoff for non-responders (new: Manual Follow-up Dispatcher)
- Trigger: lead status = `Contacted`, the email sequence is exhausted
  (breakup sent, no reply), AND `has_phone = true`.
- Action: email the operator (rehmanumair1912@gmail.com) with the **phone number**,
  a **ready-to-send message** (short pitch the operator can paste into a call/WhatsApp),
  and full lead details.
- Mark the lead `HandedOff` (or a `manual_dispatched` flag) so it is emailed once only.
- Phone-only leads (no email) are dispatched here directly without waiting on the
  email sequence.

## Deliverability / anti-spam controls

1. **Daily send cap** — start low (~20–30/day) and ramp; the sender stops once the
   cap is hit and resumes next run.
2. **Plain-text first email**, no links or images on first touch.
3. **Randomized delay** between sends (human-like cadence, not a burst).
4. **Spam-word filter** — already enforced in the `emailCopy` system prompt
   (no "free/guarantee/act now"); keep and extend.
5. **Real signature + sign-off** ("Rehman") and a plain opt-out line.
6. **Recommendation (not in this phase):** move bulk sending to a dedicated domain
   with SPF/DKIM/DMARC configured, rather than personal Gmail, before scaling volume.

## Airtable schema changes

Add to the `Leads` table:
- `contactability` — singleSelect: `both` / `email_only` / `phone_only` / `none`
- `last_contacted_at` — date/string
- `reply_classification` — singleSelect: `Interested` / `NotInterested` / `Question`
- `reply_text` — multilineText
- `manual_dispatched` — checkbox (operator handoff sent)
- Extend `status` choices with `HandedOff`

## Components & boundaries

- **lib/contactability.js** (new, pure) — derive route + score boost from
  `has_email`/`has_phone`. Unit-testable, no network.
- **lib/replyClassify.js** (new, pure) — build the AI classify prompt + parse the
  label out of the model response. No network.
- **lib/emailCopy.js** (existing) — unchanged interface; may add a "manual message"
  builder for the operator handoff text.
- **M1 build script** — add rotating target list + contactability/scoring.
- **M2 sender build script** — add daily cap + send throttle + status stamping.
- **M2 reply watcher build script** — add AI classify node + Interested→operator alert.
- **Manual Follow-up Dispatcher build script** (new) — Stage 4.

## Testing

- Unit tests for `contactability.js` (all four routes + score boost) and
  `replyClassify.js` (prompt shape + parsing of each label, malformed input).
- Build scripts validated by generating the workflow JSON and checking node/connection
  counts (existing pattern in the repo).

## Open recommendation

Personal Gmail is fine for low daily volume but will throttle/spam-flag under global
scale. Dedicated domain + auth records is the next step once volume justifies it.
