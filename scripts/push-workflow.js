// scripts/push-workflow.js
const fs = require('fs');
const path = require('path');
function env(k){ const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8'); const m=t.match(new RegExp('^'+k+'=(.*)$','m')); return m?m[1]:''; }
const KEY = env('N8N_API_KEY');
const BASE = 'http://localhost:5678/api/v1';
const file = process.argv[2];
(async () => {
  const wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
  const r = await fetch(`${BASE}/workflows`, { method: 'POST', headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { console.error('push failed:', r.status, JSON.stringify(j)); process.exit(1); }
  console.log('created workflow id:', j.id);
})();
