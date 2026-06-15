// build-m3-email-finder.js — recover emails for no-email leads; else queue for manual outreach.
const fs = require('fs');
const path = require('path');
function libBody(name) {
  const s = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return s.replace(/^module\.exports\s*=.*$/m, '').trim();
}
const htmlSignals = libBody('htmlSignals.js');
const emailFinder = libBody('emailFinder.js');

const DUE = "AND({has_website},NOT({has_email}),NOT({email_finder_done}))";

const expandCode = `const recs = ($json.records) || [];
return recs.map((r) => ({ json: {
  recordId: r.id, website: r.fields.website || '',
  business_name: r.fields.business_name || '', location: r.fields.location || '',
} }));`;

// runOnceForEachItem: scrape the fetched contact page for an email; always compute a LinkedIn search URL.
const scrapeCode = `${htmlSignals}
${emailFinder}
const lead = $('Expand').item.json;
const html = $json.data || $json.body || '';
const sig = extractHtmlSignals(html, lead.website || '');
const foundEmail = pickBestEmail(sig.emails);
const linkedinUrl = buildLinkedinSearchUrl(lead.business_name, lead.location);
return { json: { recordId: lead.recordId, business_name: lead.business_name, foundEmail, linkedinUrl } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M3 - Email Finder',
  nodes: [
    { parameters: {}, id: id('m3man'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 11 }] } }, id: id('m3sched'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendQuery: true, queryParameters: { parameters: [
        { name: 'filterByFormula', value: `=${DUE}` },
        { name: 'maxRecords', value: '50' },
      ] },
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      options: {} }, id: id('m3get'), name: 'Get No-Email Leads', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [240, 300], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
    { parameters: { jsCode: expandCode }, id: id('m3exp'), name: 'Expand', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300] },
    { parameters: { url: "={{ $json.website }}/contact", options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 } },
      id: id('m3fetch'), name: 'Fetch Contact', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [680, 300], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: scrapeCode }, id: id('m3scrape'), name: 'Scrape', type: 'n8n-nodes-base.code', typeVersion: 2, position: [900, 300] },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'e1', leftValue: '={{ $json.foundEmail }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
    ] } }, id: id('m3if'), name: 'Found Email?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1120, 300] },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $json.recordId, fields: { email: $json.foundEmail, has_email: true, email_finder_done: true, email_status: "Not contacted" } } ] }) }}',
      options: {} }, id: id('m3pf'), name: 'Save Email', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1360, 200], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { method: 'PATCH', url: `=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads`,
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { id: $json.recordId, fields: { manual_outreach: true, linkedin_search_url: $json.linkedinUrl, email_finder_done: true } } ] }) }}',
      options: {} }, id: id('m3pm'), name: 'Queue Manual', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1360, 400], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Get No-Email Leads', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Get No-Email Leads', type: 'main', index: 0 }]] },
    'Get No-Email Leads': { main: [[{ node: 'Expand', type: 'main', index: 0 }]] },
    'Expand': { main: [[{ node: 'Fetch Contact', type: 'main', index: 0 }]] },
    'Fetch Contact': { main: [[{ node: 'Scrape', type: 'main', index: 0 }]] },
    'Scrape': { main: [[{ node: 'Found Email?', type: 'main', index: 0 }]] },
    'Found Email?': { main: [[{ node: 'Save Email', type: 'main', index: 0 }], [{ node: 'Queue Manual', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', errorWorkflow: '3sNPCA6YTlyT9Nno' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/m3-email-finder.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
