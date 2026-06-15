// lib/contactability.js — route a lead by what we can reach it on. Pure.
function deriveContactability(hasEmail, hasPhone) {
  if (hasEmail && hasPhone) return 'both';
  if (hasEmail) return 'email_only';
  if (hasPhone) return 'phone_only';
  return 'none';
}
function contactabilityBoost(route) {
  if (route === 'both') return 15;
  if (route === 'email_only') return 8;
  if (route === 'phone_only') return 5;
  return 0;
}
module.exports = { deriveContactability, contactabilityBoost };
