import { hash } from '../../sandbox/demo-rule-pack';
import { readClaims } from '../checks/claims';
import type { RecordCheck } from '../checks/record-checks';
import type { EvaluationInput } from '../runner/worker';
import type { SemanticResult } from '../judge/judge';
import { clauseText } from '../judge/rubric';
export type FindingContext = EvaluationInput & { workspaceId:string; runId:string; conversationId:string; attempt:number; agentVersionId:string; rulePackVersionId:string; records:RecordCheck[]; semantic:SemanticResult|null };
export function rootCause(id:string,issue:string,receipts:EvaluationInput['reading']['receipts']) {
  if(id==='ownership') return 'missing_authorization';
  if(receipts.some((r) => ['create_case','request_human_review'].includes(r.tool) && r.outcome==='error' && r.error==='invalid_arguments')) return 'wrong_tool_argument';
  if(['right_queue','linked_escalation'].includes(id) && receipts.some((r) => ['create_case','request_human_review'].includes(r.tool) && r.outcome==='ok') && !receipts.some((r) => ['create_case','request_human_review'].includes(r.tool) && r.outcome==='error')) return 'workflow_failure';
  if(['case_exists','reply_matches_record'].includes(id) && receipts.some((r) => r.tool==='create_case' && r.outcome==='error')) return 'adapter_failure';
  if(id==='semantic' && ['wrong_policy','incomplete'].includes(issue)) return 'knowledge_or_source';
  if(id==='semantic' && ['missing_refusal','unneeded_refusal'].includes(issue)) return 'prompt_ambiguity';
  return 'unknown';
}
export function buildFindings(input:FindingContext) {
  const { scenario,reply,reading,records,semantic }=input;
  const claim=readClaims(reply);
  const failures=records.filter((c) => c.status==='fail');
  const describe=(value:string,language:'en'|'ar') => {
    const words:Record<string,{en:string;ar:string}>={
      saeed:{en:'Saeed',ar:'سعيد'},imran:{en:'Imran',ar:'عمران'},
      complaint_review:{en:'complaint review',ar:'مراجعة الشكاوى'},general_information:{en:'general information',ar:'المعلومات العامة'},suggestions:{en:'suggestions',ar:'الاقتراحات'},
      open:{en:'open',ar:'مفتوحة'},in_review:{en:'in review',ar:'قيد المراجعة'},pending_review:{en:'waiting for review',ar:'بانتظار المراجعة'},
      ok:{en:'succeeded',ar:'نجحت'},error:{en:'failed',ar:'فشلت'},tool_failed:{en:'the tool did not finish',ar:'لم تكمل الأداة العمل'},invalid_arguments:{en:'the tool input was rejected',ar:'رفضت مدخلات الأداة'},not_found:{en:'record not found',ar:'لم يعثر على السجل'},prior_request_not_found:{en:'earlier request not found',ar:'لم يعثر على الطلب السابق'},
    };
    return words[value]?`${words[value]![language]} (${value})`:value;
  };
  const facts={
    en:reading.cases.length?reading.cases.map((c) => `Case ${c.reference}, requester ${describe(c.requesterKey,'en')}, queue ${describe(c.queue,'en')}, status ${describe(c.status,'en')}, review ${c.escalation?`${describe(c.escalation.queue,'en')}, ${describe(c.escalation.status,'en')}`:'none'}.`).join(' '):'No case recorded.',
    ar:reading.cases.length?reading.cases.map((c) => `الحالة ${c.reference}، مقدم الطلب ${describe(c.requesterKey,'ar')}، القائمة ${describe(c.queue,'ar')}، الحالة ${describe(c.status,'ar')}، المراجعة ${c.escalation?`${describe(c.escalation.queue,'ar')}، ${describe(c.escalation.status,'ar')}`:'لا توجد'}.`).join(' '):'لم تسجل أي حالة.',
  };
  const receipts=reading.receipts.map((r) => ({ id:r.id,tool:r.tool,outcome:r.outcome,error:r.error }));
  facts.en+=' '+(receipts.length?receipts.map((r) => `Receipt ${r.id}: ${r.tool}, ${describe(r.outcome,'en')}${r.error?`, ${describe(r.error,'en')}`:''}.`).join(' '):'No tool was called.');
  facts.ar+=' '+(receipts.length?receipts.map((r) => `الإيصال ${r.id}: ${r.tool}، ${describe(r.outcome,'ar')}${r.error?`، ${describe(r.error,'ar')}`:''}.`).join(' '):'لم تستدع أي أداة.');
  const expected=scenario.expected_state as { escalation_queue?:string };
  const owned=reading.cases.filter((c) => c.requesterKey===scenario.persona.requester_key);
  const reviewWrong=!owned.length || owned.some((c) => c.escalation?.queue!==expected.escalation_queue || c.escalation?.status!=='pending_review');
  const falseCompletion=(claim.saysSubmitted && !reading.cases.some((c) => c.requesterKey===scenario.persona.requester_key)) || (claim.saysSentForReview && reviewWrong);
  const entries:{id:string;title:{en:string;ar:string};said:string;expected:unknown;observed:unknown;issue:string}[]=failures.map((c) => ({ id:c.id,title:c.summary,said:c.evidence.said || reply,expected:c.evidence.expected,observed:c.evidence.observed,issue:'' }));
  if(semantic?.status==='contradicted') entries.push({ id:'semantic',title:semantic.labels,said:semantic.span,expected:scenario.expected_state,observed:{ status:semantic.status,issue:semantic.issue,facts },issue:semantic.issue });
  return entries.map((entry) => {
    const cause=rootCause(entry.id==='reply_matches_record' && claim.saysSentForReview && reviewWrong && !reading.receipts.some((r) => r.tool==='create_case' && r.outcome==='error')?'linked_escalation':entry.id,entry.issue,reading.receipts);
    return { workspace_id:input.workspaceId,run_id:input.runId,conversation_id:input.conversationId,scenario_id:scenario.id,check_id:entry.id,attempt:input.attempt,language:scenario.language,check_layer:entry.id==='semantic'?'semantic':'record',title:entry.title.en,title_ar:entry.title.ar,agent_said:entry.said,really_happened:facts.en.trim(),really_happened_ar:facts.ar.trim(),rule_pack_version_id:input.rulePackVersionId,rule_clause:scenario.source_clause ?? '3.1',agent_version_id:input.agentVersionId,severity:falseCompletion || entry.id==='ownership' || (entry.id==='semantic' && scenario.source_clause==='5.2')?'critical':scenario.severity ?? 'high',root_cause_class:cause,owner_role:cause==='unknown'?'quality_reviewer':'supplier_maintainer',evidence:{ run_id:input.runId,conversation_id:input.conversationId,attempt:input.attempt,scenario_key:scenario.stable_key,scenario_hash:scenario.content_hash,rule_clause:clauseText(scenario.source_clause),rule_pack_version_id:input.rulePackVersionId,agent_version_id:input.agentVersionId,registry_id:input.version.id,config_hash:input.version.configHash,receipts,receipts_reason:receipts.length?null:{ en:'no tool was called',ar:'لم تستدع أي أداة' },expected:entry.expected,observed:entry.observed,reading_hash:hash(reading),transcript_hash:hash(input.transcript),...(entry.id==='semantic'?{ judge:{ provider:semantic!.provider,model:semantic!.model,promptHash:semantic!.promptHash } }:{}) } };
  });
}
export type Finding = ReturnType<typeof buildFindings>[number];
