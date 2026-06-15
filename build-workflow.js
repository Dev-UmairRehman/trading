const fs = require('fs');

const TOKEN = process.env.APIFY_API_TOKEN || '';
const FORM_PATH = 'google-maps-leads';
const FORM_WEBHOOK_ID = 'b7e6c1a2-3d4f-4a5b-8c9d-0e1f2a3b4c5d';

const apifyBody =
  "={{ JSON.stringify({ searchStringsArray: [$json['Search Term']], locationQuery: $json['Location'], maxCrawledPlacesPerSearch: (Number($json['Max Results']) || 25), language: 'en', scrapePlaceDetailPage: true }) }}";

const summaryCode = `// Turn scraped Google Maps places into email leads + build a result screen.
const places = $input.all();
const leads = [];
for (const it of places) {
  const d = it.json || {};
  const emails = Array.isArray(d.emails) ? d.emails : (d.email ? [d.email] : []);
  for (const email of emails) {
    if (!email) continue;
    leads.push({
      companyName: d.title || d.name || '',
      email,
      website: d.website || '',
      phone: d.phone || d.phoneUnformatted || '',
      address: d.address || d.street || '',
      city: d.city || '',
      category: d.categoryName || (Array.isArray(d.categories) ? d.categories[0] : '') || '',
      googleMapsUrl: d.url || ''
    });
  }
}

// de-duplicate by email
const seen = new Set();
const unique = leads.filter(l => {
  const k = l.email.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

let html;
if (unique.length === 0) {
  html = '<p>Scraped ' + places.length + ' places but found no email addresses. Try a broader niche, a bigger location, or increase Max Results.</p>';
} else {
  html = '<p>Scraped ' + places.length + ' places and found <b>' + unique.length + '</b> email leads:</p><ul>' +
    unique.map(l => '<li><b>' + l.email + '</b> &mdash; ' + (l.companyName || 'Unknown')
      + (l.website ? ' (<a href="' + l.website + '">website</a>)' : '')
      + (l.phone ? ' &mdash; ' + l.phone : '') + '</li>').join('') +
    '</ul>';
}

return [{ json: { count: unique.length, placesScraped: places.length, leadsHtml: html, leads: unique } }];`;

const wf = {
  id: 'cq3fEnppNkhLt9Yj',
  name: 'Google Maps Email Scraper (Apify Leads)',
  nodes: [
    {
      parameters: {
        path: FORM_PATH,
        formTitle: 'Google Maps Lead Scraper',
        formDescription: 'Enter a niche and a location to scrape business emails from Google Maps.',
        formFields: {
          values: [
            { fieldLabel: 'Search Term', placeholder: 'e.g. dentist', requiredField: true },
            { fieldLabel: 'Location', placeholder: 'e.g. Amsterdam, Netherlands', requiredField: true },
            { fieldLabel: 'Max Results', fieldType: 'number', placeholder: '25', requiredField: false }
          ]
        },
        options: {}
      },
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Lead Scraper Form',
      type: 'n8n-nodes-base.formTrigger',
      typeVersion: 2.2,
      position: [0, 300],
      webhookId: FORM_WEBHOOK_ID
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.apify.com/v2/acts/lukaskrivka~google-maps-with-contact-details/run-sync-get-dataset-items',
        sendQuery: true,
        queryParameters: { parameters: [{ name: 'token', value: TOKEN }] },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: apifyBody,
        options: { timeout: 290000 }
      },
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Apify - Google Maps Email Extractor',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.4,
      position: [240, 300]
    },
    {
      parameters: { jsCode: summaryCode },
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Build Leads',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, 300]
    },
    {
      parameters: {
        operation: 'completion',
        respondWith: 'text',
        completionTitle: '={{ $json.count }} email leads found',
        completionMessage: '={{ $json.leadsHtml }}',
        options: {}
      },
      id: '77777777-7777-7777-7777-777777777777',
      name: 'Show Results',
      type: 'n8n-nodes-base.form',
      typeVersion: 1,
      position: [720, 300]
    }
  ],
  connections: {
    'Lead Scraper Form': { main: [[{ node: 'Apify - Google Maps Email Extractor', type: 'main', index: 0 }]] },
    'Apify - Google Maps Email Extractor': { main: [[{ node: 'Build Leads', type: 'main', index: 0 }]] },
    'Build Leads': { main: [[{ node: 'Show Results', type: 'main', index: 0 }]] }
  },
  settings: { executionOrder: 'v1' },
  pinData: {}
};

const out = process.argv[2];
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out);
