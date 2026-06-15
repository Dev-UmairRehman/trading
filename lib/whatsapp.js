// lib/whatsapp.js — pure helpers for building click-to-chat WhatsApp links.
// Normalizes a local/raw phone into international digits (no +) for wa.me.
function normalizePhone(raw, defaultCc) {
  let s = String(raw || '').trim();
  const cc = String(defaultCc || '44').replace(/[^0-9]/g, '');
  if (s.startsWith('+')) return s.replace(/[^0-9]/g, '');     // already international
  const d = s.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) return d.slice(2);                  // 00<cc>... intl prefix
  if (d.startsWith('0')) return cc + d.slice(1);              // local trunk 0 -> country code
  if (cc && d.startsWith(cc)) return d;                       // already has country code
  return cc + d;                                              // bare local number
}
function buildWaLink(phoneIntl, message) {
  if (!phoneIntl) return '';
  return 'https://wa.me/' + phoneIntl + '?text=' + encodeURIComponent(message || '');
}
module.exports = { normalizePhone, buildWaLink };
