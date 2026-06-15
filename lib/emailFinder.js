// lib/emailFinder.js — pure helpers for email discovery + manual queue.
function normalizeBase(website) {
  let u = String(website || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}
function buildCandidateUrls(website) {
  const base = normalizeBase(website);
  if (!base) return [];
  return [base, base + '/contact', base + '/contact-us', base + '/about'];
}
function buildLinkedinSearchUrl(businessName, location) {
  const q = [businessName, location, 'site:linkedin.com'].filter(Boolean).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}
function pickBestEmail(emails) {
  return (Array.isArray(emails) && emails.length) ? emails[0] : '';
}
module.exports = { normalizeBase, buildCandidateUrls, buildLinkedinSearchUrl, pickBestEmail };
