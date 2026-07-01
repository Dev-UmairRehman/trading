// build-price-comparison.js — generates the "Product Price Comparison" n8n workflow.
const fs = require('fs');
const path = require('path');
const GMAIL_CRED = { id: 'RE5KvrcKm8U95iWU', name: 'Gmail account' };
function libBody(name) {
  const src = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return src.replace(/^module\.exports\s*=.*$/m, '').trim();
}
const priceParse = libBody('priceParse.js');

const normalizeCode = `${priceParse}
return $input.all().map((it) => {
  const row = it.json || {};
  const name = pickProductName(row);
  return { json: Object.assign({}, row, { __productName: name }) };
}).filter((it) => it.json.__productName);`;

const buildQueriesCode = `const items = $input.all();
const rows = items.map((i) => i.json);
const queries = rows.map((r) => r.__productName).filter(Boolean);
return [{ json: { queries, rows } }];`;

const parseBatchCode = `${priceParse}
const bq = $('Build Queries').item.json;
const rows = bq.rows || [];
const offers = $input.all().map((i) => i.json);
const grouped = groupByQuery(offers);
const sd = $getWorkflowStaticData('global');
sd.rows = sd.rows || [];
for (const r of rows) {
  const name = r.__productName;
  const parsed = parseShoppingOffers(grouped[name] || []);
  const clean = Object.assign({}, r); delete clean.__productName;
  sd.rows.push(buildRow(clean, name, parsed));
}
return [{ json: { accumulated: sd.rows.length } }];`;

const assembleCode = `const sd = $getWorkflowStaticData('global');
const rows = sd.rows || [];
sd.rows = [];
if (!rows.length) return [{ json: { product_name: 'No products processed' } }];
return rows.map((r) => ({ json: r }));`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'Product Price Comparison',
  nodes: [
    { parameters: { path: 'price-comparison', formTitle: 'Product Price Comparison',
      formDescription: 'Upload a CSV/Excel of product names and enter your email. You will receive the updated file with competitor prices.',
      formFields: { values: [
        { fieldLabel: 'File', fieldType: 'file', acceptFileTypes: '.csv,.xlsx,.xls', requiredField: true },
        { fieldLabel: 'Email', fieldType: 'email', requiredField: true },
      ] }, options: {} },
      id: id('pcform'), name: 'Form Upload', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 300], webhookId: 'b7e6c1a2-3d4f-4a5b-8c9d-0e1f2a3b4d10' },
    { parameters: { rules: { values: [
      { conditions: { options: { caseSensitive: false, version: 2 }, combinator: 'and', conditions: [
        { leftValue: '={{ $binary.File.fileExtension }}', rightValue: 'csv', operator: { type: 'string', operation: 'equals' } },
      ] }, outputKey: 'csv' },
    ] }, options: { fallbackOutput: 'extra' } },
      id: id('pcsw'), name: 'Detect Type', type: 'n8n-nodes-base.switch', typeVersion: 3, position: [220, 300] },
    { parameters: { operation: 'csv', binaryPropertyName: 'File', options: {} },
      id: id('pccsv'), name: 'Extract CSV', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [440, 200] },
    { parameters: { operation: 'xlsx', binaryPropertyName: 'File', options: {} },
      id: id('pcxlsx'), name: 'Extract XLSX', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: [440, 400] },
    { parameters: { jsCode: normalizeCode }, id: id('pcnorm'), name: 'Normalize', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 300] },
    { parameters: { batchSize: 20, options: {} }, id: id('pcbatch'), name: 'Split In Batches', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: [880, 300] },
    { parameters: { jsCode: buildQueriesCode }, id: id('pcbq'), name: 'Build Queries', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 200] },
    { parameters: { method: 'POST', url: 'https://api.apify.com/v2/acts/automation-lab~google-shopping-scraper/run-sync-get-dataset-items',
      sendQuery: true, queryParameters: { parameters: [{ name: 'token', value: '={{ $env.APIFY_API_TOKEN }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ queries: $json.queries }) }}',
      options: { timeout: 290000 } },
      id: id('pcapify'), name: 'Apify Shopping', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1320, 200], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { jsCode: parseBatchCode }, id: id('pcparse'), name: 'Parse Batch', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1540, 200] },
    { parameters: { amount: 3, unit: 'seconds' }, id: id('pcwait'), name: 'Wait', type: 'n8n-nodes-base.wait', typeVersion: 1.1, position: [1760, 200] },
    { parameters: { jsCode: assembleCode }, id: id('pcasm'), name: 'Assemble Rows', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 460] },
    { parameters: { operation: 'xlsx', binaryPropertyName: 'data', options: { fileName: 'price-comparison.xlsx', sheetName: 'Prices' } },
      id: id('pctofile'), name: 'To XLSX', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1, position: [1320, 460] },
    { parameters: { sendTo: '={{ $(\'Form Upload\').item.json.Email }}', subject: 'Your product price comparison is ready',
      emailType: 'text', message: 'Attached is your product list with Google Shopping prices (google price + competitor sites/prices).\\n\\nRehman', options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } } },
      id: id('pcmail'), name: 'Email File', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1540, 460], credentials: { gmailOAuth2: GMAIL_CRED }, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 },
  ],
  connections: {
    'Form Upload': { main: [[{ node: 'Detect Type', type: 'main', index: 0 }]] },
    'Detect Type': { main: [[{ node: 'Extract CSV', type: 'main', index: 0 }], [{ node: 'Extract XLSX', type: 'main', index: 0 }]] },
    'Extract CSV': { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
    'Extract XLSX': { main: [[{ node: 'Normalize', type: 'main', index: 0 }]] },
    'Normalize': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
    'Split In Batches': { main: [[{ node: 'Assemble Rows', type: 'main', index: 0 }], [{ node: 'Build Queries', type: 'main', index: 0 }]] },
    'Build Queries': { main: [[{ node: 'Apify Shopping', type: 'main', index: 0 }]] },
    'Apify Shopping': { main: [[{ node: 'Parse Batch', type: 'main', index: 0 }]] },
    'Parse Batch': { main: [[{ node: 'Wait', type: 'main', index: 0 }]] },
    'Wait': { main: [[{ node: 'Split In Batches', type: 'main', index: 0 }]] },
    'Assemble Rows': { main: [[{ node: 'To XLSX', type: 'main', index: 0 }]] },
    'To XLSX': { main: [[{ node: 'Email File', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};
const out = process.argv[2] || 'workflows/price-comparison.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
