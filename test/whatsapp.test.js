const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePhone, buildWaLink } = require('../lib/whatsapp');

test('normalizePhone converts UK local to international', () => {
  assert.equal(normalizePhone('0161 912 6200', '44'), '441619126200');
});
test('normalizePhone keeps + international as-is', () => {
  assert.equal(normalizePhone('+44 161 912 6200', '1'), '441619126200');
});
test('normalizePhone strips 00 intl prefix', () => {
  assert.equal(normalizePhone('0044 161 9126200', '44'), '441619126200');
});
test('normalizePhone leaves already-cc number alone', () => {
  assert.equal(normalizePhone('441619126200', '44'), '441619126200');
});
test('normalizePhone returns empty for junk', () => {
  assert.equal(normalizePhone('', '44'), '');
});
test('buildWaLink url-encodes the message', () => {
  const l = buildWaLink('441619126200', 'Hi there & welcome');
  assert.match(l, /^https:\/\/wa\.me\/441619126200\?text=/);
  assert.match(l, /Hi%20there/);
});
