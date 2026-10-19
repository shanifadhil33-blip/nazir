import type { RecordCheck } from '../checks/record-checks';
import type { SemanticResult } from './judge';
export function combineVerdicts(records:RecordCheck[],semantic:SemanticResult|null) {
  if(records.some((r) => r.status==='fail')) return { status:'failed' as const };
  if(records.some((r) => r.status==='inconclusive')) return { status:'inconclusive' as const,reason:'records_inconclusive' };
  if(!semantic) return { status:'passed' as const };
  if(semantic.status==='contradicted') return { status:'failed' as const };
  if(semantic.status==='supported') return { status:'passed' as const };
  return { status:'inconclusive' as const,reason:semantic.status==='uncertain'?'judge_uncertain':'judge_unavailable' };
}
