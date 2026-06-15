const { test } = require('node:test');
const assert = require('node:assert');
const { buildCandidateUrls, buildLinkedinSearchUrl, pickBestEmail } = require('../lib/emailFinder');

test('buildCandidateUrls strips trailing slash and adds contact pages', () => {
  assert.deepEqual(buildCandidateUrls('https://acme.com/'),
    ['https://acme.com', 'https://acme.com/contact', 'https://acme.com/contact-us', 'https://acme.com/about']);
});
test('buildCandidateUrls prepends http when missing scheme', () => {
  assert.equal(buildCandidateUrls('acme.com')[0], 'http://acme.com');
});
test('buildCandidateUrls returns [] for empty', () => {
  assert.deepEqual(buildCandidateUrls(''), []);
});
test('buildLinkedinSearchUrl encodes business + location', () => {
  const u = buildLinkedinSearchUrl('Acme Dental', 'Manchester');
  assert.match(u, /google\.com\/search/);
  assert.match(u, /Acme/);
  assert.match(u, /linkedin\.com/);
});
test('pickBestEmail returns first or empty', () => {
  assert.equal(pickBestEmail(['info@a.com', 'jane@a.com']), 'info@a.com');
  assert.equal(pickBestEmail([]), '');
});
