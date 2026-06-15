// scripts/create-airtable-m2.js
const fs = require('fs'); const path = require('path');
function readEnv(){const t=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const o={};for(const l of t.split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].replace(/\s+#.*$/,'').trim();}return o;}
const env=readEnv(); const BASE=env.AIRTABLE_BASE_ID, PAT=env.AIRTABLE_PAT;
const H={Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'};
const NEW_LEAD_FIELDS=[
  {name:'email_stage',type:'number',options:{precision:0}},
  {name:'last_email_at',type:'dateTime',options:{timeZone:'utc',dateFormat:{name:'iso'},timeFormat:{name:'24hour'}}},
  {name:'next_email_at',type:'dateTime',options:{timeZone:'utc',dateFormat:{name:'iso'},timeFormat:{name:'24hour'}}},
  {name:'email_status',type:'singleSelect',options:{choices:[{name:'Not contacted'},{name:'Sent'},{name:'Replied'},{name:'Completed'}]}},
  {name:'replied',type:'checkbox',options:{icon:'check',color:'greenBright'}},
  {name:'last_email_subject',type:'singleLineText'},
  {name:'last_email_body',type:'multilineText'},
];
const CONFIG_FIELDS=[
  {name:'key',type:'singleLineText'},
  {name:'send_enabled',type:'checkbox',options:{icon:'check',color:'greenBright'}},
  {name:'daily_cap',type:'number',options:{precision:0}},
];
async function tables(){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{headers:H});if(!r.ok)throw new Error(await r.text());return (await r.json()).tables;}
async function addField(tableId,f){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables/${tableId}/fields`,{method:'POST',headers:H,body:JSON.stringify(f)});if(r.ok){console.log('  + field',f.name);return;}const t=await r.text();if(/DUPLICATE|already/i.test(t)){console.log('  = field exists',f.name);return;}throw new Error(`field ${f.name}: ${t}`);}
async function createTable(name,fields){const r=await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`,{method:'POST',headers:H,body:JSON.stringify({name,fields})});if(!r.ok)throw new Error(await r.text());console.log('created table',name);return (await r.json()).id;}
(async()=>{
  let ts=await tables();
  const leads=ts.find(t=>t.name==='Leads'); if(!leads)throw new Error('Leads table missing - run M1 setup first');
  const have=new Set(leads.fields.map(f=>f.name));
  console.log('Leads: adding missing fields');
  for(const f of NEW_LEAD_FIELDS){ if(have.has(f.name)){console.log('  = field exists',f.name);} else await addField(leads.id,f); }
  let cfg=ts.find(t=>t.name==='Config');
  if(!cfg){ await createTable('Config',CONFIG_FIELDS); ts=await tables(); cfg=ts.find(t=>t.name==='Config'); }
  else console.log('Config table exists');
  // ensure a single control row exists (kill switch OFF, cap 10 for warm-up)
  const rec=await fetch(`https://api.airtable.com/v0/${BASE}/Config?maxRecords=1`,{headers:H}).then(r=>r.json());
  if(!rec.records || !rec.records.length){
    await fetch(`https://api.airtable.com/v0/${BASE}/Config`,{method:'POST',headers:H,body:JSON.stringify({records:[{fields:{key:'main',send_enabled:false,daily_cap:10}}]})});
    console.log('seeded Config row: send_enabled=false, daily_cap=10 (warm-up)');
  } else console.log('Config row exists');
  console.log('done');
})().catch(e=>{console.error(e.message);process.exit(1);});
