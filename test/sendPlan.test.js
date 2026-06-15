const { test } = require('node:test');
const assert = require('node:assert');
const { remaining, nextEmailAt, stageToTemplate, jitterSeconds } = require('../lib/sendPlan');

test('remaining respects cap and todays sends', () => {
  assert.equal(remaining(30, 0), 30);
  assert.equal(remaining(30, 28), 2);
  assert.equal(remaining(30, 30), 0);
  assert.equal(remaining(30, 35), 0); // never negative
});

test('nextEmailAt adds cadence days by stage', () => {
  const base = new Date('2026-06-12T10:00:00Z').getTime();
  assert.equal(nextEmailAt(1, base), new Date('2026-06-15T10:00:00Z').toISOString()); // +3
  assert.equal(nextEmailAt(2, base), new Date('2026-06-18T10:00:00Z').toISOString()); // +6
  assert.equal(nextEmailAt(3, base), new Date('2026-06-22T10:00:00Z').toISOString()); // +10
  assert.equal(nextEmailAt(4, base), null); // sequence complete
});

test('stageToTemplate maps current stage to the email to send next', () => {
  assert.equal(stageToTemplate(0), 'initial');
  assert.equal(stageToTemplate(1), 'followup1');
  assert.equal(stageToTemplate(2), 'followup2');
  assert.equal(stageToTemplate(3), 'followup3');
  assert.equal(stageToTemplate(4), null);
});

test('jitterSeconds stays within [min,max]', () => {
  for (let seed = 0; seed < 50; seed++) {
    const v = jitterSeconds(20, 90, seed);
    assert.ok(v >= 20 && v <= 90, `out of range: ${v}`);
  }
});
test('jitterSeconds is deterministic for a given seed', () => {
  assert.equal(jitterSeconds(20, 90, 7), jitterSeconds(20, 90, 7));
});
test('jitterSeconds handles min===max', () => {
  assert.equal(jitterSeconds(30, 30, 123), 30);
});
