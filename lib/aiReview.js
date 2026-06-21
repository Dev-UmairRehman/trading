// lib/aiReview.js
// Pure: build the Groq prompt and parse its JSON reply. No network here.
function buildReviewPrompt(lead, htmlSnippet) {
  const system = 'You are a web/automation consultant. Reply with ONLY a JSON object, no prose. '
    + 'Schema: {"outdated":boolean,"opportunities":string[],"missingLeadCapture":string[],"summary":string,'
    + '"ownerName":string,"ownerRole":string,"ownerEmail":string}. '
    + '"outdated" = is the site visually/technically dated. "opportunities" = automation/AI wins (max 4). '
    + '"missingLeadCapture" = absent ways to capture leads. "summary" = one sentence. '
    + '"ownerName" = the full name of the owner/founder/director/principal/practice lead IF clearly '
    + 'stated on the page (e.g. "Dr. Jane Smith", "John Doe"); "" if not present — never guess or invent. '
    + '"ownerRole" = that person\'s title if stated (e.g. "Founder", "Principal Dentist"); else "". '
    + '"ownerEmail" = a personal/owner email if one is visible (e.g. jane@...), preferring it over a '
    + 'generic info@/admin@ address; "" if none visible. Only extract facts present in the text.';
  const user = `Business: ${lead.business_name || 'Unknown'}\nWebsite: ${lead.website || 'NONE'}\n`
    + `HTML excerpt (truncated):\n${String(htmlSnippet || '').slice(0, 6000)}\n\n`
    + 'Return the JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseReview(content) {
  const fallback = { outdated: false, opportunities: [], missingLeadCapture: [], summary: '', ownerName: '', ownerRole: '', ownerEmail: '' };
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
      ownerName: typeof obj.ownerName === 'string' ? obj.ownerName.trim() : '',
      ownerRole: typeof obj.ownerRole === 'string' ? obj.ownerRole.trim() : '',
      ownerEmail: typeof obj.ownerEmail === 'string' ? obj.ownerEmail.trim() : '',
    };
  } catch {
    return fallback;
  }
}

module.exports = { buildReviewPrompt, parseReview };
