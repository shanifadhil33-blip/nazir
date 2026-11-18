import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createNazir } from '../../public/sdk/1.0.1/nazir.mjs';
import { signingKeys, publicKeySet, testHeaders } from '../../src/server/sdk/signing';
const keys=signingKeys('MCP SDK containment test secret long enough')!,workspace='0f1e2d3c-4b5a-4968-8776-655443322110';
const key=`nzk_${workspace.replace(/-/g,'')}_${'A'.repeat(40)}`,session='ses_'+'c'.repeat(32),publicKeys=publicKeySet(keys).keys;
const signed=(turn:number,inject?:string)=>testHeaders({workspaceId:workspace,session,turn,mode:'security',inject},keys);
let posts:{url:string;body:{spans?:{kind:string;attributes:Record<string,unknown>}[];inventory?:{tools:{name:string;changes_data:boolean}[]}}}[]=[];
beforeEach(()=>{posts=[];vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{posts.push({url,body:JSON.parse(String(init.body))});return new Response('{}',{status:202});});});
afterEach(()=>vi.unstubAllGlobals());
it('unknown MCP writes execute normally unsigned but are blocked under valid signed tests',async()=>{
 const real=vi.fn(async(request:{name:string})=>({content:[{type:'text',text:'Changed '+request.name}]}));
 const sdk=createNazir({key,publicKeys});const client=sdk.wrapMcp({callTool:real},{name:'cases'});
 await client.callTool({name:'unseen_real_tool'});
 expect(real).toHaveBeenCalledOnce();expect(posts).toEqual([]);
 const forged={...signed(1),'X-Nazir-Signature':'forged'};
 await sdk.turn({headers:forged},()=>client.callTool({name:'delete_case'}));expect(real).toHaveBeenCalledTimes(2);expect(posts).toEqual([]);
 const blocked=await sdk.turn({headers:signed(2)},()=>client.callTool({name:'delete_case'}));
 expect(blocked).toEqual({blocked_by_test_mode:true});expect(real).toHaveBeenCalledTimes(2);
 const trace=posts.find(x=>x.body.spans)!.body.spans!;
 expect(trace.find(x=>x.kind==='nazir.blocked')?.attributes).toMatchObject({'gen_ai.tool.name':'cases.delete_case','nazir.mcp.server':'cases'});
 expect(posts.find(x=>x.body.inventory)!.body.inventory!.tools).toEqual([expect.objectContaining({name:'cases.delete_case',changes_data:true})]);
});
it('injects into actual MCP text content and dry runs an explicitly changing tool',async()=>{
 const original={content:[{type:'text',text:'Original document'}]};const real=vi.fn(async(_request:{name:string;arguments?:Record<string,string>})=>original),dry=vi.fn(async()=>({content:[{type:'text',text:'Would save'}]}));
 const sdk=createNazir({key,publicKeys});const client=sdk.wrapMcp({callTool:real},{name:'files',tools:{read:{annotations:{readOnlyHint:true}},save:{changesData:true,dryRun:dry}}});
 const inject=JSON.stringify({text:'Private test instruction'});
 const out=await sdk.turn({headers:signed(3,inject)},async()=>({read:await client.callTool({name:'read',arguments:{reference:'TEST-A'}} as never),write:await client.callTool({name:'save'} as never)}));
 expect(out.read).toEqual({content:[{type:'text',text:'Original document'},{type:'text',text:'Private test instruction'}]});
 expect(original.content).toHaveLength(1);expect(real).toHaveBeenCalledOnce();expect(dry).toHaveBeenCalledOnce();
 expect(posts.find(x=>x.body.spans)!.body.spans!.some(x=>x.attributes['nazir.dry_run']===true)).toBe(true);
});
it('removes SDK and bearer credentials from trace strings before exporting',async()=>{
 const sdk=createNazir({key,publicKeys}),read=sdk.tool('read',async()=>`Key ${key} Bearer client-secret-token-12345`);
 await sdk.turn({headers:signed(4)},async t=>{t.reply(await read());});
 const exported=JSON.stringify(posts);expect(exported).not.toContain(key);expect(exported).not.toContain('client-secret-token-12345');expect(exported).toContain('[credential]');expect(posts.find(x=>x.body.spans)!.body.spans!.some(s=>s.attributes['nazir.credentials_redacted']===true)).toBe(true);
});
it('Python wrapper contains unknown writes, injects into MCP text content and preserves unsigned real calls',()=>{
 const script=`
import asyncio,json,sys,urllib.request
sys.path.insert(0,'public/sdk/1.0.1')
import nazir
cfg=json.loads(sys.argv[1]);posts=[]
class Response:
 status=202
 def __enter__(self):return self
 def __exit__(self,*a):return False
 def read(self):return b'{}'
def fetch(req,timeout=None):posts.append(json.loads(req.data));return Response()
urllib.request.urlopen=fetch
class Client:
 def __init__(self):self.calls=[]
 async def call_tool(self,name,arguments=None):self.calls.append(name);return {'content':[{'type':'text','text':'Document'}]}
async def main():
 sdk=nazir.Nazir(key=cfg['key'],public_keys=cfg['keys']);client=Client();sdk.wrap_mcp(client,name='files',tools={'read':{'annotations':{'readOnlyHint':True}}})
 await client.call_tool('delete');assert client.calls==['delete'] and posts==[]
 with sdk.turn(cfg['headers']) as turn:
  blocked=await client.call_tool('delete',arguments={'reference':'TEST-A'})
  read=await client.call_tool('read')
  turn.reply('Finished')
 assert blocked=={'blocked_by_test_mode':True} and client.calls==['delete','read']
 assert read['content'][-1]['text']=='Private test instruction'
 spans=posts[0]['spans'];assert any(s['kind']=='nazir.blocked' and s['attributes']['nazir.mcp.server']=='files' for s in spans)
 print(json.dumps({'contained':True,'kinds':[s['kind'] for s in spans]}))
asyncio.run(main())
`;
 const config=JSON.stringify({key,keys:publicKeys,headers:signed(5,JSON.stringify({text:'Private test instruction'}))});
 const result=JSON.parse(execFileSync('python3',['-I','-c',script,config],{encoding:'utf8'}));expect(result.contained).toBe(true);
});
