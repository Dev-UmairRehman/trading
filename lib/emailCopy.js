// lib/emailCopy.js — pure: build stage-aware Groq prompt + parse {subject, body}. No network.
const STAGE_GUIDE = {
  initial: 'First touch. Open with the SPECIFIC observation from the analysis. One concrete value offer. Soft CTA (a quick reply or 15-min call).',
  followup1: 'Short bump (3 days later). New angle / second opportunity. 2-3 sentences. Reference the first email lightly.',
  followup2: 'Value nudge (6 days later). One short proof point or mini case angle. Keep it brief.',
  followup3: 'Breakup email (10 days later). Polite "should I close your file?" tone. Very short. Easy out.',
};
function buildEmailPrompt(lead, stage) {
  const guide = STAGE_GUIDE[stage] || STAGE_GUIDE.initial;
  const firstName = String(lead.owner_name || '').trim().split(/\s+/)[0] || '';
  const system = 'You write short, warm, human B2B emails for Rehman, an independent developer who '
    + 'builds websites and simple automations for local businesses. The goal is a friendly reply, '
    + 'not a sale. Reply with ONLY JSON: {"subject":string,"body":string}.\n'
    + 'STRICT FORMAT for body (plain text, use real line breaks "\\n"):\n'
    + '  Line 1: a greeting — "Hi ' + (firstName || '{first name}') + '," (use "Hi there," if no name).\n'
    + '  Then a blank line.\n'
    + '  Then 2-3 SHORT sentences. Open by referencing ONE specific thing about their business or '
    + 'website (from the findings). Mention one concrete way Rehman could help. End with a low-pressure '
    + 'question (e.g. "Worth a quick chat?" or "Mind if I send a couple of ideas?").\n'
    + '  Then a blank line.\n'
    + '  Then a sign-off on its OWN lines: "Best,\\nRehman".\n'
    + '  Then a blank line, then a short, polite one-line opt-out P.S. that tells them they can '
    + 'simply reply to say no and you will not write again (phrase it naturally and human).\n'
    + 'RULES: Sound like a real person, not marketing. NO buzzwords (AI-powered, streamline, '
    + 'leverage, solutions, unlock, boost, valuable insights, cutting-edge). NO hype words (free, '
    + 'guarantee, act now, limited). No emojis. No links. Under 80 words total. Never invent facts.\n'
    + 'SUBJECT: short, lowercase-feel, specific and casual — like a note from a person, not an ad. '
    + 'Good: "quick question about ' + (lead.business_name || 'your site') + '". '
    + 'Bad: "Enhance Patient Experience" / "Boost Your Revenue".';
  const user = `Stage: ${stage}\nGuidance: ${guide}\n\nBusiness: ${lead.business_name}\n`
    + `Owner first name: ${firstName || '(unknown — use "Hi there,")'}\n`
    + `Type: ${lead.category || 'business'}\nLocation: ${lead.location || ''}\n`
    + `Has website: ${lead.has_website ? 'yes (' + (lead.website || '') + ')' : 'NO website'}\n`
    + `Analysis findings: ${lead.ai_findings || 'n/a'}\nWhy: ${lead.ai_rationale || ''}\n\n`
    + 'Sign the email as Rehman, following the strict format. Write the JSON now.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
function parseEmail(content) {
  const fb = { subject: '', body: '' };
  if (!content) return fb;
  let t = String(content).trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f) t = f[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b < a) return fb;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return { subject: typeof o.subject === 'string' ? o.subject : '', body: typeof o.body === 'string' ? o.body : '' };
  } catch { return fb; }
}
module.exports = { buildEmailPrompt, parseEmail, STAGE_GUIDE };
