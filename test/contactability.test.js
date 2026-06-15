const { test } = require('node:test');
const assert = require('node:assert');
const { deriveContactability, contactabilityBoost } = require('../lib/contactability');

test('both email and phone => both', () => {
  assert.equal(deriveContactability(true, true), 'both');
});
test('email only', () => {
  assert.equal(deriveContactability(true, false), 'email_only');
});
test('phone only', () => {
  assert.equal(deriveContactability(false, true), 'phone_only');
});
test('neither => none', () => {
  assert.equal(deriveContactability(false, false), 'none');
});
test('boost rewards the most reachable leads most', () => {
  assert.ok(contactabilityBoost('both') > contactabilityBoost('email_only'));
  assert.ok(contactabilityBoost('email_only') > contactabilityBoost('phone_only'));
  assert.equal(contactabilityBoost('none'), 0);
});
test('boost is defined for unknown route as 0', () => {
  assert.equal(contactabilityBoost('garbage'), 0);
});
