import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
const mocks = vi.hoisted(() => ({ driver: vi.fn(), model: vi.fn() }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: mocks.driver }));
vi.mock('../../src/sandbox/model-factory', () => ({ createAgentModel: () => mocks.model }));
import { POST } from '../../src/app/api/sandbox/agent/route';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); mocks.driver.mockReturnValue(db.driver); });
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.stubEnv('SANDBOX_AGENT_TOKEN', 'test-token'); mocks.model.mockReset(); });
const body = { tenant: 'route', requester_key: 'saeed', conversation_key: 'route', messages: [{ role: 'user', content: 'Hello' }] };
function request(data: unknown = body, token = 'test-token') { return new Request('http://localhost/api/sandbox/agent', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
it('returns 404 when disabled', async () => { vi.stubEnv('SANDBOX_AGENT_TOKEN', ''); expect((await POST(request())).status).toBe(404); });
it('refuses a wrong or missing token', async () => { expect((await POST(request(body, 'wrong'))).status).toBe(401); expect((await POST(new Request('http://localhost'))).status).toBe(401); });
it.each([
  { ...body, messages: Array(21).fill(body.messages[0]) },
  { ...body, messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
  { ...body, tenant: 'unsafe tenant' },
])('rejects a bad body', async (data) => { const response = await POST(request(data)); expect(response.status).toBe(400); expect(response.headers.get('Cache-Control')).toBe('no-store'); });
it('rejects malformed JSON', async () => { expect((await POST(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{' }))).status).toBe(400); });
it('uses the injected scripted model and seeds the tenant', async () => {
  mocks.model.mockResolvedValue({ content: 'How can I help?' });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ reply: 'How can I help?', tool_calls: [] });
  expect((await db.owner.query("SELECT * FROM sandbox.prior_requests WHERE tenant='route'")).rows).toHaveLength(2);
  expect(mocks.model).toHaveBeenCalledTimes(1);
});
