# Milestone 2 — Email Outreach Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Autonomously email Warm/Hot leads (initial + 3 follow-ups, +3/+6/+10 days), stop on reply, flag replies Hot, with a 30/day cap + kill switch — sending via the existing Gmail OAuth credential.

**Architecture:** Same pattern as M1 — tested `lib/*.js` embedded into n8n Code nodes by builder scripts; HTTP nodes for Airtable (`$env.AIRTABLE_PAT`) and Groq (`$env.GROQ_API_KEY`); Gmail node uses the pre-linked credential id `RE5KvrcKm8U95iWU` ("Gmail account"). Two workflows: Sender (daily 10:00) + Reply Watcher (Gmail trigger).

**Spec:** `docs/superpowers/specs/2026-06-12-m2-email-outreach-engine-design.md`

**Safety:** Deploys with `Config.send_enabled = false` (kill switch off). Verified by dry-run + ONE self-addressed test email before any real outreach.

---

## File Structure
```
lib/emailCopy.js        # build stage-aware Groq prompt + parse {subject, body}
lib/sendPlan.js         # pure cap math: who to send given (cap, sentToday, dueLeads)
test/emailCopy.test.js
test/sendPlan.test.js
scripts/create-airtable-m2.js   # add Config table + new Leads fields (idempotent)
build-m2-sender.js              # -> workflows/m2-sender.json
build-m2-reply-watcher.js       # -> workflows/m2-reply-watcher.json
```

---

## Task 1: `lib/sendPlan.js` (TDD)

**Files:** Create `lib/sendPlan.js`, `test/sendPlan.test.js`

- [ ] **Step 1: failing test**
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { remaining, nextEmailAt, stageToTemplate } = require('../lib/sendPlan');

test('remaining respects cap and todays sends', () => {
  assert.equal(remaining(30, 0), 30);
  assert.equal(remaining(30, 28), 2);
  assert.equal(remaining(30, 30), 0);
  assert.equal(remaining(30, 35), 0); // never negative
});

test('nextEmailAt adds cadence days by stage', () => {
  const base = new Date('2026-06-12T10:00:00Z').getTime();
  assert.equal(nextEmailAt(1, base), new Date('2026-06-15T10:00:00Z').toISOString()); // +3
  assert.equal(nextEmailAt(2, base), new Date('2026-06-18T10:00:00Z').toISOString()); // +6
  assert.equal(nextEmailAt(3, base), new Date('2026-06-22T10:00:00Z').toISOString()); // +10
  assert.equal(nextEmailAt(4, base), null); // sequence complete
});

test('stageToTemplate maps current stage to the email to send next', () => {
  assert.equal(stageToTemplate(0), 'initial');
  assert.equal(stageToTemplate(1), 'followup1');
  assert.equal(stageToTemplate(2), 'followup2');
  assert.equal(stageToTemplate(3), 'followup3');
  assert.equal(stageToTemplate(4), null);
});
```
- [ ] **Step 2: run, expect fail** — `node --test test/sendPlan.test.js`
- [ ] **Step 3: implement**
```js
// lib/sendPlan.js — pure send-planning helpers.
const CADENCE_DAYS = { 1: 3, 2: 6, 3: 10 }; // days added AFTER sending stage N
const TEMPLATES = ['initial', 'followup1', 'followup2', 'followup3'];

