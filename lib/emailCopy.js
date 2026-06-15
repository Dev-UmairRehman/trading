// lib/emailCopy.js — pure: build stage-aware Groq prompt + parse {subject, body}. No network.
const STAGE_GUIDE = {
  initial: 'First touch. Open with the SPECIFIC observation from the analysis. One concrete value offer. Soft CTA (a quick reply or 15-min call).',
  followup1: 'Short bump (3 days later). New angle / second opportunity. 2-3 sentences. Reference the first email lightly.',
  followup2: 'Value nudge (6 days later). One short proof point or mini case angle. Keep it brief.',
  followup3: 'Breakup email (10 days later). Polite "should I close your file?" tone. Very short. Easy out.',
};
function buildEmailPrompt(lead, stage) {
  const guide = STAGE_GUIDE[stage] || STAGE_GUIDE.initial;
  const system = 'You write concise, human, non-spammy B2B cold emails for Rehman, who sells website '
    + 'development, AI automation, and n8n automation to local businesses. Reply with ONLY JSON: '
    + '{"subject":string,"body":string}. Plain text body, 4-6 short sentences max, no emojis, no '
    + 'hypey words (free, guarantee, act now). Sign as "Rehman". Never invent facts about the business.';
  const user = `Stage: ${stage}\nGuidance: ${guide}\n\nBusiness: ${lead.business_name}\n`
    + `Type: ${lead.category || 'business'}\nLocation: ${lead.location || ''}\n`
    + `Has website: ${lead.has_website ? 'yes (' + (lead.website || '') + ')' : 'NO website'}\n`
    + `Analysis findings: ${lead.ai_findings || 'n/a'}\nWhy: ${lead.ai_rationale || ''}\n\n`
    + 'Sign the email as Rehman. Write the JSON now.';
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
