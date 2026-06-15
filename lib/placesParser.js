// lib/placesParser.js
// Pure normalization of Google Places API (New) responses.
function parsePlace(place) {
  const p = place || {};
  const website = p.websiteUri || '';
  return {
    business_name: (p.displayName && p.displayName.text) || '',
    place_id: p.id || '',
    website,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    review_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
    rating: typeof p.rating === 'number' ? p.rating : null,
    category: Array.isArray(p.types) && p.types.length ? p.types[0] : '',
    location: p.formattedAddress || '',
    has_website: Boolean(website),
  };
}

function flagMultipleLocations(places) {
  const counts = new Map();
  for (const p of places || []) {
    const name = ((p.displayName && p.displayName.text) || '').trim().toLowerCase();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const repeated = new Set();
  for (const [name, n] of counts) if (n >= 2) repeated.add(name);
  return repeated;
}

module.exports = { parsePlace, flagMultipleLocations };
