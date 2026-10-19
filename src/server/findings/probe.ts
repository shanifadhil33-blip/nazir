export function checkFindingComplete(finding:Record<string,unknown>):string[] {
  const evidence=(finding.evidence ?? {}) as Record<string,unknown>;
  const clause=(evidence.rule_clause ?? {}) as Record<string,unknown>;
  const missing:string[]=[];
  const blank=(v:unknown) => v===undefined || v===null || (typeof v==='string' && !v.trim());
  for(const key of ['title','title_ar','agent_said','really_happened','really_happened_ar','rule_clause','rule_pack_version_id','agent_version_id','root_cause_class','owner_role','severity','check_id','run_id','conversation_id','attempt','language']) if(blank(finding[key])) missing.push(key);
  for(const key of ['en','ar']) if(blank(clause[key])) missing.push('evidence.rule_clause.'+key);
  for(const key of ['expected','observed','registry_id','config_hash','reading_hash','transcript_hash','scenario_key','scenario_hash']) if(blank(evidence[key])) missing.push('evidence.'+key);
  if(!Array.isArray(evidence.receipts)) missing.push('evidence.receipts');
  return missing;
}
