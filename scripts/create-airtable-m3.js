// scripts/create-airtable-m3.js — add M3/M4 fields to Leads (idempotent).
const fs = require('fs'); const path = require('path');
function readEnv(){const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const o={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/\s+#.*$/,'').trim();}return o;}
const env=readEnv(); const BASE=env.AIRTABLE_BASE_ID, PAT=env.AIRTABLE_PAT;
const H={Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'};
const CHK={icon:'check',color:'greenBright'};
const NEW_FIELDS=[
  {name:'email_finder_done',type:'checkbox',options:CHK},
  {name:'manual_outreach',type:'checkbox',options:CHK},
  {name:'linkedin_search_url',type:'url'},
  {name:'notified',type:'checkbox',options:CHK},
];
async function tables(){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{headers:H});if(!r.ok)throw new Error(await r.text());return (await r.json()).tables;}
async function addField(tableId,f){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`,{method:'POST',headers:H,body:JSON.stringify(f)});if(r.ok){console.log('  + field',f.name);return;}const t=await r.text();if(/DUPLICATE|already/i.test(t)){console.log('  = field exists',f.name);return;}throw new Error(`field ${f.name}: ${t}`);}
(async()=>{
  const leads=(await tables()).find(t=>t.name==='Leads'); if(!leads)throw new Error('Leads table missing');
  const have=new Set(leads.fields.map(f=>f.name));
  for(const f of NEW_FIELDS){ if(have.has(f.name)) console.log('  = field exists',f.name); else await addField(leads.id,f); }
  console.log('done');
})().catch(e=>{console.error(e.message);process.exit(1);});
