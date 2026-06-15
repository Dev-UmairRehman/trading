// test/scoring.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeScores } = require('../lib/scoring');

const YEAR = 2026;

test('no-website business scores Hot with full opportunity', () => {
  const r = computeScores({
    hasWebsite: false, html: null, pagespeed: null,
    reviewCount: 120, hasSocial: false, multipleLocations: true, aiOutdated: false,
  }, YEAR);
  // +25 no website, +15 SEO (no site), +15 mobile (no site), +10 large, +10 multi = 75
  assert.equal(r.lead_score, 75);
  assert.equal(r.classification, 'Hot');
  assert.equal(r.website_score, 0);
  assert.ok(r.automation_score >= 70);
});

test('modern site scores Cold', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: true, hasH1: true, hasViewport: true, hasContactForm: true, hasSSL: true, socialLinks: ['x'], copyrightYear: YEAR },
    pagespeed: { mobilePerf: 92, seo: 95 },
    reviewCount: 10, hasSocial: true, multipleLocations: false, aiOutdated: false,
  }, YEAR);
  // active social +5 only
  assert.equal(r.lead_score, 5);
  assert.equal(r.classification, 'Cold');
  assert.ok(r.website_score >= 85);
});

test('old site over http scores Warm/Hot', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: false, hasH1: false, hasViewport: false, hasContactForm: false, hasSSL: false, socialLinks: [], copyrightYear: 2010 },
    pagespeed: { mobilePerf: 40, seo: 55 },
    reviewCount: 150, hasSocial: false, multipleLocations: false, aiOutdated: true,
  }, YEAR);
  // +20 outdated, +15 SEO, +15 mobile, +10 large = 60
  assert.equal(r.lead_score, 60);
  assert.equal(r.classification, 'Warm');
});

test('automation_score is graduated by AI findings, not saturated', () => {
  const weak = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: false, hasH1: true, hasViewport: false, hasContactForm: false, hasSSL: false, socialLinks: [], copyrightYear: 2012 },
    pagespeed: { mobilePerf: 30, seo: 40 },
    reviewCount: 200, hasSocial: false, multipleLocations: false, aiOutdated: true,
    aiOpportunities: ['online booking', 'chatbot', 'review automation', 'email follow-up'],
    aiMissingLeadCapture: ['no contact form', 'no newsletter'],
  }, YEAR);
  const strong = computeScores({
    hasWebsite: true,
    html: { hasTitle: true, hasMetaDescription: true, hasH1: true, hasViewport: true, hasContactForm: true, hasSSL: true, socialLinks: ['x'], copyrightYear: YEAR },
    pagespeed: { mobilePerf: 95, seo: 95 },
    reviewCount: 20, hasSocial: true, multipleLocations: false, aiOutdated: false,
    aiOpportunities: [], aiMissingLeadCapture: [],
  }, YEAR);
  assert.ok(strong.automation_score <= 25, 'modern well-equipped site = low automation opportunity');
  assert.ok(weak.automation_score >= 65, 'neglected busy business = high opportunity');
  assert.ok(weak.automation_score - strong.automation_score >= 40, 'scores must clearly separate, not saturate');
});

test('lead_score never exceeds 100', () => {
  const r = computeScores({
    hasWebsite: true,
    html: { hasTitle: false, hasMetaDescription: false, hasH1: false, hasViewport: false, hasContactForm: false, hasSSL: false, socialLinks: ['x'], copyrightYear: 2005 },
    pagespeed: { mobilePerf: 5, seo: 5 },
    reviewCount: 999, hasSocial: true, multipleLocations: true, aiOutdated: true,
  }, YEAR);
  // 20+15+15+10+5+10 = 75 (no-website not applicable since hasWebsite true)
  assert.ok(r.lead_score <= 100);
  assert.equal(r.lead_score, 75);
});
