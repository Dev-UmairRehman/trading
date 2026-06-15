const { test } = require('node:test');
const assert = require('node:assert');
const { BUSINESS_TYPES, CITIES, dayIndex, pickTarget } = require('../lib/targets');

test('dayIndex is 1 on Jan 1 (UTC)', () => {
  assert.equal(dayIndex(new Date('2026-01-01T00:00:00Z')), 1);
});
test('dayIndex increments by day', () => {
  const a = dayIndex(new Date('2026-03-10T00:00:00Z'));
  const b = dayIndex(new Date('2026-03-11T00:00:00Z'));
  assert.equal(b - a, 1);
});
test('pickTarget builds a "{type} in {city}" query', () => {
  const t = pickTarget(0);
  assert.equal(t.textQuery, `${BUSINESS_TYPES[0]} in ${CITIES[0]}`);
  assert.equal(t.businessType, BUSINESS_TYPES[0]);
  assert.equal(t.city, CITIES[0]);
});
test('business type rotates fastest, city slower', () => {
  const t1 = pickTarget(1);
  assert.equal(t1.businessType, BUSINESS_TYPES[1]);
  assert.equal(t1.city, CITIES[0]);
  const wrap = pickTarget(BUSINESS_TYPES.length); // first type, next city
  assert.equal(wrap.businessType, BUSINESS_TYPES[0]);
  assert.equal(wrap.city, CITIES[1]);
});
test('index wraps without error for large values', () => {
  const t = pickTarget(99999);
  assert.ok(t.textQuery.includes(' in '));
});
