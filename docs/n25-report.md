# N25 agent loop

Backend only. No screens.

## What changed
The in app chat and `POST /api/mcp` share one tool list: list runs, list findings, propose a bounded plan, start that plan, explain a finding and its cause, propose a repair, decide a repair, rerun the affected tests, and compare two finished runs. A plain English or Arabic message selects the tool. The model names a tool from that list only.

Starting a run uses the bounded plan, then the existing plan approval and `enqueueRun`. A repair is applied only by `decideRepair`, and only when the caller sends the exact approval line with the evidence sentence. The same role checks, four eyes rule, and audit actions as the services stay in place. A reply says an action happened only after that call returns. Otherwise the reply is the refusal or the error, and nothing is presented as done.

Viewers still read the redacted finding and comparison projections. A member id or workspace id in the arguments is refused. A record from another workspace is not found.

No new migration. No new AI provider. The daily Vercel cron stays in `vercel.json`. `.github/workflows/demo-reset.yml` calls `GET /api/cron/demo-reset` every 6 hours and on manual dispatch, with the `CRON_SECRET` repository secret.

## Exact lines
* `I approve plan <id> and start the run because <reason>. I opened the evidence.`
* `أوافق على الخطة <id> وأبدأ التشغيل لأن <reason>. اطلعت على الدليل.`
* `I approve repair <id> because <reason>. I opened the evidence.`
* `أوافق على الإصلاح <id> لأن <reason>. اطلعت على الدليل.`
* `I reject repair <id> because <reason>. I opened the evidence.`
* `أرفض الإصلاح <id> لأن <reason>. اطلعت على الدليل.`

The reason is at least 10 characters. MCP sends the same fields: id, decision or plan id, reason, and `evidence_opened` true.

## Environment
`CRON_SECRET` must exist on Vercel and as a GitHub Actions secret. `DEMO_STORAGE_CAP_BYTES` stays optional. No new AI keys.

## Live check still required
Confirm a manual run of the Demo reset workflow against production. The GitHub secret is not in this repository. No database migration is pending.
