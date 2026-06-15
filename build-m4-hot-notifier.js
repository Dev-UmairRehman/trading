// build-m4-hot-notifier.js — email the operator when a lead becomes Hot.
const fs = require('fs');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

const expandCode = `const recs = ($json.records) || [];
return recs.map((r) => ({ json: { recordId: r.id, fields: r.fields } }));`;

// runOnceForEachItem: compose the alert email from the lead's fields.
const composeCode = `const f = $json.fields || {};
const subject = 'Hot lead: ' + (f.business_name || 'unknown') + ' (score ' + (f.lead_score || '') + ')';
const body = [
  'A lead just hit HOT.', '',
  'Business: ' + (f.business_name || ''),
  'Category: ' + (f.category || ''),
  'Location: ' + (f.location || ''),
  'Website: ' + (f.website || '(none)'),
  'Phone: ' + (f.phone || ''),
  'Email: ' + (f.email || '(none)'),
  'Lead score: ' + (f.lead_score || '') + '  |  Automation: ' + (f.automation_score || ''),
  '', 'Findings: ' + (f.ai_findings || ''),
  'Why / next: ' + (f.ai_rationale || ''),
  '', 'Recommended: review and reply personally if they engaged.',
].join('\\n');
return { json: { recordId: $json.recordId, subject, body } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M4 - Hot Lead Notifier',
  nodes: [
    { parameters: {}, id: id('m4man'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } }, id: id('m4sched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: "=AND({classification}='Hot',NOT({notified}))" },
        { name: 'maxRecords', value: '50' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m4get'), name: 'Get New Hot Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m4exp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: composeCode }, id: id('m4comp'), name: 'Compose', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('m4mail'), name: 'Email Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [900, 300], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ records: [ { id: $(\'Compose\').item.json.recordId, fields: { notified: true } } ] }) }}',
      options: {} }, id: id('m4upd'), name: 'Mark Notified', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get New Hot Leads', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get New Hot Leads', type: 'main', index: 0 }]] },
    'Get New Hot Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Compose', type: 'main', index: 0 }]] },
    'Compose': { main: [[{ node: 'Email Operator', type: 'main', index: 0 }]] },
    'Email Operator': { main: [[{ node: 'Mark Notified', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m4-hot-notifier.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
