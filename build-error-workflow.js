// build-error-workflow.js
const fs = require('fs');
const id = (s) => s.padEnd(36, '0').slice(0, 36);
const logCode = `const e = $input.first().json;
return [{ json: {
  workflow: e.workflow?.name || 'unknown',
  node: e.execution?.lastNodeExecuted || '',
  message: (e.execution?.error?.message) || JSON.stringify(e.execution?.error || {}).slice(0,500),
  payload: JSON.stringify(e).slice(0, 1000),
  at: new Date().toISOString(),
} }];`;
const wf = {
  name: 'M1 - Error Handler',
  nodes: [
    { parameters: {}, id: id('errtrig-1'), name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 300] },
    { parameters: { jsCode: logCode }, id: id('errfmt-1'), name: 'Format Error', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 300] },
    { parameters: { method: 'POST', url: '=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Errors',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ typecast: true, records: [ { fields: { workflow: $json.workflow, node: $json.node, message: $json.message, payload: $json.payload, at: $json.at } } ] }) }}',
      options: {} },
      id: id('errair-1'), name: 'Log to Airtable', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [480, 300], onError: 'continueRegularOutput' },
  ],
  connections: {
    'Error Trigger': { main: [[{ node: 'Format Error', type: 'main', index: 0 }]] },
    'Format Error': { main: [[{ node: 'Log to Airtable', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};
fs.writeFileSync(process.argv[2] || 'workflows/m1-error-handler.json', JSON.stringify(wf, null, 2));
console.log('wrote error handler -', wf.nodes.length, 'nodes');
