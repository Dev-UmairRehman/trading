// build-m6-voice-suggester.js — gate top leads for a voice call + ask operator to approve.
// Free (no Bland call here). The actual call is placed by M6 - Voice Caller only after
// the operator ticks `voice_approved` in Airtable (guarded-autonomy gate, no Telegram).
const fs = require('fs');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

// Gate: score>90, has phone, email sequence exhausted, no reply, WhatsApp already tried, not yet suggested.
const GATE = "AND({lead_score}>=90,{phone},{email_stage}>=4,NOT({replied}),{wapi_prompted},NOT({voice_suggested}))";

const expandCode = `const recs = ($json.records) || [];
return recs.map((r) => ({ json: { recordId: r.id, fields: r.fields } }));`;

const composeCode = `const f = $json.fields || {};
const subject = 'Approve voice call? ' + (f.business_name || 'lead') + ' (score ' + (f.lead_score || '') + ')';
const body = [
  'This lead qualifies for an AI voice call (score > 90, email + WhatsApp already tried, no reply).',
  '', 'Business: ' + (f.business_name || ''),
  'Phone: ' + (f.phone || ''),
  'Website: ' + (f.website || '(none)'),
  'Findings: ' + (f.ai_findings || ''),
  '', 'A voice call costs money, so it needs your approval.',
  'TO APPROVE: open the Airtable Leads table, find this business, and tick the "voice_approved" box.',
  'The Voice Caller will place the call on its next run. Leave it unticked to skip.',
].join('\\n');
return { json: { recordId: $json.recordId, subject, body } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M6 - Voice Suggester',
  nodes: [
    { parameters: {}, id: id('m6sman'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } }, id: id('m6ssch'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: `=${GATE}` },
        { name: 'maxRecords', value: '25' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m6sget'), name: 'Get Top Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m6sexp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: composeCode }, id: id('m6scomp'), name: 'Compose', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('m6smail'), name: 'Email Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [900, 300], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput' },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ records: [ { id: $(\'Compose\').item.json.recordId, fields: { voice_suggested: true } } ] }) }}',
      options: {} }, id: id('m6supd'), name: 'Mark Suggested', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get Top Leads', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get Top Leads', type: 'main', index: 0 }]] },
    'Get Top Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Compose', type: 'main', index: 0 }]] },
    'Compose': { main: [[{ node: 'Email Operator', type: 'main', index: 0 }]] },
    'Email Operator': { main: [[{ node: 'Mark Suggested', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m6-voice-suggester.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
