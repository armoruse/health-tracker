# BODY × 訓記 Bridge

This is the canonical source for the `body-xunji-bridge` Cloudflare Worker.

- Production Worker: `body-xunji-bridge.armoruse.workers.dev`
- Google Apps Script: BODY `V21.1-fast`
- Queue sheet: `XunjiQueue`
- Scheduled processing: every five minutes
- Authenticated ChatGPT Action schema: `GET /openapi.json`
- Official movement-name catalog: `POST /movements/catalog`
- Catalog aliases: `POST /movement/catalog`, `POST /xunji/movements`

The catalog endpoint calls Xunji's `api_movement_catalog_for_llm_v2` with the existing
`XUNJI_TRAIN_API_KEY` secret (falling back to `XUNJI_API_KEY`) and returns both the raw
upstream payload and a normalized name, aliases, category, movement type, equipment,
muscle, and optional identity view. The v1 catalog currently exposes no internal native
key, so `identity` remains `null`; a catalog name must never be copied into `key`.

Preview a native template binding plan without writing:

```powershell
$env:BRIDGE_URL='https://your-preview-worker.example.workers.dev'
npm run rebind:native
```

Add `-- --apply` only after reviewing the report. The script syncs current template
versions, validates all names against Xunji's public standard-name list, uses
`base_version`, and sends all six updates in one confirmed mutation through the public
`movements[].name` structure. Xunji resolves the internal identity server-side. The
script then re-syncs and requires a non-name native key for every action while verifying
that every set prescription is unchanged.

Upload a preview version only:

```powershell
npx wrangler versions upload --preview-alias preview
```

Do not run `wrangler deploy` for this project unless production publication is explicitly approved.

Secrets are managed in Cloudflare and must not be committed. The Worker expects the existing `XUNJI_*_API_KEY` secrets plus `BODY_QUEUE_SECRET`. The latter protects both the manual `/queue/process` endpoint and all `/conversation/*` ChatGPT Action endpoints.
