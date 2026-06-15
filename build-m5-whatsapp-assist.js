// build-m5-whatsapp-assist.js — assisted-manual WhatsApp tier.
// For high-value/engaged leads, email the operator a pre-drafted message + a
// wa.me click-to-chat link so they send it personally. No WhatsApp API, no ban risk.
const fs = require('fs');
const path = require('path');
function libBody(name) {
  const s = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return s.replace(/^module\.exports\s*=.*$/m, '').trim();
}
const whatsapp = libBody('whatsapp.js');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

// Gate: has a phone, not yet prompted, and (score >= 80 OR replied).
const GATE = "AND({phone},NOT({wapi_prompted}),OR({lead_score}>=80,{replied}))";

const expandCode = `const recs = ($json.records) || [];
return recs.map((r) => ({ json: { recordId: r.id, fields: r.fields } }));`;

// runOnceForEachItem: build the WhatsApp message + wa.me link for this lead.
const buildCode = `${whatsapp}
const f = $json.fields || {};
const DEFAULT_CC = '44'; // configurable: target market country code
const phoneIntl = normalizePhone(f.phone, DEFAULT_CC);
const finding = String(f.ai_findings || '').split(';')[0].trim() || 'a couple of things about your online presence';
const message = 'Hi, this is Rehman. I came across ' + (f.business_name || 'your business')
  + ' and noticed ' + finding + '. I help local businesses with websites + automation that bring in more customers. '
  + 'Mind if I share 2-3 quick ideas?';
const waLink = buildWaLink(phoneIntl, message);
return { json: { recordId: $json.recordId, business_name: f.business_name || '', phone: f.phone || '', phoneIntl, message, waLink } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M5 - WhatsApp Assist',
  nodes: [
    { parameters: {}, id: id('m5man'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } }, id: id('m5sched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: `=${GATE}` },
        { name: 'maxRecords', value: '25' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m5get'), name: 'Get WA-Worthy Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m5exp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: buildCode }, id: id('m5build'), name: 'Build WA', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}',
      subject: '=WhatsApp this lead: {{ $json.business_name }}',
      emailType: 'text',
      message: '={{ "Tap to message " + $json.business_name + " on WhatsApp (sends from your own number):\\n\\n" + $json.waLink + "\\n\\nDrafted message:\\n" + $json.message + "\\n\\nPhone: " + $json.phone }}',
      options: {} },
      id: id('m5mail'), name: 'Email Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [900, 300], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ records: [ { id: $(\'Build WA\').item.json.recordId, fields: { wapi_prompted: true } } ] }) }}',
      options: {} }, id: id('m5upd'), name: 'Mark Prompted', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get WA-Worthy Leads', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get WA-Worthy Leads', type: 'main', index: 0 }]] },
    'Get WA-Worthy Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Build WA', type: 'main', index: 0 }]] },
    'Build WA': { main: [[{ node: 'Email Operator', type: 'main', index: 0 }]] },
    'Email Operator': { main: [[{ node: 'Mark Prompted', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m5-whatsapp-assist.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
