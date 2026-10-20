import { Pool } from '@neondatabase/serverless';
const p=new Pool({connectionString:process.env.U});
const ids=process.argv.slice(2);
for (const id of ids) {
  const c=(await p.query(`SELECT c.id,c.status,c.result_summary,c.model_provider,s.stable_key,s.language,s.resident_turns,s.expected_state,s.checks,s.starting_state FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.id::text LIKE $1||'%'`,[id])).rows[0];
  if(!c){console.log('none',id);continue;}
  console.log('=====',c.stable_key,c.language,c.status,c.model_provider);
  console.log('TURNS',JSON.stringify(c.resident_turns).slice(0,700));console.log('EXPECT',JSON.stringify(c.expected_state).slice(0,500),JSON.stringify(c.checks).slice(0,300));console.log('START',JSON.stringify(c.starting_state).slice(0,400));
  const rs=c.result_summary?.records??c.result_summary?.results??[];
  for (const r of (Array.isArray(rs)?rs:rs.records??[])) if(r.status!=='pass') console.log('CHECK',r.id,JSON.stringify(r.evidence).slice(0,900));
  console.log('SAID',JSON.stringify(rs.find?.(r=>r.id==='reply_matches_record')?.evidence?.said??'').slice(0,700));
  const te=(await p.query(`SELECT tool_name,left(request::text,300) a,left(response::text,300) r FROM nazir.tool_events WHERE conversation_id=$1 ORDER BY seq`,[c.id]).catch(e=>({rows:[{tool_name:'ERR '+e.message}]}))).rows;
  for (const x of te) console.log('  TOOL',x.tool_name,x.a,'=>',x.r);
}
await p.end();
