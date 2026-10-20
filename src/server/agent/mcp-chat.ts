import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, Forbidden, NotFound } from '../http/errors';
import { callServerTool, listServerTools } from './mcp-client';

type Server = { name: string; url: string };
type Options = Parameters<typeof listServerTools>[1];
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const listEn = /^(?:list|show)\s+(?:the\s+)?(?:mcp\s+)?tools\s+(?:on|from|of)\s+(.{1,60})$/i;
const listAr = /^(?:اعرض|أظهر)\s+أدوات\s+(.{1,60})$/u;
const callEn = /^call\s+([\w.:/-]{1,120})\s+on\s+(.{1,60}?)(?:\s+with\s+(\{[\s\S]{0,2000}\}))?$/i;
const callAr = /^(?:استدع|استدعِ|نفذ)\s+([\w.:/-]{1,120})\s+على\s+(.{1,60}?)(?:\s+(?:مع|بـ)\s*(\{[\s\S]{0,2000}\}))?$/u;
const approveEn = new RegExp(`^I approve MCP call (${uuid})\\b`, 'i');
const approveAr = new RegExp(`^أوافق على استدعاء MCP (${uuid})`, 'u');
const args = z.record(z.string(), z.unknown());

const refuse = (error: unknown) => { if (/cannot do this/.test(String((error as Error)?.message))) throw new Forbidden(); throw error; };
const reply = (en: string, ar: string) => ({ en, ar });
const out = (threadId: string | null, r: { en: string; ar: string }, data: unknown, done: boolean) => ({ thread_id: threadId, tool: 'mcp', source: 'fallback' as const, reply: r, data, done });

async function servers(driver: TransactionDriver, memberId: string): Promise<Server[]> {
  return withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ s: Server[] }>('SELECT nazir.agent_mcp_servers() AS s')).rows[0]!.s; } catch (e) { return refuse(e); }
  });
}
const find = (list: Server[], name: string) => list.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());

/** Handles MCP messages in the chat; returns null when the message is not about MCP so the normal agent answers. */
export async function mcpChat(driver: TransactionDriver, memberId: string, message: string, threadId: string | null, options: Options = {}) {
  const text = message.trim();
  const list = text.match(listEn) ?? text.match(listAr);
  const call = text.match(callEn) ?? text.match(callAr);
  const approve = text.match(approveEn) ?? text.match(approveAr);
  if (!list && !call && !approve) return null;

  if (approve) {
    const id = approve[1]!.toLowerCase();
    const row = await withMember(driver, memberId, async (sql) => {
      try { return (await sql.query<{ server_name: string; tool: string; arguments: Record<string, unknown> }>('SELECT * FROM nazir.mcp_call_approve($1)', [id])).rows[0]!; }
      catch (e) {
        const m = String((e as Error)?.message);
        if (m.includes('self_approval')) throw new Coded(403, 'four_eyes', 'Another member must decide.');
        if (m.includes('not_found')) throw new NotFound();
        if (m.includes('state')) throw new Coded(409, 'not_waiting', 'The request is not waiting for a decision.');
        return refuse(e);
      }
    });
    const server = find(await servers(driver, memberId), row.server_name);
    let ok = false; let excerpt = '';
    if (server) { try { const r = await callServerTool(server.url, row.tool, row.arguments, options); ok = r.ok; excerpt = r.text; } catch (e) { excerpt = String((e as Error).message).slice(0, 80); } }
    else excerpt = 'server_removed';
    await withMember(driver, memberId, (sql) => sql.query('SELECT nazir.mcp_call_finish($1,$2,$3)', [id, ok, excerpt]));
    return out(threadId, ok ? reply(`Approved and ran ${row.tool} on ${row.server_name}. The result is stored with the call record.`, `تمت الموافقة وتشغيل ${row.tool} على ${row.server_name}. النتيجة محفوظة مع سجل الاستدعاء.`)
      : reply(`Approved, but ${row.tool} on ${row.server_name} did not finish. Nothing was confirmed by the server.`, `تمت الموافقة، لكن ${row.tool} على ${row.server_name} لم يكتمل. لم يؤكد الخادم أي شيء.`), { id, ok, result: excerpt }, ok);
  }

  const name = (list ?? call)![list ? 1 : 2]!;
  const server = find(await servers(driver, memberId), name);
  if (!server) return out(threadId, reply(`There is no saved MCP server named ${name.trim()}.`, `لا يوجد خادم MCP محفوظ باسم ${name.trim()}.`), null, false);
  let tools;
  try { tools = await listServerTools(server.url, options); }
  catch (e) {
    const blocked = String((e as Error).message) === 'blocked_address';
    return out(threadId, blocked ? reply(`${server.name} points to a private or unsafe address, so Nazir did not contact it.`, `يشير ${server.name} إلى عنوان خاص أو غير آمن، لذلك لم يتصل به ناظر.`)
      : reply(`${server.name} did not answer. Nothing was run.`, `لم يستجب ${server.name}. لم يتم تشغيل أي شيء.`), null, false);
  }
  if (list) return out(threadId, reply(`${server.name} offers ${tools.length} tools: ${tools.map((t) => t.readOnly ? `${t.name} (read only)` : t.name).join(', ')}.`, `يقدم ${server.name} عدد ${tools.length} من الأدوات: ${tools.map((t) => t.readOnly ? `${t.name} (قراءة فقط)` : t.name).join('، ')}.`), { server: server.name, tools }, true);

  const tool = tools.find((t) => t.name === call![1]);
  if (!tool) return out(threadId, reply(`${server.name} has no tool named ${call![1]}.`, `لا توجد أداة باسم ${call![1]} على ${server.name}.`), null, false);
  let parsed: Record<string, unknown> = {};
  if (call![3]) { try { parsed = args.parse(JSON.parse(call![3])); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); } }
  if (!tool.readOnly) {
    const id = await withMember(driver, memberId, async (sql) => {
      try { return (await sql.query<{ id: string }>("SELECT nazir.mcp_call_record($1,$2,$3::jsonb,'proposed',NULL) AS id", [server.name, tool.name, JSON.stringify(parsed)])).rows[0]!.id; } catch (e) { return refuse(e); }
    });
    return out(threadId, reply(`${tool.name} can change data, so it did not run. Another owner or reviewer must send: I approve MCP call ${id}`, `يمكن أن تغير ${tool.name} البيانات، لذلك لم تعمل. يجب أن يرسل مالك أو مراجع آخر: أوافق على استدعاء MCP ${id}`), { id, status: 'proposed', server: server.name, tool: tool.name, arguments: parsed }, false);
  }
  let ok = false; let excerpt = '';
  try { const r = await callServerTool(server.url, tool.name, parsed, options); ok = r.ok; excerpt = r.text; } catch (e) { excerpt = String((e as Error).message).slice(0, 80); }
  const id = await withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ id: string }>('SELECT nazir.mcp_call_record($1,$2,$3::jsonb,$4,$5) AS id', [server.name, tool.name, JSON.stringify(parsed), ok ? 'done' : 'failed', excerpt])).rows[0]!.id; } catch (e) { return refuse(e); }
  });
  return out(threadId, ok ? reply(`Ran the read only tool ${tool.name} on ${server.name}.`, `تم تشغيل أداة القراءة ${tool.name} على ${server.name}.`) : reply(`${tool.name} on ${server.name} did not finish.`, `لم تكتمل ${tool.name} على ${server.name}.`), { id, ok, result: excerpt }, ok);
}
