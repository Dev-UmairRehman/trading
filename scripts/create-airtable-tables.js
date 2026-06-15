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
