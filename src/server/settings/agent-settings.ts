import 'server-only';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, Forbidden } from '../http/errors';
import { publicHttpsUrl, type Resolver } from './net-guard';

export const avatarPresets = ['preset:1', 'preset:2', 'preset:3', 'preset:4', 'preset:5', 'preset:6'] as const;
export const integrationIds = ['slack', 'gmail', 'google_drive', 'github', 'notion', 'microsoft_teams', 'whatsapp_business', 'zendesk'] as const;
export const llmProviders = ['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'custom'] as const;
export type LlmProvider = typeof llmProviders[number];
export const providerBaseUrl: Record<Exclude<LlmProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
};

/** Only public https hosts; refuses loopback, private and link local literals so the server cannot be pointed inward. */
export function safeHttpsUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (host.includes(':')) return false; // IPv6 literals are refused outright.
  return true;
}

const dataAvatar = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function avatarOk(value: string) {
  if ((avatarPresets as readonly string[]).includes(value)) return true;
  const match = value.match(dataAvatar);
  if (!match || value.length > 280000) return false;
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  const kind = match[1];
  if (kind === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
}

export const settingsInput = z.object({
  name: z.string().trim().min(1).max(60),
  instructions: z.string().max(2000).default(''),
  language: z.enum(['en', 'ar']),
  avatar: z.string().max(280000).refine(avatarOk, 'avatar'),
  mcp_servers: z.array(z.object({ name: z.string().trim().min(1).max(60), url: z.string().trim().max(300).refine(safeHttpsUrl, 'url') }).strict()).max(10).default([]),
  integrations: z.array(z.enum(integrationIds)).max(integrationIds.length).default([]).transform((list) => [...new Set(list)]),
  llm: z.object({
    provider: z.enum(llmProviders),
    model: z.string().trim().min(1).max(120).regex(/^[\w.:/@-]+$/),
    base_url: z.string().trim().max(300).optional(),
    api_key: z.string().trim().min(8).max(400).regex(/^[\x21-\x7e]+$/).optional(),
    clear_key: z.boolean().optional(),
  }).strict().nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.llm?.provider === 'custom' && !(value.llm.base_url && safeHttpsUrl(value.llm.base_url))) ctx.addIssue({ code: 'custom', message: 'base_url', path: ['base_url'] });
});

function keyMaterial(secret = process.env.AUTH_SECRET) {
  if (!secret || secret.length < 16) throw new Error('Server secret missing');
  return Buffer.from(hkdfSync('sha256', secret, 'nazir-agent-settings', 'model-key-v1', 32));
}
export function sealKey(plain: string, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyMaterial(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}
export function openKey(sealed: string, secret?: string) {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Bad sealed key');
  const decipher = createDecipheriv('aes-256-gcm', keyMaterial(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

export type AgentSettings = {
  name: string | null; instructions: string; language: 'en' | 'ar'; avatar: string;
  mcp_servers: { name: string; url?: string; host?: string | null }[]; integrations: string[];
  llm: { provider: LlmProvider; model: string; base_url?: string | null; key_last4?: string | null } | null; can_edit: boolean;
};

export async function readAgentSettings(driver: TransactionDriver, memberId: string): Promise<AgentSettings> {
  return withMember(driver, memberId, async (sql) => {
    try { return (await sql.query<{ s: AgentSettings }>('SELECT nazir.read_agent_settings() AS s')).rows[0]!.s; }
    catch (error) { if (/cannot do this/.test(String((error as Error)?.message))) throw new Forbidden(); throw error; }
  });
}

export async function saveAgentSettings(driver: TransactionDriver, memberId: string, value: unknown, secret?: string, resolve?: Resolver) {
  const input = settingsInput.parse(value);
  // Names must resolve to public addresses only (the literal check alone misses a name that points inward).
  for (const url of [...input.mcp_servers.map((s) => s.url), ...(input.llm?.provider === 'custom' && input.llm.base_url ? [input.llm.base_url] : [])]) {
    if (!await publicHttpsUrl(url, resolve)) throw new Coded(400, 'validation', 'Check the details and try again.');
  }
  const llm = input.llm;
  const sealed = llm?.api_key ? sealKey(llm.api_key, secret) : null;
  const payload = {
    name: input.name, instructions: input.instructions, language: input.language, avatar: input.avatar,
    mcp_servers: input.mcp_servers, integrations: input.integrations,
    llm_provider: llm?.provider ?? '', llm_model: llm?.model ?? '',
    llm_base_url: llm ? (llm.provider === 'custom' ? llm.base_url! : providerBaseUrl[llm.provider]) : '',
  };
  await withMember(driver, memberId, async (sql) => {
    try { await sql.query('SELECT nazir.save_agent_settings($1::jsonb,$2,$3,$4)', [JSON.stringify(payload), sealed, llm?.api_key ? llm.api_key.slice(-4) : null, Boolean(llm?.clear_key)]); }
    catch (error) { if (/cannot do this/.test(String((error as Error)?.message))) throw new Forbidden(); throw error; }
  });
  return readAgentSettings(driver, memberId);
}

export type OwnModel = { provider: LlmProvider; baseUrl: string; model: string; key: string } | null;
/** Server only: the decrypted model settings for this member's workspace, or null when none or unreadable. */
export async function ownModelFor(driver: TransactionDriver, memberId: string, secret?: string): Promise<{ model: OwnModel; instructions: string }> {
  return withMember(driver, memberId, async (sql) => {
    const row = (await sql.query<{ provider: LlmProvider | null; base_url: string | null; model: string | null; key_cipher: string | null; instructions: string | null }>('SELECT * FROM nazir.agent_model_secret()')).rows[0];
    if (!row) return { model: null, instructions: '' };
    let model: OwnModel = null;
    if (row.provider && row.base_url && row.model && row.key_cipher && safeHttpsUrl(row.base_url)) {
      try { model = { provider: row.provider, baseUrl: row.base_url, model: row.model, key: openKey(row.key_cipher, secret) }; } catch { model = null; }
    }
    return { model, instructions: row.instructions ?? '' };
  });
}

/** Worker side: the decrypted own model for the workspace a test run belongs to, or null. */
export async function ownModelForWorker(driver: TransactionDriver, workspaceId: string, secret?: string): Promise<OwnModel> {
  try {
    return await withWorker(driver, workspaceId, async (sql) => {
      const row = (await sql.query<{ provider: LlmProvider | null; base_url: string | null; model: string | null; key_cipher: string | null }>('SELECT * FROM nazir.agent_model_secret_worker()')).rows[0];
      if (!row?.provider || !row.base_url || !row.model || !row.key_cipher || !safeHttpsUrl(row.base_url)) return null;
      try { return { provider: row.provider, baseUrl: row.base_url, model: row.model, key: openKey(row.key_cipher, secret) }; } catch { return null; }
    });
  } catch { return null; }
}
