// lib/scoring.js
// Pure scoring. `signals` is fully pre-extracted; `currentYear` injected for testability.
const LARGE_BUSINESS_REVIEWS = 100;
const OUTDATED_YEAR_GAP = 3; // copyright older than (currentYear - 3) => outdated

function isOutdated(html, aiOutdated, currentYear) {
  if (aiOutdated) return true;
  if (!html) return false;
  if (!html.hasViewport) return true;
  if (!html.hasSSL) return true;
  if (html.copyrightYear && html.copyrightYear < currentYear - OUTDATED_YEAR_GAP) return true;
  return false;
}

function isPoorSeo(html, pagespeed) {
  if (!html) return false; // handled by no-website branch
  const missingBasics = !html.hasTitle || !html.hasMetaDescription || !html.hasH1;
  const lowScore = pagespeed && typeof pagespeed.seo === 'number' && pagespeed.seo < 70;
  return Boolean(missingBasics || lowScore);
}

function isPoorMobile(html, pagespeed) {
  if (!html) return false;
  const noViewport = !html.hasViewport;
  const lowPerf = pagespeed && typeof pagespeed.mobilePerf === 'number' && pagespeed.mobilePerf < 70;
  return Boolean(noViewport || lowPerf);
}

function computeWebsiteScore(html, pagespeed) {
  if (!html) return 0;
  let score = 0;
  const mobile = pagespeed && typeof pagespeed.mobilePerf === 'number' ? pagespeed.mobilePerf : 50;
  score += 0.40 * mobile;                     // 40% performance
  score += html.hasViewport ? 15 : 0;         // 15% mobile-ready
  score += html.hasSSL ? 10 : 0;              // 10% SSL
  const seoBasics = [html.hasTitle, html.hasMetaDescription, html.hasH1].filter(Boolean).length;
  score += (seoBasics / 3) * 20;              // 20% SEO basics
  score += html.hasContactForm ? 15 : 0;      // 15% lead capture
  return Math.round(Math.min(100, score));
}

// Continuous 0-100 opportunity score. Anchored on how much the site needs work
// (inverse of website_score, which varies), blended with AI-identified wins and
// the business's reach (review volume). Discriminates instead of saturating.
function computeAutomationScore(signals, websiteScore) {
  if (!signals.hasWebsite) return 90; // no site = maximum build + automation opportunity
  const ops = Math.min(Array.isArray(signals.aiOpportunities) ? signals.aiOpportunities.length : 0, 5);
  const reviews = Math.min(signals.reviewCount || 0, 500);
  const siteNeed = 100 - websiteScore;        // worse site => more opportunity
  const opsScore = (ops / 5) * 100;           // AI-identified wins, normalized
  const reachScore = (reviews / 500) * 100;   // busier business => more value
  let score = 0.55 * siteNeed + 0.25 * opsScore + 0.20 * reachScore;
  if (!signals.html || !signals.html.hasContactForm) score += 3; // small structural nudges
  if (!signals.hasSocial) score += 2;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function classify(leadScore) {
  if (leadScore >= 70) return 'Hot';
  if (leadScore >= 40) return 'Warm';
  return 'Cold';
}

function computeScores(signals, currentYear) {
  const s = signals || {};
  let lead = 0;
  if (!s.hasWebsite) {
    lead += 25;       // no website
    lead += 15;       // poor SEO (none exists)
    lead += 15;       // poor mobile (none exists)
  } else {
    if (isOutdated(s.html, s.aiOutdated, currentYear)) lead += 20;
    if (isPoorSeo(s.html, s.pagespeed)) lead += 15;
    if (isPoorMobile(s.html, s.pagespeed)) lead += 15;
  }
  if (s.reviewCount >= LARGE_BUSINESS_REVIEWS) lead += 10; // large business
  if (s.hasSocial) lead += 5;                              // active social
  if (s.multipleLocations) lead += 10;                     // multiple locations

  const lead_score = Math.min(100, lead);
  const website_score = computeWebsiteScore(s.html, s.pagespeed);
  return {
    website_score,
    automation_score: computeAutomationScore(s, website_score),
    lead_score,
    classification: classify(lead_score),
  };
}

module.exports = { computeScores, classify };
