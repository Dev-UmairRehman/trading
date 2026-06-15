// test/placesParser.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePlace, flagMultipleLocations } = require('../lib/placesParser');

const PLACE = {
  id: 'ChIJ123',
  displayName: { text: 'Deansgate Dental Studio' },
  websiteUri: 'http://deansgatedentalstudio.co.uk/',
  nationalPhoneNumber: '0161 912 6200',
  userRatingCount: 976,
  rating: 4.8,
  formattedAddress: '1 Deansgate, Manchester',
  types: ['dentist', 'health'],
};

test('parsePlace normalizes fields', () => {
  const p = parsePlace(PLACE);
  assert.equal(p.business_name, 'Deansgate Dental Studio');
  assert.equal(p.place_id, 'ChIJ123');
  assert.equal(p.website, 'http://deansgatedentalstudio.co.uk/');
  assert.equal(p.phone, '0161 912 6200');
  assert.equal(p.review_count, 976);
  assert.equal(p.category, 'dentist');
  assert.equal(p.location, '1 Deansgate, Manchester');
  assert.equal(p.has_website, true);
});

test('parsePlace handles missing website/phone', () => {
  const p = parsePlace({ id: 'x', displayName: { text: 'No Site Cafe' }, types: ['cafe'] });
  assert.equal(p.has_website, false);
  assert.equal(p.website, '');
  assert.equal(p.phone, '');
  assert.equal(p.review_count, 0);
});

test('flagMultipleLocations marks repeated brand names', () => {
  const set = flagMultipleLocations([
    { displayName: { text: 'Joe Pizza' } },
    { displayName: { text: 'Joe Pizza' } },
    { displayName: { text: 'Solo Cafe' } },
  ]);
  assert.equal(set.has('joe pizza'), true);
  assert.equal(set.has('solo cafe'), false);
});
