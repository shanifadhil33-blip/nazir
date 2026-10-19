import type { SemanticResult } from '../../src/server/judge/judge';
import { unavailable, issueLabels } from '../../src/server/judge/judge';
export function semantic(status:SemanticResult['status']='supported',span='Your reply',issue:SemanticResult['issue']='none'):SemanticResult {
  return { ...unavailable({reply:span,prompt:'test'},'seed'),status,span,issue,labels:issueLabels[issue],reason:'Test evidence',provider:'fake',model:'fake',family:'google_gemma' };
}
