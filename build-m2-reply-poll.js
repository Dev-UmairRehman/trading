// build-m2-reply-poll.js — CLI-runnable reply checker (no Gmail trigger).
// Lists recent inbound mail via the Gmail node, matches leads, classifies reply with Groq,
// records the classification in Airtable, and notifies operator ONLY when label is "Interested".
const fs = require('fs');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };

const replyClassify = fs.readFileSync(require('path').join(__dirname, 'lib', 'replyClassify.js'), 'utf8').replace(/^module\.exports\s*=.*$/m, '').trim();

const fromCode = `const j = $json;
const cands = [j.from, j.From, (j.headers && j.headers.from),
  (j.payload && j.payload.headers && (j.payload.headers.find(h => /^from$/i.test(h.name)) || {}).value)];
let raw = cands.find(Boolean) || '';
if (typeof raw === 'object') raw = JSON.stringify(raw);
const m = String(raw).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i);
return { json: { fromEmail: m ? m[0].toLowerCase() : '', subject: j.subject || j.Subject || '', snippet: j.snippet || j.text || j.textPlain || '' } };`;

const classifyPromptCode = `${replyClassify}
const f = $('From').item.json;
const lead = (($('Find Lead').item.json.records || [])[0] || {}).fields || {};
const messages = buildClassifyPrompt(lead, (f.subject || '') + '\\n' + (f.snippet || ''));
return { json: { messages, recordId: ($('Find Lead').item.json.records[0] || {}).id,
  business: lead.business_name || f.fromEmail, fromEmail: f.fromEmail, subject: f.subject, snippet: f.snippet } };`;

const classifyParseCode = `${replyClassify}
const c = $json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '';
const r = parseClassification(c);
const prev = $('Classify Prompt').item.json;
return { json: { ...prev, label: r.label, reason: r.reason } };`;

const notifyPromptCode = `const f = $('Classify Prompt').item.json;
const lead = (($('Find Lead').item.json.records || [])[0] || {}).fields || {};
const sys = 'You help Rehman handle inbound replies to cold outreach. Reply with ONLY JSON '
  + '{"summary":string,"suggested_reply":string}. summary: 1-2 sentences on what they want. '
  + 'suggested_reply: a short friendly reply Rehman can send.';
const usr = 'Business: ' + (lead.business_name || '?') + '\\nFrom: ' + f.fromEmail
  + '\\nSubject: ' + (f.subject || '') + '\\nMessage: ' + (f.snippet || '') + '\\n\\nReturn JSON now.';
return { json: { messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }],
  business: lead.business_name || f.fromEmail, fromEmail: f.fromEmail, subject: f.subject, snippet: f.snippet } };`;

const notifyBodyCode = `const c = $json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '';
let p = { summary: '', suggested_reply: '' };
try { const a = c.indexOf('{'), b = c.lastIndexOf('}'); if (a !== -1 && b > a) p = JSON.parse(c.slice(a, b + 1)); } catch (e) {}
const np = $('Notify Prompt').item.json;
const body = 'New reply from ' + np.business + '\\n\\nFrom: ' + np.fromEmail + '\\nSubject: ' + (np.subject || '')
  + '\\n\\nSummary: ' + (p.summary || np.snippet || '') + '\\n\\nSuggested reply:\\n' + (p.suggested_reply || '');
return { json: { subject: 'Hot lead replied: ' + np.business, body } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M2 - Reply Poll',
  nodes: [
    { parameters: {}, id: id('rpman'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 180] },
    { parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 2 }] } }, id: id('rpsched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 420] },
    { parameters: { resource: 'message', operation: 'getAll', returnAll: false, limit: 30,
      filters: { q: 'newer_than:2d -from:me -in:chats' }, options: { downloadAttachments: false } },
      id: id('rpget'), name: 'Get Recent Mail', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [220, 300], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: fromCode }, id: id('rpfrom'), name: 'From', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 300] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: "=LOWER({email})='{{ $json.fromEmail }}'" },
        { name: 'maxRecords', value: '1' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('rpfind'), name: 'Find Lead', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [660, 300], onError: 'continueRegularOutput' },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'f1', leftValue: '={{ ($json.records || []).length }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } },
    ] } }, id: id('rpif'), name: 'Found?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [880, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: classifyPromptCode }, id: id('rpcp'), name: 'Classify Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 240] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} }, id: id('rpcls'), name: 'Classify', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1320, 240], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: classifyParseCode }, id: id('rpcpr'), name: 'Parse Class', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 240] },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $json.recordId, fields: { replied: true, email_status: "Replied", reply_classification: $json.label, reply_text: $json.snippet } } ] }) }}',
      options: {} }, id: id('rprec'), name: 'Record Reply', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1760, 240], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'i1', leftValue: '={{ $json.label }}', rightValue: 'Interested', operator: { type: 'string', operation: 'equals' } },
    ] } }, id: id('rpint'), name: 'Interested?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1980, 240] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: notifyPromptCode }, id: id('rpprompt'), name: 'Notify Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2200, 440] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.3, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} }, id: id('rpgroq'), name: 'Suggest Reply', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2420, 440], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: notifyBodyCode }, id: id('rpbody'), name: 'Notify Body', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2640, 440] },
    { parameters: { sendTo: '={{ $env.NOTIFY_EMAIL }}', subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}', options: {} },
      id: id('rpnotify'), name: 'Notify Operator', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [2860, 440], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput' },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get Recent Mail', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get Recent Mail', type: 'main', index: 0 }]] },
    'Get Recent Mail': { main: [[{ node: 'From', type: 'main', index: 0 }]] },
    'From': { main: [[{ node: 'Find Lead', type: 'main', index: 0 }]] },
    'Find Lead': { main: [[{ node: 'Found?', type: 'main', index: 0 }]] },
    'Found?': { main: [[{ node: 'Classify Prompt', type: 'main', index: 0 }], []] },
    'Classify Prompt': { main: [[{ node: 'Classify', type: 'main', index: 0 }]] },
    'Classify': { main: [[{ node: 'Parse Class', type: 'main', index: 0 }]] },
    'Parse Class': { main: [[{ node: 'Record Reply', type: 'main', index: 0 }]] },
    'Record Reply': { main: [[{ node: 'Interested?', type: 'main', index: 0 }]] },
    'Interested?': { main: [[{ node: 'Notify Prompt', type: 'main', index: 0 }], []] },
    'Notify Prompt': { main: [[{ node: 'Suggest Reply', type: 'main', index: 0 }]] },
    'Suggest Reply': { main: [[{ node: 'Notify Body', type: 'main', index: 0 }]] },
    'Notify Body': { main: [[{ node: 'Notify Operator', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m2-reply-poll.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