function remaining(cap, sentToday) {
  return Math.max(0, (cap || 0) - (sentToday || 0));
}
function nextEmailAt(newStage, fromMs) {
  const days = CADENCE_DAYS[newStage];
  if (!days) return null; // stage 4 => done
  return new Date(fromMs + days * 86400000).toISOString();
}
function stageToTemplate(currentStage) {
  return TEMPLATES[currentStage] || null;
}
module.exports = { remaining, nextEmailAt, stageToTemplate, CADENCE_DAYS };
```
- [ ] **Step 4: run, expect pass**
- [ ] **Step 5: commit** `feat: M2 send-planning helpers with tests` (+ co-author trailer)

---

## Task 2: `lib/emailCopy.js` (TDD)

**Files:** Create `lib/emailCopy.js`, `test/emailCopy.test.js`

- [ ] **Step 1: failing test**
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildEmailPrompt, parseEmail } = require('../lib/emailCopy');

const LEAD = { business_name: 'Acme Dental', category: 'dentist', location: 'Manchester',
  has_website: true, website: 'https://acme.com', ai_findings: 'no online booking; slow site',
  ai_rationale: 'Warm; medium conversion', classification: 'Warm' };

test('buildEmailPrompt is stage-aware and includes the business + findings', () => {
  const msgs = buildEmailPrompt(LEAD, 'initial');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /Acme Dental/);
  assert.match(msgs[1].content, /no online booking/);
  assert.match(msgs[1].content, /initial/i);
  assert.match(msgs[1].content, /Rehman/);
});

test('buildEmailPrompt breakup tone for followup3', () => {
  const msgs = buildEmailPrompt(LEAD, 'followup3');
  assert.match(msgs[1].content, /followup3|breakup|last/i);
});

test('parseEmail reads subject + body from JSON', () => {
  const r = parseEmail('{"subject":"Quick idea for Acme Dental","body":"Hi,\\n..."}');
  assert.equal(r.subject, 'Quick idea for Acme Dental');
  assert.ok(r.body.length > 0);
});

test('parseEmail tolerates fences and falls back safely', () => {
  const r = parseEmail('```json\\n{"subject":"S","body":"B"}\\n```');
  assert.equal(r.subject, 'S');
  const bad = parseEmail('no json here');
  assert.equal(bad.subject, '');
  assert.equal(bad.body, '');
});
```
- [ ] **Step 2: run, expect fail**
- [ ] **Step 3: implement**
```js
// lib/emailCopy.js — pure: build stage-aware Groq prompt + parse {subject, body}. No network.
const STAGE_GUIDE = {
  initial: 'First touch. Open with the SPECIFIC observation from the analysis. One concrete value offer. Soft CTA (a quick reply or 15-min call).',
  followup1: 'Short bump (3 days later). New angle / second opportunity. 2-3 sentences. Reference the first email lightly.',
  followup2: 'Value nudge (6 days later). One short proof point or mini case angle. Keep it brief.',
  followup3: 'Breakup email (10 days later). Polite "should I close your file?" tone. Very short. Easy out.',
};
function buildEmailPrompt(lead, stage) {
  const guide = STAGE_GUIDE[stage] || STAGE_GUIDE.initial;
  const system = 'You write concise, human, non-spammy B2B cold emails for Rehman, who sells website '
    + 'development, AI automation, and n8n automation to local businesses. Reply with ONLY JSON: '
    + '{"subject":string,"body":string}. Plain text body, 4-6 short sentences max, no emojis, no '
    + 'hypey words (free, guarantee, act now). Sign as "Rehman". Never invent facts about the business.';
  const user = `Stage: ${stage}\nGuidance: ${guide}\n\nBusiness: ${lead.business_name}\n`
    + `Type: ${lead.category || 'business'}\nLocation: ${lead.location || ''}\n`
    + `Has website: ${lead.has_website ? 'yes (' + (lead.website || '') + ')' : 'NO website'}\n`
    + `Analysis findings: ${lead.ai_findings || 'n/a'}\nWhy: ${lead.ai_rationale || ''}\n\n`
    + 'Write the JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
function parseEmail(content) {
  const fb = { subject: '', body: '' };
  if (!content) return fb;
  let t = String(content).trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f) t = f[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b < a) return fb;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return { subject: typeof o.subject === 'string' ? o.subject : '', body: typeof o.body === 'string' ? o.body : '' };
  } catch { return fb; }
}
module.exports = { buildEmailPrompt, parseEmail, STAGE_GUIDE };
```
- [ ] **Step 4: run, expect pass**
- [ ] **Step 5: commit** `feat: M2 stage-aware email copy builder + parser with tests`

---

## Task 3: Airtable schema for M2 (idempotent)

**Files:** Create `scripts/create-airtable-m2.js`

Adds the `Config` table (single control row) and the new `Leads` fields. Uses the field-create
endpoint `POST /v0/meta/bases/{base}/tables/{tableId}/fields` (idempotent: skip if the field name exists).

