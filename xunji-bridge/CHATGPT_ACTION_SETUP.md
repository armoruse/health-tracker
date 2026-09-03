# BODY × 訓記 ChatGPT Action setup

This bridge exposes a dedicated ChatGPT Action surface without exposing the Xunji API keys.

## Backend requirements

1. Configure `BODY_QUEUE_SECRET` as an encrypted Cloudflare Worker secret. Never put its value in Git, source code, logs, or project instructions.
2. Upload and verify a Preview version first. Do not deploy Production without explicit approval.
3. Confirm these Preview endpoints:
   - `GET /openapi.json`
   - `POST /conversation/training/read`
   - `POST /conversation/training/write`
   - `POST /conversation/templates/sync`
   - `POST /conversation/templates/mutate`

The conversation endpoints fail closed with HTTP 503 when `BODY_QUEUE_SECRET` is missing and HTTP 401 when the Bearer token is invalid.

## ChatGPT Action configuration

In an eligible custom GPT editor:

1. Create an Action and import `https://body-xunji-bridge.armoruse.workers.dev/openapi.json` after Production is explicitly approved and deployed. During testing, import the Preview URL instead.
2. Select API key authentication with Bearer auth.
3. Enter the same value stored as the Worker's `BODY_QUEUE_SECRET` using the Action editor's secret field. Do not paste it into GPT instructions or chat messages.
4. Test reads first. Test writes only with a disposable or explicitly approved change.

## Required GPT instructions

```text
Use the BODY Xunji Action for live Xunji data. For reads, always resolve relative dates to an explicit YYYY-MM-DD date in Asia/Taipei before calling the tool.

Before any training or template write, first read the latest record/template and present a complete change summary. Do not call writeTraining or modifyTemplates until the user explicitly confirms that exact change in the current conversation. A confirmation from an older turn or another change is invalid.

For each confirmed write, create one stable client_request_id or mutation_id and reuse it for retries of the same operation. Set confirmed=true only after current-turn confirmation. After a successful write, read the same training date or re-sync templates and report the verified result.

Never reveal API keys, Authorization headers, secrets, complete private payloads, or Xunji internal movement keys. Use listMovements before drafting movement changes when canonical movement names are needed.
```

ChatGPT Projects can use connected Apps, but an arbitrary external API requires an Action-capable custom GPT or a separately deployed custom app. A GPT cannot use Apps and Actions at the same time; choose the integration surface that matches the account and workspace.
