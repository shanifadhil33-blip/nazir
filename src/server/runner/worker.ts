import 'server-only';
import { withWorker } from '../db/context';
import type { TransactionDriver, SqlConnection } from '../db/driver';
import { createInspectionChannel, type StateReading } from '../inspection/channel';
import { runServiceAgent, type ChatModel, type Message } from '../../sandbox/agent';
import type { AgentVersion } from '../../sandbox/versions';
import { resolveExecutable } from '../repair/executable';
import { hash } from '../../sandbox/demo-rule-pack';
import { AiChainExhausted, type CallMeta } from '../ai/chain';
import { networkChatModel, type RunnerModel } from './network-model';
import type { RunnerScenario } from './demo-scenarios';
import { buildJudgeInput, buildPackJudgeInput } from '../judge/rubric';
import { searchKnowledgeForWorker } from '../knowledge/knowledge';
import { judgeNotes, type FrozenLesson } from '../memory/frozen';
import { unavailable, type SemanticResult } from '../judge/judge';
import type { Family } from '../ai/providers';
import { combineVerdicts } from '../judge/evaluate';
import { networkJudge } from './network-judge';
import { buildFindings } from '../findings/build';
import { buildPackFindings, packRecord } from '../findings/pack';
import { caseFromRow, resolvePackVersion, runtimeForSeed } from '../packs/runtime';
import { applyBoundedStop } from '../planner/stop';
import type { RecordCheck } from '../checks/record-checks';
import { runRecordChecks, recordChecksEvaluator } from '../checks/record-checks';
type ToolEvents = Awaited<ReturnType<typeof runServiceAgent>>['toolCalls'];
export type EvaluationInput = { scenario: RunnerScenario; version: AgentVersion; reply: string; transcript: Message[]; toolCalls: ToolEvents; reading: StateReading; expectedTenant?: string };
export type Verdict = { status: 'passed' | 'failed' | 'inconclusive'; reason?: string; results: unknown };
export const defaultEvaluator = recordChecksEvaluator;
export type ModelContext = { workspaceId: string; conversationId: string; onCall: (meta: CallMeta) => void; reserveCall: () => Promise<void>; remainingMs: () => number };
type Claim = { workspace_id: string; conversation_id: string; run_id: string; attempt: number };
const infrastructure = new Set(['provider_exhausted','timeout','lease_expired','dirty_tenant','reading_failed']);
const code = (s: unknown) => typeof s==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(s) ? s : 'checks_missing';
export type JudgeFactory = (context: ModelContext) => (input: { input: ReturnType<typeof buildJudgeInput>; agentFamilies: Family[]; seed: string }) => Promise<SemanticResult>;
export async function runNextConversation({ driver,inspectionDriver,chatModelFactory,judgeFactory,evaluate=defaultEvaluator,workerId,leaseSeconds=60,conversationTimeoutMs=180000,now=Date.now,runId }: {
  driver: TransactionDriver; inspectionDriver: TransactionDriver; chatModelFactory?: (context: ModelContext) => ChatModel | RunnerModel | Promise<ChatModel | RunnerModel>;
  judgeFactory?: JudgeFactory;
  evaluate?: (input: EvaluationInput) => Verdict | Promise<Verdict>; workerId: string; runId?: string; leaseSeconds?: number; conversationTimeoutMs?: number; now?: () => number;
}) {
  if (!Number.isFinite(conversationTimeoutMs) || conversationTimeoutMs<=0) throw new Error('Invalid conversation deadline');
  const claim = await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await (runId ? db.query<Claim>('SELECT * FROM nazir.runner_claim($1,$2,$3)',[workerId,leaseSeconds,runId]) : db.query<Claim>('SELECT * FROM nazir.runner_claim($1,$2)',[workerId,leaseSeconds]))).rows[0]; });
  if (!claim) return null;
  const { workspace_id:wid,conversation_id:cid,run_id:rid,attempt } = claim;
  const work = <T>(fn: (db: SqlConnection) => Promise<T>) => withWorker(driver,wid,fn);
  const data = await work(async (db) => {
    const c = (await db.query<{ sandbox_tenant: string; max_attempts: number; agent_version_id: string; scenario_hash: string }>('SELECT sandbox_tenant,max_attempts,agent_version_id,scenario_hash FROM nazir.conversations WHERE id=$1',[cid])).rows[0]!;
    const scenario = (await db.query<RunnerScenario & Record<string,unknown>>('SELECT s.*,m.canonical FROM nazir.scenarios s JOIN nazir.scenario_meanings m ON m.id=s.meaning_id WHERE s.id=(SELECT scenario_id FROM nazir.conversations WHERE id=$1)',[cid])).rows[0]!;
    const run = (await db.query<{ frozen_manifest: { registry_id: string; configHash: string; recordsOnly?: boolean; lessons?: FrozenLesson[]; repair?: { parent_registry_id?: string; patch?: unknown; executable_hash?: string } }; rule_pack_version_id:string }>('SELECT frozen_manifest,rule_pack_version_id FROM nazir.runs WHERE id=$1',[rid])).rows[0]!;
    return { ...c,scenario,manifest:run.frozen_manifest,rulePackVersionId:run.rule_pack_version_id };
  });
  const tenant = data.sandbox_tenant, channel = createInspectionChannel(inspectionDriver);
  const end = now()+conversationTimeoutMs;
  let judging=false;
  let lost=false,reason: string | undefined, stopped=false;
  let transcript: Message[]=[],reply='',reading: StateReading | undefined;
  const toolCalls: ToolEvents=[];
  const metas: CallMeta[]=[];
  let semantic:SemanticResult|null=null;
  let records:RecordCheck[]=[];
  let evaluationInput:EvaluationInput|undefined;
  const active = () => { if (lost || stopped) throw new Error('Attempt stopped'); if (now()>=end) { reason='timeout'; throw new Error('Attempt timeout'); } };
  // A lock fences each sandbox transaction against takeover and cancellation.
  const fence = async (db: SqlConnection) => {
    await db.query('SET LOCAL ROLE nazir_worker');
    await db.query("SELECT set_config('app.workspace_id',$1,true)",[wid]);
    const match = (await db.query("SELECT id FROM nazir.conversations WHERE id=$1 AND status='running' AND lease_owner=$2 AND attempt=$3 AND lease_expires_at>clock_timestamp() FOR UPDATE",[cid,workerId,attempt])).rows[0];
    if (!match) { lost=true; throw new Error('Lease lost'); }
  };
  const fencedDriver: TransactionDriver = { transaction: (fn) => driver.transaction(async (db) => { active(); await fence(db); active(); return fn(db); }) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beatBusy=false;
  const beat = setInterval(() => {
    if (beatBusy || stopped || lost) return;
    beatBusy=true;
    void work(async (db) => {
      const ok=(await db.query<{ ok: boolean }>('SELECT nazir.runner_heartbeat($1,$2,$3,$4) AS ok',[cid,workerId,attempt,leaseSeconds])).rows[0]!.ok;
      if (!ok) lost=true;
    }).catch(() => { lost=true; }).finally(() => { beatBusy=false; });
  },leaseSeconds*1000/3);
  let verdict: Verdict = { status:'inconclusive',reason:'reading_missing',results:[] };
  const deadline = new Promise<never>((_,reject) => { timer=setTimeout(() => { if(!judging) { reason='timeout'; stopped=true; } reject(new Error('Attempt timeout')); },conversationTimeoutMs); });
  const bounded = <T>(p: Promise<T>) => Promise.race([p,deadline]);
  const runtime = runtimeForSeed(data.scenario.starting_state);
  let packReading: unknown;
  let packFindings: ReturnType<typeof buildPackFindings> = [];
  const packAttempt = async (rt: NonNullable<typeof runtime>) => {
    const resolved = resolvePackVersion({ registry_id:data.manifest.registry_id });
    if (!resolved || resolved.runtime!==rt || resolved.version.configHash!==data.manifest.configHash || data.scenario.content_hash!==data.scenario_hash) { reason='version_drifted'; return; }
    const c = caseFromRow(data.scenario as unknown as Record<string, unknown>);
    await bounded(work(async (db) => { await fence(db); await rt.prepare(db,tenant,c); }));
    if (!rt.clean(await bounded(rt.read(inspectionDriver,tenant)),c)) { reason='dirty_tenant'; return; }
    const reserveCall = async () => {
      active();
      const reserved = await work(async (db) => {
        await db.query('SELECT id FROM nazir.runs WHERE id=$1 FOR UPDATE',[rid]);
        await fence(db);
        active();
        return (await db.query("UPDATE nazir.runs SET calls_used=calls_used+1 WHERE id=$1 AND status='running' AND calls_used<calls_budget RETURNING id",[rid])).rows.length>0;
      });
      if (!reserved) { reason='budget_reached'; throw new Error('Budget reached'); }
    };
    const context: ModelContext = { workspaceId:wid,conversationId:cid,onCall:(meta) => { metas.push(meta); },reserveCall,remainingMs:() => Math.max(1,end-now()) };
    const supplied = await bounded(Promise.resolve(chatModelFactory ? chatModelFactory(context) : networkChatModel(driver,context)));
    const base = typeof supplied==='function' ? supplied : supplied.model;
    const model: ChatModel = async (request) => {
      active();
      if (typeof supplied==='function') await reserveCall();
      try { const response=await bounded(base(request)); active(); return response; }
      catch (error) { if (error instanceof AiChainExhausted) reason ??= error.attempts.length && error.attempts.every((a) => a.reason==='cap_reached' || a.reason==='no_key') && error.attempts.some((a) => a.reason==='cap_reached') ? 'daily_cap' : 'provider_exhausted'; throw error; }
    };
    for (const content of c.resident_turns) {
      if (reason || lost) break;
      active();
      transcript.push({ role:'user',content });
      const result=await rt.run({ model,version:resolved.version,messages:transcript,sandbox:{ driver:fencedDriver,tenant,requesterKey:c.persona.requester_key },conversationKey:cid });
      transcript=result.transcript.filter((m) => m.role!=='system'); reply=result.reply; toolCalls.push(...(result.toolCalls as ToolEvents));
    }
    if (lost) return;
    try { packReading=await bounded(rt.read(inspectionDriver,tenant)); } catch { reason ??= 'reading_failed'; return; }
    if (reason) return;
    try {
      records=rt.checks({ scenario:c,reply,reading:packReading }).map((k) => packRecord(rt,c,k));
      verdict={ ...combineVerdicts(records,null),results:{ records } };
      if (!data.manifest.recordsOnly) {
        judging=true;
        const agentId=await work(async (db) => (await db.query<{agent_id:string}>('SELECT agent_id FROM nazir.agent_versions WHERE id=$1',[data.agent_version_id])).rows[0]?.agent_id ?? null).catch(() => null);
        const knowledge=await searchKnowledgeForWorker(driver,wid,c.resident_turns.join(' '),agentId);
        const input=buildPackJudgeInput({ pack:rt.pack,clause:rt.clause(c.source_clause),scenario:c,reply,facts:rt.facts(packReading,c).judge,notes:judgeNotes(data.manifest.lessons,c.family),knowledge }),seed=`${cid}:${attempt}`;
        const prior=(await work(async (db) => (await db.query<{model_calls:{family?:Family}[]}>('SELECT model_calls FROM nazir.conversations WHERE id=$1',[cid])).rows[0]!.model_calls));
        const agentFamilies=[...new Set([...prior.map((m) => m.family ?? 'unknown'),...metas.map((m) => m.family)])];
        try {
          const judge=judgeFactory?judgeFactory(context):networkJudge(driver,context);
          semantic=await bounded(judge({ input:input as ReturnType<typeof buildJudgeInput>,agentFamilies,seed }));
        } catch { semantic=unavailable(input,seed); }
        if(reason==='budget_reached' || reason==='timeout') reason=undefined;
        judging=false;
        verdict={ ...combineVerdicts(records,semantic),results:{ records,semantic } };
      }
      packFindings=buildPackFindings({ runtime:rt,scenarioRow:data.scenario as unknown as { id:string; stable_key:string; content_hash:string; language:string; family:string },scenario:c,reply,transcript,toolCalls,reading:packReading,records,semantic,workspaceId:wid,runId:rid,conversationId:cid,attempt,agentVersionId:data.agent_version_id,rulePackVersionId:data.rulePackVersionId,version:resolved.version,lessons:data.manifest.lessons });
    } catch { reason ??= 'bad_evaluator'; }
  };
  try {
    // A non Government pack drives its own sandbox, checks and judge; Government keeps the exact path below.
    if (runtime) await packAttempt(runtime);
    else {
    const version = resolveExecutable({ registry_id:data.manifest.registry_id,...(data.manifest.repair ?? {}) });
    if (!version || version.configHash!==data.manifest.configHash || data.scenario.content_hash!==data.scenario_hash) { reason='version_drifted'; }
    else {
      await bounded(work(async (db) => { await fence(db); await db.query('SELECT sandbox.seed_tenant($1)',[tenant]);
        try { await db.query('SAVEPOINT seed_state'); await db.query('SELECT sandbox.seed_tenant_state($1,$2::jsonb)',[tenant,JSON.stringify(data.scenario.starting_state ?? {})]); await db.query('RELEASE SAVEPOINT seed_state'); }
        catch { await db.query('ROLLBACK TO SAVEPOINT seed_state'); reason='dirty_tenant'; } }));
      const before = await bounded(channel.snapshot(tenant));
      const seeded=data.scenario.starting_state?.cases ?? [];
      const expectedFault=data.scenario.starting_state?.tool_failure==='create_case';
      if (reason || before.cases.length!==seeded.length || before.cases.some((c) => c.escalation || !seeded.some((e) => e.reference===c.reference && e.requester_key===c.requesterKey && e.queue===c.queue && e.status===c.status)) || before.receipts.length || (before.tenantFaults?.length ?? 0)!==(expectedFault?1:0)) reason='dirty_tenant';
      else {
        const reserveCall = async () => {
          active();
          const reserved = await work(async (db) => {
            await db.query('SELECT id FROM nazir.runs WHERE id=$1 FOR UPDATE',[rid]);
            await fence(db);
            active();
            return (await db.query("UPDATE nazir.runs SET calls_used=calls_used+1 WHERE id=$1 AND status='running' AND calls_used<calls_budget RETURNING id",[rid])).rows.length>0;
          });
          if (!reserved) { reason='budget_reached'; throw new Error('Budget reached'); }
        };
        const context: ModelContext = { workspaceId:wid,conversationId:cid,onCall:(meta) => { metas.push(meta); },reserveCall,remainingMs:() => Math.max(1,end-now()) };
        const supplied = await bounded(Promise.resolve(chatModelFactory ? chatModelFactory(context) : networkChatModel(driver,context)));
        const base = typeof supplied==='function' ? supplied : supplied.model;
        const model: ChatModel = async (request) => {
          active();
          if (typeof supplied==='function') await reserveCall();
          try { const response=await bounded(base(request)); active(); return response; }
          // Every model refused on the daily cap: retrying today cannot help, so the conversation ends with daily_cap (21 Oct 2026).
          catch (error) { if (error instanceof AiChainExhausted) reason ??= error.attempts.length && error.attempts.every((a) => a.reason==='cap_reached' || a.reason==='no_key') && error.attempts.some((a) => a.reason==='cap_reached') ? 'daily_cap' : 'provider_exhausted'; throw error; }
        };
        for (const content of data.scenario.persona.resident_turns) {
          if (reason || lost) break;
          active();
          transcript.push({ role:'user',content });
          const result=await runServiceAgent({ model,version,messages:transcript,sandbox:{ driver:fencedDriver,tenant,requesterKey:data.scenario.persona.requester_key },conversationKey:cid });
          transcript=result.transcript.filter((m) => m.role!=='system'); reply=result.reply; toolCalls.push(...result.toolCalls);
        }
        if (!lost) {
          try { reading=await bounded(channel.snapshot(tenant)); } catch { reason ??= 'reading_failed'; }
          if (reading && !reason) {
            try {
              evaluationInput={ scenario:data.scenario,version,reply,transcript,toolCalls,reading,expectedTenant:tenant };
              // Records always run, including when a supplied evaluator or judge cannot answer.
              records=recordChecksEvaluator(evaluationInput).results as RecordCheck[];
              verdict=await bounded(Promise.resolve(evaluate(evaluationInput)));
              if(!data.manifest.recordsOnly) {
                judging=true;
                // Cited owner knowledge for the judge; any failure means none, never a failed conversation.
                const agentId=await work(async (db) => (await db.query<{agent_id:string}>('SELECT agent_id FROM nazir.agent_versions WHERE id=$1',[data.agent_version_id])).rows[0]?.agent_id ?? null).catch(() => null);
                const knowledge=await searchKnowledgeForWorker(driver,wid,data.scenario.persona.resident_turns.join(' '),agentId);
                const input=buildJudgeInput({ ...evaluationInput,notes:judgeNotes(data.manifest.lessons,String((data.scenario as Record<string,unknown>).family ?? '')),knowledge }),seed=`${cid}:${attempt}`;
                const prior=(await work(async (db) => (await db.query<{model_calls:{family?:Family}[]}>('SELECT model_calls FROM nazir.conversations WHERE id=$1',[cid])).rows[0]!.model_calls));
                const agentFamilies=[...new Set([...prior.map((m) => m.family ?? 'unknown'),...metas.map((m) => m.family)])];
                try {
                  const judge=judgeFactory?judgeFactory(context):networkJudge(driver,context);
                  semantic=await bounded(judge({ input,agentFamilies,seed }));
                } catch { semantic=unavailable(input,seed); }
                // A judge budget refusal belongs to the semantic result, not a retry.
                if(reason==='budget_reached' || reason==='timeout') reason=undefined;
                judging=false;
                verdict={ ...combineVerdicts(records,semantic),results:{ records,semantic } };
              }
            }
            catch { reason ??= 'bad_evaluator'; }
          }
        }
      }
    }
    }
  } catch { reason ??= 'reading_failed'; }
  finally { clearTimeout(timer); clearInterval(beat); stopped=true; }
  if (lost) return { ...claim,lost:true };
  if (!verdict || !['passed','failed','inconclusive'].includes(verdict.status)) { reason='bad_evaluator'; verdict={ status:'inconclusive',reason:'bad_evaluator',results:[] }; }
  if(!evaluationInput && !runtime) records=runRecordChecks({scenario:data.scenario,reply,toolCalls,reading,expectedTenant:tenant});
  const missingReadingResults = () => evaluate===recordChecksEvaluator ? recordChecksEvaluator({ scenario:data.scenario,reply,toolCalls,reading:undefined,expectedTenant:tenant }).results : {};
  if (reason) verdict={ status:'inconclusive',reason,results:reading || runtime ? {} : missingReadingResults() };
  if (!runtime && !reading && !reason) verdict={ status:'inconclusive',reason:'reading_failed',results:missingReadingResults() };
  if (runtime && !packReading && !reason) verdict={ status:'inconclusive',reason:'reading_failed',results:{} };
  const status=verdict.status, resultReason=status==='inconclusive' ? code(verdict.reason) : verdict.reason ? code(verdict.reason) : null;
  const retry=status==='inconclusive' && infrastructure.has(resultReason!) && attempt<data.max_attempts;
  return work(async (db) => {
    // The run lock also serializes aggregation and cancellation.
    await db.query('SELECT id FROM nazir.runs WHERE id=$1 FOR UPDATE',[rid]);
    const match=(await db.query("SELECT id FROM nazir.conversations WHERE id=$1 AND status='running' AND lease_owner=$2 AND attempt=$3 AND lease_expires_at>clock_timestamp() FOR UPDATE",[cid,workerId,attempt])).rows[0];
    if (!match) return { ...claim,lost:true };
    let seq=Number((await db.query<{ n: number }>('SELECT coalesce(max(seq),0) AS n FROM nazir.conversation_messages WHERE conversation_id=$1',[cid])).rows[0]!.n);
    for (const m of transcript) if ((m.role==='user' || m.role==='assistant') && m.content) await db.query('INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body,attempt) VALUES($1,$2,$3,$4,$5,$6)',[wid,cid,++seq,m.role==='user'?'resident':'agent',m.content,attempt]);
    let toolSeq=Number((await db.query<{ n: number }>('SELECT coalesce(max(seq),0) AS n FROM nazir.tool_events WHERE conversation_id=$1',[cid])).rows[0]!.n);
    for (const t of toolCalls) await db.query('INSERT INTO nazir.tool_events(workspace_id,conversation_id,seq,tool_name,request,response,outcome,idempotency_key,attempt,tool_idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[wid,cid,++toolSeq,t.name,JSON.stringify(t.arguments),JSON.stringify(t.result),t.result.ok?'ok':'error',`${cid}:${t.name}:${hash(t.arguments)}:attempt_${attempt}:event_${toolSeq}`,attempt,`${cid}:${t.name}:${hash(t.arguments)}`]);
    if (reading) await db.query("INSERT INTO nazir.state_readings(workspace_id,conversation_id,source,reading,attempt) VALUES($1,$2,'inspection_channel',$3,$4)",[wid,cid,JSON.stringify(reading),attempt]);
    if (packReading) await db.query("INSERT INTO nazir.state_readings(workspace_id,conversation_id,source,reading,attempt) VALUES($1,$2,'inspection_channel',$3,$4)",[wid,cid,JSON.stringify({ pack:runtime!.id,...(packReading as object) }),attempt]);
    const meta=metas.at(-1);
    const summary={ results:data.manifest.recordsOnly?verdict.results ?? {}:{ records,semantic },records,semantic,calls:metas.map((m) => ({ provider:m.provider,model:m.model,failover:m.failover })) };
    await db.query(`UPDATE nazir.conversations SET status=$4,inconclusive_reason=CASE WHEN $4 IN ('inconclusive','queued') THEN $5 ELSE NULL END,last_error=$5,available_at=$6,finished_at=CASE WHEN $7 THEN NULL ELSE clock_timestamp() END,result_summary=$8,model_provider=$9,model_id=$10,failover=$11,model_calls=model_calls || $12::jsonb,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_owner=$2 AND attempt=$3 AND status='running'`,[cid,workerId,attempt,retry?'queued':status,resultReason,new Date(now()+30000*attempt),retry,retry?null:JSON.stringify(summary),meta?.provider ?? null,meta?.model ?? null,metas.some((m) => m.failover),JSON.stringify(metas.map((m) => ({ attempt,provider:m.provider,model:m.model,family:m.family,failover:m.failover })))]);
    if(!retry && (packReading || (evaluationInput && reading)) && status!=='inconclusive') {
      const findings=runtime?packFindings:buildFindings({ ...evaluationInput!,workspaceId:wid,runId:rid,conversationId:cid,attempt,agentVersionId:data.agent_version_id,rulePackVersionId:data.rulePackVersionId,records,semantic,lessons:data.manifest.lessons });
      for(const finding of findings) {
        const previous = (await db.query<{ id: string }>('SELECT id FROM nazir.findings WHERE run_id=$1 AND scenario_id=$2 AND check_id=$3', [rid, data.scenario.id, finding.check_id])).rows[0];
        if (previous) {
          await db.query('INSERT INTO nazir.finding_attempts(workspace_id,finding_id,conversation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [wid, previous.id, cid]);
          continue;
        }
        const fields=Object.keys(finding),values=Object.values(finding).map((v) => typeof v==='object'?JSON.stringify(v):v);
        const inserted=(await db.query<{id:string}>(`INSERT INTO nazir.findings(${fields.join(',')}) VALUES(${values.map((_,i) => '$'+(i+1)).join(',')}) ON CONFLICT(workspace_id,conversation_id,check_id) DO NOTHING RETURNING id`,values)).rows[0];
        if (inserted) await db.query('INSERT INTO nazir.finding_attempts(workspace_id,finding_id,conversation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [wid, inserted.id, cid]);
        if(inserted) await db.query("SELECT nazir.append_audit('finding_opened','finding',$1,$2)",[inserted.id,JSON.stringify({run_id:rid,conversation_id:cid,check_id:finding.check_id,severity:finding.severity,root_cause_class:finding.root_cause_class})]);
      }
    }
    await db.query('SELECT nazir.append_audit($1,\'conversation\',$2,$3)',[retry?'conversation_retried':'conversation_finished',cid,JSON.stringify({ run_id:rid,attempt,status,reason:resultReason,provider:meta?.provider ?? null,model:meta?.model ?? null,failover:metas.some((m) => m.failover) })]);
    await applyBoundedStop(db, rid);
    await db.query('SELECT nazir.runner_aggregate($1)',[rid]);
    return { ...claim,status:retry?'queued':status,reason:resultReason,tenant };
  });
}
