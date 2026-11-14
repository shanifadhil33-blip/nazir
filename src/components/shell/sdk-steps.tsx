'use client';

import { useEffect, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { SDK_FILES } from '@/server/sdk/files';
import { makeKey, readSdk, turnOffKey, type SdkStatus } from './connect-request';
import { PillButton } from './pill-button';

const SNIPPETS = {
  node: `import { nazir } from './nazir.mjs';

nazir.init({ key: process.env.NAZIR_KEY, agent: { name: 'My agent' } });

// Wrap each tool once. Tools that change data run their dry run in a test.
const createCase = nazir.tool('create_case', createCaseImpl, {
  changesData: true,
  dryRun: async () => ({ reference: 'TEST-1' }),
});

app.post('/chat', (req, res) => nazir.turn(req, async (turn) => {
  const reply = await runAgent(req.body, { tools: { createCase } });
  turn.reply(reply);
  res.json({ reply });
}));`,
  python: `import os, nazir

nazir.init(key=os.environ["NAZIR_KEY"], agent={"name": "My agent"})

@nazir.tool("create_case", changes_data=True, dry_run=lambda **a: {"reference": "TEST-1"})
def create_case(summary): ...

@app.post("/chat")
async def chat(request: Request):
    with nazir.turn(request.headers) as turn:
        reply = await run_agent(await request.json())
        turn.reply(reply)
        return {"reply": reply}`,
} as const;

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function CopyButton({ text, lang }: { text: string; lang: Lang }) {
  const c = messagesFor(lang).connect;
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return <span className="nz-copy">
    <PillButton label={state === 'copied' ? c.copied : c.copy} onClick={() => { void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed')); }} />
    {state === 'failed' ? <small role="alert">{c.copyFailed}</small> : null}
  </span>;
}

/** Steps 1 to 3 of the full check: the key (shown once), the file with its SHA256, and the lines to add. */
export function SdkSteps({ workspaceId, lang, onStatus }: { workspaceId: string; lang: Lang; onStatus?: (status: SdkStatus | null) => void }) {
  const c = messagesFor(lang).connect;
  const [status, setStatus] = useState<SdkStatus | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'node' | 'python'>('node');
  useEffect(() => { let alive = true; void readSdk(workspaceId).then((s) => { if (alive) { setStatus(s); onStatus?.(s); } }); return () => { alive = false; }; }, [workspaceId, onStatus]);
  async function make() {
    if (busy) return; setBusy(true);
    const made = await makeKey(workspaceId, lang);
    setBusy(false);
    if (!made) return;
    setFresh(made.key);
    const next = { ...(status ?? { sdk_seen_at: null, sdk_version: null, tools: 0, mcp_servers: 0 }), key_last4: made.last4 };
    setStatus(next); onStatus?.(next);
  }
  async function off() {
    if (busy) return; setBusy(true);
    const ok = await turnOffKey(workspaceId, lang);
    setBusy(false);
    if (ok) { setFresh(null); const next = status ? { ...status, key_last4: null } : null; setStatus(next); onStatus?.(next); }
  }
  const file = SDK_FILES.find((f) => f.lang === tab)!;
  return <ol className="nz-sdk-steps">
    <li><h3><bdi dir="ltr">1.</bdi> {c.stepKey}</h3>
      {fresh ? <div className="nz-sdk-key"><code dir="ltr">{fresh}</code><CopyButton text={fresh} lang={lang} /><p>{c.keyOnce}</p></div>
        : status?.key_last4 ? <p>{c.keyEnding.split('{last4}').map((part, i) => i === 0 ? part : <span key={i}><bdi dir="ltr">{status.key_last4}</bdi>{part}</span>)}</p> : null}
      <div className="nz-sdk-actions">
        <PillButton variant={status?.key_last4 ? undefined : 'ink'} label={busy ? c.sending : status?.key_last4 ? c.makeNewKey : c.makeKey} onClick={() => void make()} disabled={busy} />
        {status?.key_last4 ? <button type="button" className="nz-text-btn" onClick={() => void off()} disabled={busy}>{c.turnOffKey}</button> : null}
      </div>
    </li>
    <li><h3><bdi dir="ltr">2.</bdi> {c.stepFile}</h3>
      <div className="nz-sdk-tabs" role="tablist">{(['node', 'python'] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{c[id]}</button>)}</div>
      <a className="nz-pill-btn nz-sdk-download" href={file.path} download={file.name}>{c.download.replace('{file}', file.name)}</a>
      <p className="nz-sdk-sha"><span>SHA256 </span><code dir="ltr">{file.sha256}</code></p>
    </li>
    <li><h3><bdi dir="ltr">3.</bdi> {c.stepLines}</h3>
      <pre dir="ltr" className="nz-sdk-code"><code>{SNIPPETS[tab]}</code></pre>
      <CopyButton text={SNIPPETS[tab]} lang={lang} />
    </li>
  </ol>;
}
