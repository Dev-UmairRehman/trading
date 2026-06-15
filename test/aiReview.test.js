// test/aiReview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReviewPrompt, parseReview } = require('../lib/aiReview');

test('buildReviewPrompt returns system+user messages mentioning the business', () => {
  const msgs = buildReviewPrompt({ business_name: 'Acme Dental', website: 'https://acme.com' }, '<h1>Hi</h1>');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].role, 'user');
  assert.match(msgs[1].content, /Acme Dental/);
  assert.match(msgs[1].content, /JSON/i);
});

test('parseReview reads clean JSON', () => {
  const r = parseReview('{"outdated":true,"opportunities":["chatbot"],"missingLeadCapture":["no form"],"summary":"old site"}');
  assert.equal(r.outdated, true);
  assert.deepEqual(r.opportunities, ['chatbot']);
  assert.equal(r.summary, 'old site');
});

test('parseReview tolerates code fences and prose', () => {
  const r = parseReview('Here is the result:\n```json\n{"outdated":false,"opportunities":[],"missingLeadCapture":[],"summary":"fine"}\n```');
  assert.equal(r.outdated, false);
  assert.equal(r.summary, 'fine');
});

test('parseReview returns safe defaults on garbage', () => {
  const r = parseReview('the model refused to answer');
  assert.equal(r.outdated, false);
  assert.deepEqual(r.opportunities, []);
  assert.equal(r.summary, '');
});
