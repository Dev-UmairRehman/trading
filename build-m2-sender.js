// build-m2-sender.js — M2 Outreach Sender workflow.
// Reuses the lib modules (embedded into Code nodes) and the pre-linked Gmail
// OAuth credential. Credential-free for Airtable/Groq via $env; Gmail via cred id.
const fs = require('fs');
const path = require('path');
function libBody(name) {
  const s = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return s.replace(/^module\.exports\s*=.*$/m, '').trim();
}
const sendPlan = libBody('sendPlan.js');
const emailCopy = libBody('emailCopy.js');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

// Airtable formula: Warm/Hot, not replied, has email, stage<4, and due (stage 0 or next_email_at passed).
const DUE_FORMULA = "AND(OR({classification}='Warm',{classification}='Hot'),NOT({replied}),{has_email},OR({email_stage}=BLANK(),{email_stage}<4),OR({email_stage}=BLANK(),{email_stage}=0,IS_BEFORE({next_email_at},NOW())))";

// runOnceForAllItems: compute remaining quota from Config + today's send count.
const planCode = `${sendPlan}
const cfg = ($('Get Config').item.json.records[0] || {}).fields || {};
const cap = (typeof cfg.daily_cap === 'number') ? cfg.daily_cap : 10;
const sentToday = (($json.records) || []).length;
return { json: { remaining: remaining(cap, sentToday), cap, sentToday } };`;

// runOnceForAllItems: expand due leads into per-lead items, capped at `remaining`.
const expandCode = `const rem = ($('Plan').item.json.remaining) || 0;
const recs = (($json.records) || []).slice(0, rem);
return recs.map((r) => ({ json: {
  recordId: r.id,
  stage: (typeof r.fields.email_stage === 'number' ? r.fields.email_stage : 0),
  fields: r.fields,
} }));`;

// runOnceForEachItem: choose the template for this lead's stage + build the Groq prompt.
const pickCode = `${emailCopy}
${sendPlan}
const stage = $json.stage || 0;
const template = stageToTemplate(stage);
const messages = buildEmailPrompt($json.fields, template);
return { json: { ...$json, template, messages } };`;

// runOnceForEachItem: parse the Groq reply into subject/body + compute next-stage timing.
const parseCode = `${emailCopy}
${sendPlan}
const prev = $('Pick Stage').item.json;
const e = parseEmail($json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '');
const subject = e.subject || ('Quick idea for ' + (prev.fields.business_name || 'your business'));
const body = e.body || '';
const newStage = (prev.stage || 0) + 1;
const nowMs = Date.now();
return { json: {
  recordId: prev.recordId, email: prev.fields.email || '',
  subject, body, newStage,
  nowIso: new Date(nowMs).toISOString(), nextIso: nextEmailAt(newStage, nowMs),
} };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const A = '={{ $env.AIRTABLE_BASE_ID }}';
const wf = {
  name: 'M2 - Outreach Sender',
  nodes: [
    { parameters: {}, id: id('m2man'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 10 }] } }, id: id('m2sched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Config`,
      sendQuery: true, queryParameters: { parameters: [{ name: 'maxRecords', value: '1' }] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m2cfg'), name: 'Get Config', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [220, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'k1', leftValue: '={{ $json.records[0].fields.send_enabled }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
    ] } }, id: id('m2if'), name: 'Send Enabled?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [440, 300] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: "=IS_SAME({last_email_at},TODAY(),'day')" },
        { name: 'fields[]', value: 'place_id' },
        { name: 'maxRecords', value: '100' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m2cnt'), name: 'Count Today', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [660, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: planCode }, id: id('m2plan'), name: 'Plan', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: `=${DUE_FORMULA}` },
        { name: 'maxRecords', value: '={{ Math.max(1, $json.remaining) }}' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m2due'), name: 'Get Due Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1100, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m2exp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1320, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: pickCode }, id: id('m2pick'), name: 'Pick Stage', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 300] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.4, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} }, id: id('m2groq'), name: 'Write Email', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1760, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: parseCode }, id: id('m2parse'), name: 'Parse Copy', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1980, 300] },
    { parameters: { sendTo: '={{ $json.email }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('m2gmail'), name: 'Send Email', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [2200, 300], credentials: { gmailOAuth2: GMAIL_CRED }, retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $(\'Parse Copy\').item.json.recordId, fields: { email_stage: $(\'Parse Copy\').item.json.newStage, last_email_at: $(\'Parse Copy\').item.json.nowIso, next_email_at: $(\'Parse Copy\').item.json.nextIso, email_status: ($(\'Parse Copy\').item.json.newStage >= 4 ? "Completed" : "Sent"), last_email_subject: $(\'Parse Copy\').item.json.subject, last_email_body: $(\'Parse Copy\').item.json.body } } ] }) }}',
      options: {} }, id: id('m2upd'), name: 'Update Lead', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2420, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get Config', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get Config', type: 'main', index: 0 }]] },
    'Get Config': { main: [[{ node: 'Send Enabled?', type: 'main', index: 0 }]] },
    'Send Enabled?': { main: [[{ node: 'Count Today', type: 'main', index: 0 }], []] },
    'Count Today': { main: [[{ node: 'Plan', type: 'main', index: 0 }]] },
    'Plan': { main: [[{ node: 'Get Due Leads', type: 'main', index: 0 }]] },
    'Get Due Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Pick Stage', type: 'main', index: 0 }]] },
    'Pick Stage': { main: [[{ node: 'Write Email', type: 'main', index: 0 }]] },
    'Write Email': { main: [[{ node: 'Parse Copy', type: 'main', index: 0 }]] },
    'Parse Copy': { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
    'Send Email': { main: [[{ node: 'Update Lead', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m2-sender.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
