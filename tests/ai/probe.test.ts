import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
import { expect, it, vi } from 'vitest';
import { probeOptions, runProbe } from '../../scripts/ai-chain-probe.mjs';
import { createAiChain } from '../../src/server/ai/chain';
import { memoryAiStore } from '../../src/server/ai/store';
it('parses the script without making network calls', async () => { await expect(execFile(process.execPath,['--check','scripts/ai-chain-probe.mjs'])).resolves.toHaveProperty('stderr', ''); });
it('bounds probe calls and requires a judge family', () => {
  expect(probeOptions({ MAX_CALLS:'99' }).maxCalls).toBe(20); expect(probeOptions({}).maxCalls).toBe(6);
  expect(() => probeOptions({ MAX_CALLS:'NaN' })).toThrow(); expect(() => probeOptions({ PROBE_PURPOSE:'judge' })).toThrow('family');
});
it('runs sequential fault scenarios with only fake fetch and a shared hard cap', async () => {
  const fetch = vi.fn(async () => Response.json({ choices:[{ message:{ content:null,tool_calls:[{ id:'one',type:'function',function:{ name:'create_case',arguments:'{"category":"complaint","prior_request_ref":"SR-1042","requester_name":"Saeed","needs_human_review":true}' } }] } }] }));
  const lines: string[] = [];
  const result = await runProbe({ createAiChain,memoryAiStore,fetch,env:{ MAX_CALLS:'2',REQUESTY_API_KEY:'sk-secret' },scenarios:true,print:(s: string) => lines.push(s) });
  expect(result).toEqual({ calls:2,exitCode:0 }); expect(fetch).toHaveBeenCalledTimes(2); expect(lines.join('\n')).toContain('forced_down'); expect(lines.join('\n')).not.toContain('sk-secret'); expect(lines.join('\n')).not.toContain('SR-1042');
});
it('exits one if the first scenario exhausts and never exceeds the fetch cap', async () => {
  const fetch = vi.fn(async () => new Response('bad',{ status:500 }));
  expect(await runProbe({ createAiChain,memoryAiStore,fetch,env:{ MAX_CALLS:'1' },scenarios:true,print:() => {} })).toEqual({ calls:1,exitCode:1 }); expect(fetch).toHaveBeenCalledOnce();
});