- [ ] **Step 1: implement**
```js
// scripts/create-airtable-m2.js
const fs = require('fs'); const path = require('path');
function readEnv(){const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const o={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/\s+#.*$/,'').trim();}return o;}
const env=readEnv(); const BASE=env.AIRTABLE_BASE_ID, PAT=env.AIRTABLE_PAT;
const H={Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'};
const NEW_LEAD_FIELDS=[
  {name:'email_stage',type:'number',options:{precision:0}},
  {name:'last_email_at',type:'dateTime',options:{timeZone:'utc',dateFormat:{name:'iso'},timeFormat:{name:'24hour'}}},
  {name:'next_email_at',type:'dateTime',options:{timeZone:'utc',dateFormat:{name:'iso'},timeFormat:{name:'24hour'}}},
  {name:'email_status',type:'singleSelect',options:{choices:[{name:'Not contacted'},{name:'Sent'},{name:'Replied'},{name:'Completed'}]}},
  {name:'replied',type:'checkbox',options:{icon:'check',color:'greenBright'}},
  {name:'last_email_subject',type:'singleLineText'},
  {name:'last_email_body',type:'multilineText'},
];
const CONFIG_FIELDS=[
  {name:'key',type:'singleLineText'},
  {name:'send_enabled',type:'checkbox',options:{icon:'check',color:'greenBright'}},
  {name:'daily_cap',type:'number',options:{precision:0}},
];
async function tables(){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{headers:H});if(!r.ok)throw new Error(await r.text());return (await r.json()).tables;}
async function addField(tableId,f){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`,{method:'POST',headers:H,body:JSON.stringify(f)});if(r.ok){console.log('  + field',f.name);return;}const t=await r.text();if(/DUPLICATE|already/i.test(t)){console.log('  = field exists',f.name);return;}throw new Error(`field ${f.name}: ${t}`);}
async function createTable(name,fields){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{method:'POST',headers:H,body:JSON.stringify({name,fields})});if(!r.ok)throw new Error(await r.text());console.log('created table',name);return (await r.json()).id;}
(async()=>{
  let ts=await tables();
  const leads=ts.find(t=>t.name==='Leads'); if(!leads)throw new Error('Leads table missing - run M1 setup first');
  const have=new Set(leads.fields.map(f=>f.name));
  console.log('Leads: adding missing fields');
  for(const f of NEW_LEAD_FIELDS){ if(have.has(f.name)){console.log('  = field exists',f.name);} else await addField(leads.id,f); }
  let cfg=ts.find(t=>t.name==='Config');
  if(!cfg){ await createTable('Config',CONFIG_FIELDS); ts=await tables(); cfg=ts.find(t=>t.name==='Config'); }
  else console.log('Config table exists');
  // ensure a single control row exists (kill switch OFF, cap 10 for warm-up)
  const rec=await fetch(`https://api.airtable.com/v0/${BASE}/Config?maxRecords=1`,{headers:H}).then(r=>r.json());
  if(!rec.records || !rec.records.length){
    await fetch(`https://api.airtable.com/v0/${BASE}/Config`,{method:'POST',headers:H,body:JSON.stringify({records:[{fields:{key:'main',send_enabled:false,daily_cap:10}}]})});
    console.log('seeded Config row: send_enabled=false, daily_cap=10 (warm-up)');
  } else console.log('Config row exists');
  console.log('done');
})().catch(e=>{console.error(e.message);process.exit(1);});
```
- [ ] **Step 2: run** `node scripts/create-airtable-m2.js` → adds 7 fields + Config table + seed row
- [ ] **Step 3: run again** → all "= field exists" / "Config row exists" (idempotent)
- [ ] **Step 4: commit** `feat: M2 Airtable schema (Config + email fields)`

---

## Task 4: `build-m2-sender.js` — Sender workflow

**Files:** Create `build-m2-sender.js` → `workflows/m2-sender.json`

Node graph:
```
Schedule 10:00 → HTTP GET Config → IF send_enabled true
  → HTTP GET Leads emailed today (count) → Code "Plan" (remaining)
  → HTTP GET due leads (limited) → Split → per item:
      Code "Pick Stage" → HTTP Groq (copy) → Code "Parse Copy"
      → Gmail Send (cred RE5KvrcKm8U95iWU) → HTTP PATCH Lead (advance stage)
