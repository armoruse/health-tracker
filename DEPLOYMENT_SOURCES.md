# BODY GO! deployment sources

This repository is the single source of truth. Do not deploy ZIP files from Downloads.

| Component | Canonical source | Cloud service | Safe preview command |
| --- | --- | --- | --- |
| BODY GO! web app | `cloudflare-worker/` | `body-go-app` | `npx wrangler versions upload --preview-alias preview` |
| BODY × 訓記 bridge | `xunji-bridge/` | `body-xunji-bridge` | `npm run preview` |
| Google Sheets API | `apps-script/` | Apps Script `V21.1-fast` | Use the existing Apps Script workflow; do not overwrite from old downloads |

## Production guardrail

- Never deploy the repository root `index.html`; it is the retired Gemini/localStorage app.
- Never run `wrangler deploy` or `wrangler versions deploy` without explicit production approval.
- Preview uploads create versions only. They do not change production traffic.
- `body-xunji-bridge` keeps its six `XUNJI_*_API_KEY` values as Cloudflare secrets. Secret values never belong in Git.

## Current architecture

`BODY / ChatGPT → Google Sheet XunjiQueue → body-xunji-bridge → 訓記 Open API`

The bridge polls `XunjiQueue` every five minutes and supports:

- `TEMPLATE_SYNC`
- `TEMPLATE_MUTATE` (requires confirmation)
- `READ_TRAINING`
- `WRITE_TRAINING` / `UPSERT_TRAINING` (requires confirmation)

Confirmed writes use a stable Queue-based request ID so retries remain idempotent.
