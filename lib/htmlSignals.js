// lib/htmlSignals.js
// Pure HTML signal extraction. No network, no DOM — regex over a string.
const SOCIAL_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'youtube.com'];

function extractHtmlSignals(html, finalUrl) {
  const h = String(html || '');
  const lower = h.toLowerCase();

  const hasTitle = /<title[^>]*>\s*\S/i.test(h);
  const hasMetaDescription = /<meta[^>]+name=["']description["'][^>]*>/i.test(h);
  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(h);
  const hasH1 = /<h1[\s>]/i.test(h);
  const hasContactForm = /<form[\s>]/i.test(h);
  const hasSSL = String(finalUrl || '').toLowerCase().startsWith('https://');

  const socialLinks = [];
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRe.exec(h)) !== null) {
    const url = m[1];
    if (SOCIAL_HOSTS.some((host) => url.toLowerCase().includes(host)) && !socialLinks.includes(url)) {
      socialLinks.push(url);
    }
  }

  let copyrightYear = null;
  const yearRe = /(?:©|&copy;|copyright)\s*[^0-9]{0,8}((?:19|20)\d{2})/gi;
  while ((m = yearRe.exec(lower)) !== null) {
    const y = parseInt(m[1], 10);
    if (copyrightYear === null || y > copyrightYear) copyrightYear = y;
  }

  // De-obfuscate common "name (at) domain (dot) com" patterns before scanning.
  const deob = h
    .replace(/\s*[([]\s*at\s*[)\]]\s*/gi, '@')
    .replace(/\s*[([]\s*dot\s*[)\]]\s*/gi, '.');
  const found = [];
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  while ((m = emailRe.exec(deob)) !== null) {
    const e = m[0].toLowerCase();
    if (!e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') && !e.endsWith('.webp') && !found.includes(e)) found.push(e);
  }
  // Prioritize role-based mailboxes (best for cold outreach); stable otherwise.
  const ROLE = /^(info|contact|hello|enquiries|enquiry|office|admin|sales|support|reception)@/i;
  const emails = found.slice().sort((a, b) => (ROLE.test(b) ? 1 : 0) - (ROLE.test(a) ? 1 : 0));

  return { hasTitle, hasMetaDescription, hasViewport, hasH1, hasContactForm, hasSSL, socialLinks, copyrightYear, emails };
}

module.exports = { extractHtmlSignals };
