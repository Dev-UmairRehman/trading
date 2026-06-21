// build-m1-workflow.js
const fs = require('fs');
const path = require('path');

// Read a lib module's source and strip its CommonJS export line so it can be
// pasted into an n8n Code node (which has no module system).
function libBody(name) {
  const src = fs.readFileSync(path.join(__dirname, 'lib', name), 'utf8');
  return src.replace(/^module\.exports\s*=.*$/m, '').trim();
}

const placesParser = libBody('placesParser.js');
const htmlSignals = libBody('htmlSignals.js');
const scoring = libBody('scoring.js');
const aiReview = libBody('aiReview.js');
const targets = libBody('targets.js');
const contactability = libBody('contactability.js');

// ---- Code node bodies (lib + glue) ----
const normalizeCode = `${placesParser}
const resp = $input.first().json;
const places = Array.isArray(resp.places) ? resp.places : [];
const multi = flagMultipleLocations(places);
return places.map((pl) => {
  const lead = parsePlace(pl);
  lead.lead_source = 'google_places';
  lead.multipleLocations = multi.has((lead.business_name || '').trim().toLowerCase());
  return { json: lead };
});`;

// Runs once PER ITEM after Fetch HTML. Finds the About/Team page URL to fetch next.
const findAboutCode = `${htmlSignals}
const lead = $('Normalize+Flag').item.json;
const home = $json.data || $json.body || '';
let aboutUrl = '';
try { aboutUrl = findAboutUrl(home, lead.website || ''); } catch (e) { aboutUrl = ''; }
return { json: { aboutUrl } };`;

// Runs once PER ITEM. Current input = Fetch About output; homepage via $('Fetch HTML').
const htmlSignalsCode = `${htmlSignals}
${aiReview}
const lead = $('Normalize+Flag').item.json;
const fh = $('Fetch HTML').item.json;
const html = fh.data || fh.body || '';
const about = $json.data || $json.body || '';
const finalUrl = lead.website || '';
let pagespeed = null;
try {
  const ps = $('PageSpeed').item.json;
  const cats = ps.lighthouseResult && ps.lighthouseResult.categories;
  if (cats) pagespeed = {
    mobilePerf: Math.round((cats.performance && typeof cats.performance.score === 'number' ? cats.performance.score : 0.5) * 100),
    seo: Math.round((cats.seo && typeof cats.seo.score === 'number' ? cats.seo.score : 0.7) * 100),
  };
} catch (e) { pagespeed = null; }
const sig = extractHtmlSignals(html, finalUrl);
const htmlRaw = (about ? ('--- ABOUT/TEAM PAGE ---\\n' + String(about).slice(0, 3500) + '\\n\\n') : '') + '--- HOMEPAGE ---\\n' + String(html).slice(0, 2500);
const messages = buildReviewPrompt(lead, htmlRaw);
return { json: { ...lead, html: sig, htmlRaw, pagespeed, messages } };`;

// Runs once PER ITEM. Current input = Groq output; paired ref for the lead+signals.
const parseAiCode = `${aiReview}
const prev = $('HTML Signals').item.json;
const content = $json.choices && $json.choices[0] && $json.choices[0].message ? $json.choices[0].message.content : '';
const ai = parseReview(content);
return { json: { ...prev, ai } };`;

// Runs once PER ITEM on the IF false-branch (current input IS the lead).
const noSiteCode = `const lead = $json;
return { json: { ...lead, html: null, ai: { outdated: false, opportunities: [], missingLeadCapture: [], summary: 'No website found.' }, pagespeed: null } };`;

// Runs once PER ITEM. Current input = Merge output (the lead+signals for this item).
const computeCode = `${scoring}
const d = $json;
const pagespeed = d.pagespeed || null;
const signals = {
  hasWebsite: Boolean(d.has_website),
  html: d.html || null,
  pagespeed,
  reviewCount: d.review_count || 0,
  hasSocial: Boolean(d.html && d.html.socialLinks && d.html.socialLinks.length) ,
  multipleLocations: Boolean(d.multipleLocations),
  aiOutdated: Boolean(d.ai && d.ai.outdated),
  aiOpportunities: (d.ai && d.ai.opportunities) || [],
  aiMissingLeadCapture: (d.ai && d.ai.missingLeadCapture) || [],
};
const year = new Date().getFullYear();
const scores = computeScores(signals, year);
const rationale = [
  d.ai && d.ai.summary,
  'Opportunities: ' + ((d.ai && d.ai.opportunities) || []).join(', '),
  'Conversion estimate: ' + (scores.classification === 'Hot' ? 'high' : scores.classification === 'Warm' ? 'medium' : 'low'),
  'Next action: ' + (scores.classification === 'Cold' ? 'store only' : 'queue for email outreach'),
].filter(Boolean).join('\\n');
return { json: { ...d, ...scores, has_social: signals.hasSocial, ai_findings: ((d.ai && d.ai.opportunities) || []).join('; '), ai_rationale: rationale } };`;

