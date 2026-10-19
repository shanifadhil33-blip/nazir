import { z } from 'zod';
import raw from './calibration/calibration.json' with { type: 'json' };
import { rubric, type JudgeInput } from './rubric';
import type { SemanticResult } from './judge';
const text=z.string().trim().min(1);
export const calibrationSchema=z.array(z.strictObject({ id:text,language:z.enum(['en','ar']),family:text,clause:text,resident_text:text,agent_reply:text,reading_facts:z.array(text),label:z.enum(['supported','contradicted','uncertain']),critical:z.boolean(),labelled_by:z.literal('builder label (not an independent human review)') }));
export const calibrationItems=calibrationSchema.parse(raw);
export type CalibrationItem=typeof calibrationItems[number];
export function calibrationInput(item:CalibrationItem):JudgeInput {
  return { reply:item.agent_reply,prompt:[rubric,JSON.stringify({ language:item.language,source:{ [item.language]:item.clause },facts:item.reading_facts }),'UNTRUSTED RESIDENT BEGIN',JSON.stringify(item.resident_text),'UNTRUSTED RESIDENT END','UNTRUSTED REPLY BEGIN',JSON.stringify(item.agent_reply),'UNTRUSTED REPLY END'].join('\n') };
}
export async function calibrate(judge:(input:JudgeInput,item:CalibrationItem) => Promise<SemanticResult|null>,items=calibrationItems) {
  const rows:{ id:string; label:CalibrationItem['label']; language:CalibrationItem['language']; critical:boolean; result:SemanticResult|null; agree:boolean }[]=[];
  for(const item of items) { const result=await judge(calibrationInput(item),item); rows.push({ id:item.id,label:item.label,language:item.language,critical:item.critical,result,agree:result!==null && result.status===item.label }); }
  const count=(selected:typeof rows) => ({ agreement:selected.filter((r) => r.agree).length,total:selected.length,unavailable:selected.filter((r) => r.result?.status==='unavailable').length,notRun:selected.filter((r) => r.result===null).length });
  const critical=rows.filter((r) => r.critical),tp=critical.filter((r) => r.label==='contradicted' && r.result?.status==='contradicted').length;
  return { rows,overall:count(rows),byLanguage:{ en:count(rows.filter((r) => r.language==='en')),ar:count(rows.filter((r) => r.language==='ar')) },critical:{ ...count(critical),precision:{ numerator:tp,denominator:critical.filter((r) => r.result?.status==='contradicted').length },recall:{ numerator:tp,denominator:critical.filter((r) => r.label==='contradicted').length } } };
}
