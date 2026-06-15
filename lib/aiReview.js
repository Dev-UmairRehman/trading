// lib/aiReview.js
// Pure: build the Groq prompt and parse its JSON reply. No network here.
function buildReviewPrompt(lead, htmlSnippet) {
  const system = 'You are a web/automation consultant. Reply with ONLY a JSON object, no prose. '
    + 'Schema: {"outdated":boolean,"opportunities":string[],"missingLeadCapture":string[],"summary":string}. '
    + '"outdated" = is the site visually/technically dated. "opportunities" = automation/AI wins (max 4). '
    + '"missingLeadCapture" = absent ways to capture leads. "summary" = one sentence.';
  const user = `Business: ${lead.business_name || 'Unknown'}\nWebsite: ${lead.website || 'NONE'}\n`
    + `HTML excerpt (truncated):\n${String(htmlSnippet || '').slice(0, 4000)}\n\n`
    + 'Return the JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseReview(content) {
  const fallback = { outdated: false, opportunities: [], missingLeadCapture: [], summary: '' };
  if (!content) return fallback;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return fallback;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return {
      outdated: Boolean(obj.outdated),
      opportunities: Array.isArray(obj.opportunities) ? obj.opportunities : [],
      missingLeadCapture: Array.isArray(obj.missingLeadCapture) ? obj.missingLeadCapture : [],
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    };
  } catch {
    return fallback;
  }
}

module.exports = { buildReviewPrompt, parseReview };