// Runs once PER ITEM. Lead+scores from Compute Scores (paired); current input = Apollo output.
const assembleCode = `${scoring}
${contactability}
const d = $('Compute Scores').item.json;
const enrich = $json || {};
const person = (enrich.person) || (Array.isArray(enrich.matches) ? enrich.matches[0] : null) || {};
const ai = d.ai || {};
const scrapedEmail = (d.html && Array.isArray(d.html.emails) && d.html.emails[0]) || '';
const email = person.email || ai.ownerEmail || scrapedEmail || '';   // Apollo, then owner email from site, then any scraped
const apolloName = [person.first_name, person.last_name].filter(Boolean).join(' ');
const owner = apolloName || ai.ownerName || '';   // Apollo person, else owner extracted from the website
const ownerRole = (!apolloName && ai.ownerRole) ? ai.ownerRole : (person.title || '');
const route = deriveContactability(Boolean(email), Boolean(d.phone));
const lead_score = Math.min(100, (d.lead_score || 0) + contactabilityBoost(route));
const classification = classify(lead_score);
return { json: { place_id: d.place_id, fields: {
  business_name: d.business_name, place_id: d.place_id, owner_name: owner || '',
  email, phone: d.phone || '', website: d.website || '', category: d.category || '',
  location: d.location || '', lead_source: 'google_places', has_website: Boolean(d.has_website),
  review_count: d.review_count || 0, website_score: d.website_score, automation_score: d.automation_score,
  lead_score, classification, contactability: route,
  pagespeed_mobile: d.pagespeed && typeof d.pagespeed.mobilePerf === 'number' ? d.pagespeed.mobilePerf : null,
  ai_findings: d.ai_findings || '',
  ai_rationale: (owner ? ('Contact: ' + owner + (ownerRole ? ' (' + ownerRole + ')' : '') + '\\n') : '') + (d.ai_rationale || ''),
  has_email: Boolean(email), has_phone: Boolean(d.phone), has_social: Boolean(d.has_social),
  status: 'New',
} } };`;