```
Key configs (embed `sendPlan`/`emailCopy` lib via the libBody pattern from `build-m1-workflow.js`):
- **Config GET:** `GET https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Config?maxRecords=1`, Authorization `=Bearer {{ $env.AIRTABLE_PAT }}`.
- **IF send_enabled:** condition boolean true on `={{ $json.records[0].fields.send_enabled }}`.
- **Count today:** `GET .../Leads?filterByFormula=IS_SAME({last_email_at},TODAY(),'day')&fields[]=place_id`; Code reads `records.length` as sentToday, `cap` from Config, computes `remaining` (lib `sendPlan.remaining`). If 0 → no due query.
- **Due leads:** `GET .../Leads?filterByFormula=` URL-encoded
  `AND(OR({classification}='Warm',{classification}='Hot'),NOT({replied}),{has_email},{email_stage}<4,OR({email_stage}=0,IS_BEFORE({next_email_at},NOW())))`
  `&maxRecords={{ remaining }}`. (maxRecords from prior Code via expression.)
- **Pick Stage (Code, per item):** `template = stageToTemplate(stage)`, `messages = buildEmailPrompt(fields, template)`; carry `recordId`, `stage`, `fields`.
- **Groq (HTTP):** as M1 (Authorization `=Bearer {{ $env.GROQ_API_KEY }}`, model llama-3.3-70b-versatile, json_object, `messages: $json.messages`).
- **Parse Copy (Code, per item):** `const e = parseEmail($json.choices[0].message.content)`; pass `subject`,`body` + recordId + stage forward.
- **Gmail Send:** node `n8n-nodes-base.gmail` v2.1, params `{ sendTo: '={{ $json.email }}', subject: '={{ $json.subject }}', message: '={{ $json.body }}', emailType:'text', options:{} }`, `credentials: { gmailOAuth2: { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' } }`, `onError:'continueRegularOutput'`, retryOnFail 2.
- **PATCH Lead (HTTP):** `PATCH .../Leads`, body upsert by record id:
  `{{ JSON.stringify({ records:[{ id: $json.recordId, fields: { email_stage: $json.newStage, last_email_at: $json.nowIso, next_email_at: $json.nextIso, email_status: ($json.newStage>=4?'Completed':'Sent'), last_email_subject: $json.subject, last_email_body: $json.body } }], typecast:true }) }}`. The "Parse Copy" Code computes `newStage = stage+1`, `nowIso`, `nextIso = nextEmailAt(newStage, Date.now())`.

- [ ] Implement builder, run `node build-m2-sender.js workflows/m2-sender.json`, validate JSON + syntax-check all Code nodes (as in M1 Task 6).
- [ ] Commit `feat: build M2 sender workflow`.

---

## Task 5: `build-m2-reply-watcher.js` — Reply Watcher

**Files:** Create `build-m2-reply-watcher.js` → `workflows/m2-reply-watcher.json`

```
Gmail Trigger (poll 1m, cred RE5KvrcKm8U95iWU) → Code "From" (extract sender email)
  → HTTP GET Lead by email → IF found
      → HTTP PATCH Lead (replied=true, email_status='Replied', classification='Hot')
      → HTTP Groq (summary + suggested reply) → Gmail Send notify to {{ $env.NOTIFY_EMAIL }}
```
- **Gmail Trigger:** `n8n-nodes-base.gmailTrigger` v1, `pollTimes` every minute, `simple:false`, credential `RE5KvrcKm8U95iWU`.
- **From (Code):** parse `$json.from` / headers → bare email (regex), output `{ fromEmail }`.
- **Find Lead:** `GET .../Leads?filterByFormula=LOWER({email})='{{ $json.fromEmail.toLowerCase() }}'&maxRecords=1`.
- **IF found:** `={{ $json.records && $json.records.length }}` > 0.
- **PATCH Lead:** by `records[0].id` → `{replied:true,email_status:'Replied',classification:'Hot'}`.
- **Groq:** summarize the inbound + suggest a 2-line reply (reuse Groq HTTP pattern).
- **Notify Gmail:** to `={{ $env.NOTIFY_EMAIL }}`, subject `=Reply from {{ business }}`, body = summary + suggested reply. Credential `RE5KvrcKm8U95iWU`. `onError:'continueRegularOutput'`.

- [ ] Implement, build, validate, commit `feat: build M2 reply watcher workflow`.

---

## Task 6: Deploy DISABLED + safe verification

- [ ] **Step 1:** `node scripts/create-airtable-m2.js` (live schema).
- [ ] **Step 2:** push both workflows via `scripts/push-workflow.js`. Do NOT activate the Sender yet.
- [ ] **Step 3 (dry-run):** with `Config.send_enabled=false`, CLI-execute the Sender → it must exit at the IF with **zero Gmail sends**. Confirm no email, no Lead changes.
- [ ] **Step 4 (single self-test):** temporarily insert ONE Lead with `email = rehmanumair1912@gmail.com`, `classification='Warm'`, `has_email=true`, `email_stage=0`; set `Config.send_enabled=true`, `daily_cap=1`. CLI-execute Sender → confirm exactly ONE real email arrives at that address, the test Lead advances to `email_stage=1` with `next_email_at` ~3 days out. Then set `send_enabled=false`, delete the test lead.
- [ ] **Step 5 (cap):** set `daily_cap=1` with 2 due test leads → only 1 sends.
- [ ] **Step 6:** activate Reply Watcher (safe — only reacts to inbound). Leave Sender deactivated until the operator opts in.
- [ ] **Step 7:** commit; append M2 runbook to SETUP.md (how to flip `send_enabled`, ramp `daily_cap` 10→30, activate Sender).

---

## Definition of done
- `node --test` green incl. emailCopy + sendPlan.
- Schema script idempotent; Config seeded `send_enabled=false`, `daily_cap=10`.
- Dry-run sends nothing. Single self-test sends exactly one real email + advances state. Cap respected.
- Reply Watcher flips a lead to Replied/Hot and halts its sequence.
- Sender left DISABLED pending operator opt-in (flip `send_enabled`). No sends to Cold / no-email leads.
