// test/htmlSignals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractHtmlSignals } = require('../lib/htmlSignals');

test('detects modern, well-built page', () => {
  const html = `<!doctype html><html><head>
    <title>Acme Dental</title>
    <meta name="description" content="Best dentist">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    </head><body><h1>Welcome</h1>
    <form action="/contact"><input name="email"></form>
    <a href="https://facebook.com/acme">fb</a>
    <footer>© 2026 Acme</footer></body></html>`;
  const s = extractHtmlSignals(html, 'https://acme.com');
  assert.equal(s.hasTitle, true);
  assert.equal(s.hasMetaDescription, true);
  assert.equal(s.hasViewport, true);
  assert.equal(s.hasH1, true);
  assert.equal(s.hasContactForm, true);
  assert.equal(s.hasSSL, true);
  assert.deepEqual(s.socialLinks, ['https://facebook.com/acme']);
  assert.equal(s.copyrightYear, 2026);
  assert.deepEqual(s.emails, []);
});

test('extracts mailto and inline emails, role-based first', () => {
  const html = `<a href="mailto:jane@acme.com">mail</a> contact us at info@acme.com`;
  const s = extractHtmlSignals(html, 'https://acme.com');
  // role-based (info@) prioritized ahead of personal for outreach
  assert.equal(s.emails[0], 'info@acme.com');
  assert.ok(s.emails.includes('jane@acme.com'));
});

test('decodes obfuscated (at)/(dot) emails', () => {
  const html = `Reach us: hello (at) acme (dot) com`;
  const s = extractHtmlSignals(html, 'https://acme.com');
  assert.ok(s.emails.includes('hello@acme.com'));
});

test('detects bare/outdated page over http', () => {
  const html = `<html><head></head><body><table><tr><td>old</td></tr></table>
    <p>Copyright 2009</p></body></html>`;
  const s = extractHtmlSignals(html, 'http://old.com');
  assert.equal(s.hasTitle, false);
  assert.equal(s.hasMetaDescription, false);
  assert.equal(s.hasViewport, false);
  assert.equal(s.hasH1, false);
  assert.equal(s.hasContactForm, false);
  assert.equal(s.hasSSL, false);
  assert.deepEqual(s.socialLinks, []);
  assert.equal(s.copyrightYear, 2009);
});

test('handles empty/garbage input safely', () => {
  const s = extractHtmlSignals('', 'https://x.com');
  assert.equal(s.hasTitle, false);
  assert.equal(s.copyrightYear, null);
  assert.deepEqual(s.socialLinks, []);
});
