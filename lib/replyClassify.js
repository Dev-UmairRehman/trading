// lib/replyClassify.js — classify an inbound reply's intent. Pure (prompt + parse).
const LABELS = ['Interested', 'NotInterested', 'Question'];
function buildClassifyPrompt(lead, reply) {
  const system = 'You classify replies to cold sales emails for Rehman, who sells websites '
    + 'and AI/n8n automation. Decide the sender intent. Reply with ONLY JSON '
    + '{"label":"Interested"|"NotInterested"|"Question","reason":string}. '
    + 'Interested = wants the product, a demo, a call, pricing, or to book. '
    + 'NotInterested = declines, unsubscribe, "not now", or hostile. '
    + 'Question = asks something but the intent is unclear.';
  const user = 'Business: ' + ((lead && lead.business_name) || '?')
    + '\nReply:\n' + (reply || '') + '\n\nReturn JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
function parseClassification(content) {
  const fb = { label: 'Question', reason: '' };
  if (!content) return fb;
  const t = String(content).trim();
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a === -1 || b < a) return fb;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    const label = LABELS.includes(o.label) ? o.label : 'Question';
    return { label, reason: typeof o.reason === 'string' ? o.reason : '' };
  } catch { return fb; }
}
module.exports = { buildClassifyPrompt, parseClassification, LABELS };
