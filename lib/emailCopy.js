// lib/emailCopy.js — pure: build stage-aware Groq prompt + parse {subject, body}. No network.
const STAGE_GUIDE = {
  initial: 'First touch. Open with the SPECIFIC observation from the analysis. One concrete value offer. Soft CTA (a quick reply or 15-min call).',
  followup1: 'Short bump (3 days later). New angle / second opportunity. 2-3 sentences. Reference the first email lightly.',
  followup2: 'Value nudge (6 days later). One short proof point or mini case angle. Keep it brief.',
  followup3: 'Breakup email (10 days later). Polite "should I close your file?" tone. Very short. Easy out.',
};
// Shorten a Google-style business name for use in a subject line:
// drop anything after a dash/comma and trailing location/qualifier noise.
function shortName(name) {
  let n = String(name || '').split(/\s[-–—]\s|,/)[0].trim();
  return n || 'your business';
}
function buildEmailPrompt(lead, stage) {
  const guide = STAGE_GUIDE[stage] || STAGE_GUIDE.initial;
  const firstName = String(lead.owner_name || '').trim().split(/\s+/)[0] || '';
  const biz = shortName(lead.business_name);
  const system = 'You are Rehman, a professional freelance web developer who builds websites and '
    + 'practical business automations for local businesses. You write polished, credible B2B '
    + 'outreach emails that read like a real professional wrote them by hand — never like a mass '
    + 'template or marketing blast. Reply with ONLY JSON: {"subject":string,"body":string}.\n\n'
    + 'BODY FORMAT (plain text, use real newline characters "\\n" exactly as shown):\n'
    + '  1) Greeting line: "Hi ' + (firstName || '{first name}') + '," — use "Hi there," if no name.\n'
    + '  2) (blank line)\n'
    + '  3) Opening sentence: a specific, genuine observation about THIS business or its website, '
    + 'drawn from the findings — proves you actually looked. Be concrete, not generic.\n'
    + '  4) One or two sentences explaining, plainly, what you can do about it and the real benefit '
    + 'to them (e.g. more booked appointments, fewer missed enquiries, a site that works on phones).\n'
    + '  5) A clear, professional call to action — offer a short call or to send a couple of specific ideas.\n'
    + '  6) (blank line)\n'
    + '  7) Signature block on its own lines, EXACTLY:\n'
    + '       "Best regards,\\nRehman\\nWeb Development & Business Automation"\n'
    + '  8) (blank line)\n'
    + '  9) A brief, polite P.S. opt-out — tell them they can just reply to opt out and you won\'t write again.\n\n'
    + 'TONE & RULES: Professional, confident, respectful, human. 70-110 words in the body. '
    + 'Short paragraphs. NO buzzwords (AI-powered, streamline, leverage, synergy, solutions, unlock, '
    + 'boost, valuable insights, cutting-edge, game-changer). NO hype/spam words (free, guarantee, '
    + 'act now, limited time, !!!). No emojis. No links or attachments. Never invent facts, results, '
    + 'or fake credentials.\n'
    + 'SUBJECT: professional and specific, 3-6 words, referencing the business by its SHORT name "'
    + biz + '". Good examples: "Idea for ' + biz + '\'s website", "Quick note for ' + biz + '", '
    + '"' + biz + ' — your online booking". Bad: ALL CAPS, "Boost Your Revenue", emojis, clickbait.';
  const user = `Stage: ${stage}\nGuidance: ${guide}\n\nBusiness (full): ${lead.business_name}\n`
    + `Business (short, for subject): ${biz}\n`
    + `Owner first name: ${firstName || '(unknown — use "Hi there,")'}\n`
    + `Type: ${lead.category || 'business'}\nLocation: ${lead.location || ''}\n`
    + `Has website: ${lead.has_website ? 'yes (' + (lead.website || '') + ')' : 'NO website'}\n`
    + `Analysis findings: ${lead.ai_findings || 'n/a'}\nWhy: ${lead.ai_rationale || ''}\n\n`
    + 'Write a professional email signed as Rehman, following the format exactly. Write the JSON now.';
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