const id = (s) => s.padEnd(36, '0').slice(0, 36);
const wf = {
  name: 'M1 - Lead Analysis Pipeline',
  nodes: [
    { parameters: {}, id: id('manual-1'), name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 200] },
    { parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 9 }] } }, id: id('sched-1'), name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 400] },
    { parameters: { jsCode: `${targets}
const idx = dayIndex(new Date());
const t = pickTarget(idx);
return { json: { textQuery: t.textQuery, maxResultCount: 5, businessType: t.businessType, city: t.city } };` },
      id: id('cfg-1'), name: 'Set Config', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 300] },
    { parameters: { method: 'POST', url: 'https://places.googleapis.com/v1/places:searchText',
      sendHeaders: true, headerParameters: { parameters: [
        { name: 'X-Goog-Api-Key', value: '={{ $env.GOOGLE_API_KEY }}' },
        { name: 'X-Goog-FieldMask', value: 'places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.userRatingCount,places.rating,places.formattedAddress,places.types' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ textQuery: $json.textQuery, maxResultCount: $json.maxResultCount }) }}',
      options: { response: { response: { neverError: false } } } },
      id: id('places-1'), name: 'Places Search', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [460, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
    { parameters: { jsCode: normalizeCode }, id: id('norm-1'), name: 'Normalize+Flag', type: 'n8n-nodes-base.code', typeVersion: 2, position: [680, 300] },
    { parameters: { conditions: { options: { caseSensitive: true, version: 2 }, combinator: 'and', conditions: [
      { id: 'c1', leftValue: '={{ $json.has_website }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } },
    ] } }, id: id('if-1'), name: 'Has Website?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [900, 300] },
    { parameters: { url: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
      sendQuery: true, queryParameters: { parameters: [
        { name: 'url', value: '={{ $json.website }}' },
        { name: 'strategy', value: 'mobile' },
        { name: 'category', value: 'performance' },
        { name: 'category', value: 'seo' },
        { name: 'key', value: '={{ $env.GOOGLE_API_KEY }}' },
      ] }, options: { timeout: 60000 } },
      id: id('ps-1'), name: 'PageSpeed', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1120, 200], retryOnFail: true, maxTries: 3, waitBetweenTries: 8000, onError: 'continueRegularOutput' },
    { parameters: { url: '={{ $json.website }}', options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 } },
      id: id('html-1'), name: 'Fetch HTML', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1340, 200], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: findAboutCode }, id: id('about-find'), name: 'Find About', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1430, 380] },
    { parameters: { url: '={{ $json.aboutUrl }}', options: { response: { response: { responseFormat: 'text' } }, timeout: 15000 } },
      id: id('about-fetch'), name: 'Fetch About', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1540, 380], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: htmlSignalsCode }, id: id('hsig-1'), name: 'HTML Signals', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1700, 200] },
    { parameters: { method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.GROQ_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.2, response_format: { type: "json_object" }, messages: $json.messages }) }}',
      options: {} },
      id: id('groq-1'), name: 'Groq Review', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [1780, 200], retryOnFail: true, maxTries: 2, waitBetweenTries: 5000, onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: parseAiCode }, id: id('pai-1'), name: 'Parse AI', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2000, 200] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: noSiteCode }, id: id('nosite-1'), name: 'No-site Defaults', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1120, 420] },
    { parameters: { numberInputs: 2 }, id: id('merge-1'), name: 'Merge', type: 'n8n-nodes-base.merge', typeVersion: 3, position: [2220, 300] },
    { parameters: { mode: 'runOnceForEachItem', jsCode: computeCode }, id: id('comp-1'), name: 'Compute Scores', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2440, 300] },
    { parameters: { method: 'POST', url: 'https://api.apollo.io/api/v1/people/match',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Api-Key', value: '={{ $env.APOLLO_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ domain: ($json.website || "").replace(/^https?:\\\\/\\\\//,"").replace(/\\\\/.*$/,"") }) }}',
      options: {} },
      id: id('apollo-1'), name: 'Apollo Enrich', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [2660, 300], onError: 'continueRegularOutput' },
    { parameters: { mode: 'runOnceForEachItem', jsCode: assembleCode }, id: id('asm-1'), name: 'Assemble Record', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2880, 300] },
    { parameters: { method: 'PATCH', url: '=https://api.airtable.com/v0/{{ $env.AIRTABLE_BASE_ID }}/Leads',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $env.AIRTABLE_PAT }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ performUpsert: { fieldsToMergeOn: ["place_id"] }, typecast: true, records: [ { fields: $json.fields } ] }) }}',
      options: {} },
      id: id('air-1'), name: 'Airtable Upsert', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.4, position: [3100, 300], retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Set Config', type: 'main', index: 0 }]] },
    'Schedule Trigger': { main: [[{ node: 'Set Config', type: 'main', index: 0 }]] },
    'Set Config': { main: [[{ node: 'Places Search', type: 'main', index: 0 }]] },
    'Places Search': { main: [[{ node: 'Normalize+Flag', type: 'main', index: 0 }]] },
    'Normalize+Flag': { main: [[{ node: 'Has Website?', type: 'main', index: 0 }]] },
    'Has Website?': { main: [
      [{ node: 'PageSpeed', type: 'main', index: 0 }],
      [{ node: 'No-site Defaults', type: 'main', index: 0 }],
    ] },
    'PageSpeed': { main: [[{ node: 'Fetch HTML', type: 'main', index: 0 }]] },
    'Fetch HTML': { main: [[{ node: 'Find About', type: 'main', index: 0 }]] },
    'Find About': { main: [[{ node: 'Fetch About', type: 'main', index: 0 }]] },
    'Fetch About': { main: [[{ node: 'HTML Signals', type: 'main', index: 0 }]] },
    'HTML Signals': { main: [[{ node: 'Groq Review', type: 'main', index: 0 }]] },
    'Groq Review': { main: [[{ node: 'Parse AI', type: 'main', index: 0 }]] },
    'Parse AI': { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
    'No-site Defaults': { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
    'Merge': { main: [[{ node: 'Compute Scores', type: 'main', index: 0 }]] },
    'Compute Scores': { main: [[{ node: 'Apollo Enrich', type: 'main', index: 0 }]] },
    'Apollo Enrich': { main: [[{ node: 'Assemble Record', type: 'main', index: 0 }]] },
    'Assemble Record': { main: [[{ node: 'Airtable Upsert', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const out = process.argv[2] || 'workflows/m1-lead-analysis.json';
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log('wrote', out, '-', wf.nodes.length, 'nodes');
