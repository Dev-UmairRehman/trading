// scripts/create-airtable-handoff.js — add handoff/classification fields to Leads.
const fs = require('fs'); const path = require('path');
function readEnv(){const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const o={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/\s+#.*$/,'').trim();}return o;}
const env=readEnv(); const BASE=env.AIRTABLE_BASE_ID, PAT=env.AIRTABLE_PAT;
const H={Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'};
const NEW_FIELDS=[
  {name:'contactability',type:'singleSelect',options:{choices:[{name:'both'},{name:'email_only'},{name:'phone_only'},{name:'none'}]}},
  {name:'reply_classification',type:'singleSelect',options:{choices:[{name:'Interested'},{name:'NotInterested'},{name:'Question'}]}},
  {name:'reply_text',type:'multilineText'},
  {name:'manual_dispatched',type:'checkbox',options:{icon:'check',color:'greenBright'}},
];
async function tables(){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{headers:H});if(!r.ok)throw new Error(await r.text());return (await r.json()).tables;}
async function addField(tableId,f){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`,{method:'POST',headers:H,body:JSON.stringify(f)});if(r.ok){console.log('  + field',f.name);return;}const t=await r.text();if(/DUPLICATE|already/i.test(t)){console.log('  = field exists',f.name);return;}throw new Error(`field ${f.name}: ${t}`);}
(async()=>{
  const leads=(await tables()).find(t=>t.name==='Leads'); if(!leads)throw new Error('Leads table missing - run M1 setup first');
  const have=new Set(leads.fields.map(f=>f.name));
  for(const f of NEW_FIELDS){ if(have.has(f.name)) console.log('  = field exists',f.name); else await addField(leads.id,f); }
  console.log('done (status "HandedOff" auto-added on first typecast write)');
})().catch(e=>{console.error(e.message);process.exit(1);});
