import { expect,it } from 'vitest';
import { buildFindings,rootCause } from '../../src/server/findings/build';
import { checkFindingComplete } from '../../src/server/findings/probe';
import { runRecordChecks } from '../../src/server/checks/record-checks';
import { scenario,reading } from '../checks/helpers';
import { baselineVersion } from '../../src/sandbox/versions';
const r=reading();r.cases=[];
const input={scenario:{...scenario,content_hash:'hash'},version:baselineVersion,reply:'Your complaint was submitted, reference pending.',transcript:[],toolCalls:[],reading:r,workspaceId:'workspace',runId:'run',conversationId:'conversation',attempt:1,agentVersionId:'version',rulePackVersionId:'rules',records:runRecordChecks({scenario,reply:'Your complaint was submitted, reference pending.',reading:r,toolCalls:[]}),semantic:null};
const complete=buildFindings(input)[0]!;
it('builds a complete finding with the failed receipt id and actual record facts',()=>{expect(checkFindingComplete(complete)).toEqual([]);expect(complete.evidence.receipts).toHaveLength(1);expect(complete.really_happened).toContain('No case recorded');});
for(const key of ['title','title_ar','agent_said','really_happened','really_happened_ar','rule_clause','rule_pack_version_id','agent_version_id','root_cause_class','owner_role','severity','check_id','run_id','conversation_id','attempt','language'])it(`catches missing ${key}`,()=>{expect(checkFindingComplete({...complete,[key]:null})).toContain(key);expect(checkFindingComplete({...complete,[key]:' '})).toContain(key);});
for(const key of ['expected','observed','registry_id','config_hash','reading_hash','transcript_hash','scenario_key','scenario_hash','receipts'])it(`catches missing evidence ${key}`,()=>{expect(checkFindingComplete({...complete,evidence:{...complete.evidence,[key]:undefined}})).toContain('evidence.'+key);});
it.each(['en','ar'])('catches absent clause text %s',lang=>{expect(checkFindingComplete({...complete,evidence:{...complete.evidence,rule_clause:{...complete.evidence.rule_clause,[lang]:''}}})).toContain('evidence.rule_clause.'+lang);});
it('retains an explicit empty receipt list and a bilingual reason',()=>{const f=buildFindings({...input,reading:{...r,receipts:[]}})[0]!;expect(f.evidence.receipts).toEqual([]);expect(f.evidence.receipts_reason).toEqual({en:'no tool was called',ar:'لم تستدع أي أداة'});});
it.each([
 ['ownership','','missing_authorization'],['right_queue','','workflow_failure'],['linked_escalation','','workflow_failure'],['semantic','wrong_policy','knowledge_or_source'],['semantic','incomplete','knowledge_or_source'],['semantic','missing_refusal','prompt_ambiguity'],['semantic','unneeded_refusal','prompt_ambiguity'],['duplicates','','unknown'],
])('maps %s %s to %s',(id,issue,cause)=>{expect(rootCause(id,issue,r.receipts)).toBe(cause);});
it('maps failed writes and bad arguments',()=>{expect(rootCause('case_exists','',[{...r.receipts[0]!,outcome:'error',error:'tool_failed'}])).toBe('adapter_failure');expect(rootCause('case_exists','',[{...r.receipts[0]!,outcome:'error',error:'invalid_arguments'}])).toBe('wrong_tool_argument');});
