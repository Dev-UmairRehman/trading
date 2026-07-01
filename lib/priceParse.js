// lib/priceParse.js — pure parsing/formatting for Apify Google Shopping offers. No network.
function parseMoney(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}
function pickProductName(row) {
  if (!row || typeof row !== 'object') return '';
  const keys = Object.keys(row);
  const named = keys.find((k) => /product|name|item|title/i.test(k));
  const key = named || keys[0];
  return key ? String(row[key] == null ? '' : row[key]).trim() : '';
}
function groupByQuery(items) {
  const out = {};
  for (const it of (items || [])) {
    const q = String((it && it.query) || '').trim();
    if (!q) continue;
    (out[q] = out[q] || []).push(it);
  }
  return out;
}
function parseShoppingOffers(items) {
  const rows = (items || []).map((it) => ({
    site: String((it && it.merchant) || '').trim(),
    price: parseMoney(it && (it.priceNumeric != null ? it.priceNumeric : it.price)),
    priceStr: String((it && it.price) || '').trim(),
    currency: String((it && it.currency) || '').trim(),
    position: Number((it && it.position) || 9999),
  })).filter((o) => o.site && o.price != null);
  rows.sort((a, b) => a.position - b.position);
  const seen = new Set();
  const offers = [];
  for (const o of rows) {
    const k = o.site.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    offers.push(o);
  }
  const prices = offers.map((o) => o.price);
  return {
    googlePrice: offers.length ? offers[0].price : null,
    lowestPrice: prices.length ? Math.min.apply(null, prices) : null,
    offers,
    count: offers.length,
  };
}
function formatPricesSummary(offers) {
  return (offers || []).map((o) => o.site + ': ' + (o.priceStr || o.price)).join(' | ');
}
function buildRow(originalRow, productName, parsed) {
  const o = (parsed && parsed.offers) || [];
  const row = Object.assign({}, originalRow || {});
  row.product_name = productName || pickProductName(originalRow);
  row.google_price = parsed && parsed.googlePrice != null ? parsed.googlePrice : '';
  row.lowest_price = parsed && parsed.lowestPrice != null ? parsed.lowestPrice : '';
  for (let i = 0; i < 3; i++) {
    row['competitor_' + (i + 1) + '_site'] = o[i] ? o[i].site : '';
    row['competitor_' + (i + 1) + '_price'] = o[i] ? o[i].price : '';
  }
  row.prices_summary = formatPricesSummary(o.slice(0, 5));
  row.offers_found = parsed ? parsed.count : 0;
  row.status = (parsed && parsed.count > 0) ? 'ok' : 'no results';
  return row;
}
module.exports = { parseMoney, pickProductName, groupByQuery, parseShoppingOffers, formatPricesSummary, buildRow };
