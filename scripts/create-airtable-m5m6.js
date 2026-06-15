// scripts/create-airtable-m5m6.js — add M5/M6 flags to Leads (idempotent).
const fs = require('fs'); const path = require('path');
function readEnv(){const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const o={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/\s+#.*$/,'').trim();}return o;}
const env=readEnv(); const BASE=env.AIRTABLE_BASE_ID, PAT=env.AIRTABLE_PAT;
const H={Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'};
const CHK={icon:'check',color:'greenBright'};
const NEW_FIELDS=[
  {name:'wapi_prompted',type:'checkbox',options:CHK},   // M5: operator was emailed a WhatsApp link
  {name:'voice_suggested',type:'checkbox',options:CHK}, // M6: qualifies for a call, awaiting approval
  {name:'voice_approved',type:'checkbox',options:CHK},  // M6: operator approved the paid call (gate)
  {name:'voice_done',type:'checkbox',options:CHK},      // M6: call placed
];
async function tables(){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{headers:H});if(!r.ok)throw new Error(await r.text());return (await r.json()).tables;}
async function addField(tableId,f){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`,{method:'POST',headers:H,body:JSON.stringify(f)});if(r.ok){console.log('  + field',f.name);return;}const t=await r.text();if(/DUPLICATE|already/i.test(t)){console.log('  = field exists',f.name);return;}throw new Error(`field ${f.name}: ${t}`);}
(async()=>{
  const leads=(await tables()).find(t=>t.name==='Leads'); if(!leads)throw new Error('Leads table missing');
  const have=new Set(leads.fields.map(f=>f.name));
  for(const f of NEW_FIELDS){ if(have.has(f.name)) console.log('  = field exists',f.name); else await addField(leads.id,f); }
  console.log('done');
})().catch(e=>{console.error(e.message);process.exit(1);});
