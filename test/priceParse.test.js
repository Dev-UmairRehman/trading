const { test } = require('node:test');
const assert = require('node:assert');
const { parseMoney, pickProductName, groupByQuery, parseShoppingOffers, formatPricesSummary, buildRow } = require('../lib/priceParse');

test('parseMoney handles numbers, currency strings, commas', () => {
  assert.equal(parseMoney(395.49), 395.49);
  assert.equal(parseMoney('$395.49'), 395.49);
  assert.equal(parseMoney('1,299'), 1299);
  assert.equal(parseMoney('£49.00'), 49);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(null), null);
});
test('pickProductName prefers a product/name column, else first', () => {
  assert.equal(pickProductName({ 'Product Name': 'Widget', sku: 'X' }), 'Widget');
  assert.equal(pickProductName({ foo: 'First', bar: 'Second' }), 'First');
  assert.equal(pickProductName({}), '');
});
test('groupByQuery groups offers by query', () => {
  const g = groupByQuery([{ query: 'A', merchant: 'X' }, { query: 'A', merchant: 'Y' }, { query: 'B', merchant: 'Z' }]);
  assert.equal(g['A'].length, 2);
  assert.equal(g['B'].length, 1);
});
test('parseShoppingOffers sorts by position, dedupes by site, computes prices', () => {
  const items = [
    { merchant: 'Best Buy', priceNumeric: 395.49, price: '$395.49', currency: 'USD', position: 1 },
    { merchant: 'Junk', priceNumeric: 10, price: '$10.00', currency: 'USD', position: 5 },
    { merchant: 'Best Buy', priceNumeric: 399, price: '$399', currency: 'USD', position: 8 },
    { merchant: '', priceNumeric: 50, price: '$50', position: 2 },
  ];
  const r = parseShoppingOffers(items);
  assert.equal(r.count, 2);
  assert.equal(r.offers[0].site, 'Best Buy');
  assert.equal(r.googlePrice, 395.49);
  assert.equal(r.lowestPrice, 10);
});
test('parseShoppingOffers empty => zeros', () => {
  const r = parseShoppingOffers([]);
  assert.equal(r.count, 0);
  assert.equal(r.googlePrice, null);
});
test('formatPricesSummary joins site: price', () => {
  assert.equal(formatPricesSummary([{ site: 'Best Buy', priceStr: '$395.49' }, { site: 'Target', priceStr: '$349' }]), 'Best Buy: $395.49 | Target: $349');
});
test('buildRow merges original + pricing columns', () => {
  const parsed = parseShoppingOffers([{ merchant: 'Best Buy', priceNumeric: 300, price: '$300', position: 1 }, { merchant: 'eBay', priceNumeric: 500, price: '$500', position: 2 }]);
  const row = buildRow({ 'Product Name': 'Widget' }, 'Widget', parsed);
  assert.equal(row.product_name, 'Widget');
  assert.equal(row.google_price, 300);
  assert.equal(row.competitor_1_site, 'Best Buy');
  assert.equal(row.competitor_1_price, 300);
  assert.equal(row.competitor_2_site, 'eBay');
  assert.equal(row.status, 'ok');
  assert.match(row.prices_summary, /Best Buy: \$300/);
});
test('buildRow with no offers => no results', () => {
  const row = buildRow({ name: 'X' }, 'X', parseShoppingOffers([]));
  assert.equal(row.status, 'no results');
  assert.equal(row.offers_found, 0);
});
