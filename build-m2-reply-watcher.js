// build-m2-reply-watcher.js — M2 Reply Watcher workflow.
// Gmail trigger on inbound mail -> match lead -> mark Replied/Hot (halts sequence)
// -> AI summary + suggested reply -> notify operator. Credential-free except Gmail.
const fs = require('fs');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

// runOnceForEachItem: pull a bare sender email + subject/snippet from the trigger item.
const fromCode = `const j = $json;
const cands = [j.from, j.From, (j.headers && j.headers.from),
  (j.payload && j.payload.headers && (j.payload.headers.find(h => /^from$/i.test(h.name)) || {}).value)];
let raw = cands.find(Boolean) || '';
if (typeof raw === 'object') raw = JSON.stringify(raw);
const m = String(raw).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i);
return { json: { fromEmail: m ? m[0].toLowerCase() : '', subject: j.subject || j.Subject || '', snippet: j.snippet || j.text || j.textPlain || '' } };`;

// runOnceForEachItem: build the Groq prompt to summarize + suggest a reply.
const notifyPromptCode = `const f = $('From').item.json;
const lead = (($('Find Lead').item.json.records || [])[0] || {}).fields || {};
const sys = 'You help Rehman handle inbound replies to cold outreach. Reply with ONLY JSON '
  + '{"summary":string,"suggested_reply":string}. summary: 1-2 sentences on what they want. '
  + 'suggested_reply: a short friendly reply Rehman can send.';
const usr = 'Business: ' + (lead.business_name || '?') + '\\nFrom: ' + f.fromEmail
  + '\\nSubject: ' + (f.subject || '') + '\\nMessage: ' + (f.snippet || '') + '\\n\\nReturn JSON now.';
return { json: { messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
  business: lead.business_name || f.fromEmail, fromEmail: f.fromEmail, subject: f.subject, snippet: f.snippet } };`;

// runOnceForEachItem: parse Groq + build the operator notification email.
const notifyBodyCode = `const c = $json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '';
let p = { summary: '', suggested_reply: '' };
try { const a = c.indexOf('{'), b = c.lastIndexOf('}'); if (a !== -1 && b > a) p = JSON.parse(c.slice(a, b + 1)); } catch (e) {}
const np = $('Notify Prompt').item.json;
const body = 'New reply from ' + np.business + '\\n\\nFrom: ' + np.fromEmail + '\\nSubject: ' + (np.subject || '')
  + '\\n\\nSummary: ' + (p.summary || np.snippet || '') + '\\n\\nSuggested reply:\\n' + (p.suggested_reply || '');
return { json: { subject: 'Hot lead replied: ' + np.business, body } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M2 - Reply Watcher',
  nodes: [
    { parameters: { pollTimes: { item: [{ mode: 'everyMinute' }] }, simple: false, filters: {} },
      id: id('rwtrig'), name: 'Gmail Trigger', type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1, position: [0, 300], credentials: { gmailOAuth2: GMAIL_CRED } },
    { parameters: { mode: 'runOnceForEachItem', jsCode: fromCode }, id: id('rwfrom'), name: 'From', type: 'n8n-nodes-base.code', typeVersion: 2, position: [220, 300] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: "=LOWER({email})='{{ $json.fromEmail }}'" },
        { name: 'maxRecords', value: '1' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('rwfind'), name: 'Find Lead', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [440, 300], onError: 'continueRegularOutput' },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'f1', leftValue: '={{ ($json.records || []).length }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } },
    ] } }, id: id('rwif'), name: 'Found?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [660, 300] },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $json.records[0].id, fields: { replied: true, email_status: "Replied", classification: "Hot" } } ] }) }}',
      options: {} }, id: id('rwmark'), name: 'Mark Replied', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [880, 240], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { mode: 'runOnceForEachItem', jsCode: notifyPromptCode }, id: id('rwprompt'), name: 'Notify Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 240] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.3, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} }, id: id('rwgroq'), name: 'Suggest Reply', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1320, 240], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: notifyBodyCode }, id: id('rwbody'), name: 'Notify Body', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 240] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('rwnotify'), name: 'Notify Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1760, 240], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput' },
  ],
  connections: {
    'Gmail Trigger': { main: [[{ node: 'From', type: 'main', index: 0 }]] },
    'From': { main: [[{ node: 'Find Lead', type: 'main', index: 0 }]] },
    'Find Lead': { main: [[{ node: 'Found?', type: 'main', index: 0 }]] },
    'Found?': { main: [[{ node: 'Mark Replied', type: 'main', index: 0 }], []] },
    'Mark Replied': { main: [[{ node: 'Notify Prompt', type: 'main', index: 0 }]] },
    'Notify Prompt': { main: [[{ node: 'Suggest Reply', type: 'main', index: 0 }]] },
    'Suggest Reply': { main: [[{ node: 'Notify Body', type: 'main', index: 0 }]] },
    'Notify Body': { main: [[{ node: 'Notify Operator', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m2-reply-watcher.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
