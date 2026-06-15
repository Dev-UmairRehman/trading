// build-m7-manual-dispatch.js — email the operator phone-reachable leads to call personally.
// Targets: not replied, has phone, not yet dispatched, AND email sequence done OR phone-only.
const fs = require('fs');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

const DUE_FORMULA = "AND(NOT({replied}),{has_phone},NOT({manual_dispatched}),OR({email_status}='Completed',{contactability}='phone_only'))";

const expandCode = `const recs = ($json.records) || [];
return recs.map((r) => ({ json: { recordId: r.id, fields: r.fields } }));`;

const composeCode = `const f = $json.fields || {};
const msg = [
  'Hi ' + (f.owner_name || 'there') + ', this is Rehman.',
  'I help businesses like ' + (f.business_name || 'yours') + ' with their website and automating',
  'lead handling. ' + (f.ai_findings ? 'I noticed: ' + f.ai_findings + '.' : '') ,
  'Could I show you a quick idea? Takes 10 minutes.',
].filter(Boolean).join(' ');
const body = [
  'CALL/WHATSAPP THIS LEAD (no email reply).', '',
  'Business: ' + (f.business_name || ''),
  'Phone: ' + (f.phone || '(none)'),
  'Email: ' + (f.email || '(none)'),
  'Location: ' + (f.location || ''),
  'Website: ' + (f.website || '(none)'),
  'Lead score: ' + (f.lead_score || '') + '  |  Classification: ' + (f.classification || ''),
  'Findings: ' + (f.ai_findings || ''),
  '', 'Suggested opener:', msg,
].join('\\n');
return { json: { recordId: $json.recordId, subject: 'Call this lead: ' + (f.business_name || 'unknown'), body } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M7 - Manual Follow-up Dispatcher',
  nodes: [
    { parameters: {}, id: id('m7man'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } }, id: id('m7sched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: `=${DUE_FORMULA}` },
        { name: 'maxRecords', value: '25' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m7get'), name: 'Get Manual Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m7exp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: composeCode }, id: id('m7comp'), name: 'Compose', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('m7mail'), name: 'Email Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [900, 300], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $(\'Compose\').item.json.recordId, fields: { manual_dispatched: true, status: "HandedOff" } } ] }) }}',
      options: {} }, id: id('m7upd'), name: 'Mark Dispatched', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get Manual Leads', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get Manual Leads', type: 'main', index: 0 }]] },
    'Get Manual Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Compose', type: 'main', index: 0 }]] },
    'Compose': { main: [[{ node: 'Email Operator', type: 'main', index: 0 }]] },
    'Email Operator': { main: [[{ node: 'Mark Dispatched', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m7-manual-dispatch.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
