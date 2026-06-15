const { test } = require('node:test');
const assert = require('node:assert');
const { buildEmailPrompt, parseEmail } = require('../lib/emailCopy');

const LEAD = { business_name: 'Acme Dental', category: 'dentist', location: 'Manchester',
  has_website: true, website: 'https://acme.com', ai_findings: 'no online booking; slow site',
  ai_rationale: 'Warm; medium conversion', classification: 'Warm' };

test('buildEmailPrompt is stage-aware and includes the business + findings', () => {
  const msgs = buildEmailPrompt(LEAD, 'initial');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /Acme Dental/);
  assert.match(msgs[1].content, /no online booking/);
  assert.match(msgs[1].content, /initial/i);
  assert.match(msgs[1].content, /Rehman/);
});

test('buildEmailPrompt breakup tone for followup3', () => {
  const msgs = buildEmailPrompt(LEAD, 'followup3');
  assert.match(msgs[1].content, /followup3|breakup|last/i);
});

test('parseEmail reads subject + body from JSON', () => {
  const r = parseEmail('{"subject":"Quick idea for Acme Dental","body":"Hi,\\n..."}');
  assert.equal(r.subject, 'Quick idea for Acme Dental');
  assert.ok(r.body.length > 0);
});

test('parseEmail tolerates fences and falls back safely', () => {
  const r = parseEmail('```json\\n{"subject":"S","body":"B"}\\n```');
  assert.equal(r.subject, 'S');
  const bad = parseEmail('no json here');
  assert.equal(bad.subject, '');
  assert.equal(bad.body, '');
});
