const { test } = require('node:test');
const assert = require('node:assert');
const { buildClassifyPrompt, parseClassification, LABELS } = require('../lib/replyClassify');

test('LABELS are the three intents', () => {
  assert.deepEqual(LABELS, ['Interested', 'NotInterested', 'Question']);
});
test('prompt includes business name and reply text', () => {
  const msgs = buildClassifyPrompt({ business_name: 'Acme Dental' }, 'Yes, send pricing');
  assert.equal(msgs.length, 2);
  assert.match(msgs[1].content, /Acme Dental/);
  assert.match(msgs[1].content, /send pricing/);
});
test('parses a clean Interested label', () => {
  const r = parseClassification('{"label":"Interested","reason":"wants pricing"}');
  assert.equal(r.label, 'Interested');
  assert.equal(r.reason, 'wants pricing');
});
test('parses label embedded in prose/fences', () => {
  const r = parseClassification('Sure! ```json\n{"label":"NotInterested","reason":"unsubscribe"}\n```');
  assert.equal(r.label, 'NotInterested');
});
test('unknown label falls back to Question', () => {
  const r = parseClassification('{"label":"Maybe"}');
  assert.equal(r.label, 'Question');
});
test('junk input falls back to Question', () => {
  assert.equal(parseClassification('not json').label, 'Question');
  assert.equal(parseClassification('').label, 'Question');
});
