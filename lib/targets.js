// lib/targets.js — rotating global outreach targets. Pure, date-seeded.
const BUSINESS_TYPES = [
  'dentist', 'orthodontist', 'med spa', 'cosmetic clinic', 'law firm',
  'personal injury lawyer', 'immigration lawyer', 'roofing company', 'HVAC company',
  'solar installer', 'plumber', 'real estate agency', 'physiotherapy clinic',
  'veterinary clinic', 'accounting firm', 'financial advisor', 'insurance broker',
  'fitness studio', 'yoga studio', 'dermatology clinic',
];
const CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Toronto', 'Vancouver', 'London',
  'Manchester', 'Dublin', 'Sydney', 'Melbourne', 'Auckland', 'Dubai',
  'Singapore', 'Amsterdam',
];
// 1-based day of year (UTC), stable across a run.
function dayIndex(date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - startOfYear) / 86400000);
}
// Rotate business type fastest; advance city after a full type cycle.
function pickTarget(index) {
  const i = Math.abs(Math.floor(index || 0));
  const businessType = BUSINESS_TYPES[i % BUSINESS_TYPES.length];
  const city = CITIES[Math.floor(i / BUSINESS_TYPES.length) % CITIES.length];
  return { textQuery: `${businessType} in ${city}`, businessType, city };
}
module.exports = { BUSINESS_TYPES, CITIES, dayIndex, pickTarget };
