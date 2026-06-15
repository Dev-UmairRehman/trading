// lib/sendPlan.js — pure send-planning helpers.
const CADENCE_DAYS = { 1: 3, 2: 6, 3: 10 }; // days added AFTER sending stage N
const TEMPLATES = ['initial', 'followup1', 'followup2', 'followup3'];

function remaining(cap, sentToday) {
  return Math.max(0, (cap || 0) - (sentToday || 0));
}
function nextEmailAt(newStage, fromMs) {
  const days = CADENCE_DAYS[newStage];
  if (!days) return null; // stage 4 => done
  return new Date(fromMs + days * 86400000).toISOString();
}
function stageToTemplate(currentStage) {
  return TEMPLATES[currentStage] || null;
}
// Deterministic-by-seed delay in whole seconds within [min,max], for human-like sends.
function jitterSeconds(min, max, seed) {
  const lo = Math.max(0, Math.floor(min || 0));
  const hi = Math.max(lo, Math.floor(max || 0));
  const span = hi - lo + 1;
  const s = Math.abs(Math.floor(seed || 0)) % span;
  return lo + s;
}
module.exports = { remaining, nextEmailAt, stageToTemplate, CADENCE_DAYS, jitterSeconds };
