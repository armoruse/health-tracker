# BODY × 訓記 Bridge

This is the canonical source for the `body-xunji-bridge` Cloudflare Worker.

- Production Worker: `body-xunji-bridge.armoruse.workers.dev`
- Google Apps Script: BODY `V21.1-fast`
- Queue sheet: `XunjiQueue`
- Scheduled processing: every five minutes
- Native movement catalog: `POST /movements/catalog`
- Catalog aliases: `POST /movement/catalog`, `POST /xunji/movements`

The catalog endpoint calls Xunji's `api_movement_catalog_for_llm_v2` with the existing
`XUNJI_TRAIN_API_KEY` secret (falling back to `XUNJI_API_KEY`) and returns both the raw
upstream payload and a normalized `identity`, `name`, aliases, category, movement type,
equipment, and muscle view. Fields absent from the upstream catalog remain `null`.

Preview a native template binding plan without writing:

```powershell
$env:BRIDGE_URL='https://your-preview-worker.example.workers.dev'
npm run rebind:native
```

Add `-- --apply` only after reviewing the report. The script syncs current template
versions, uses `base_version`, sends `confirmed: true`, rate-limits mutations, then
re-syncs and verifies every set prescription is unchanged.

Upload a preview version only:

```powershell
npx wrangler versions upload --preview-alias preview
```

Do not run `wrangler deploy` for this project unless production publication is explicitly approved.

Secrets are managed in Cloudflare and must not be committed. The Worker currently expects the existing `XUNJI_*_API_KEY` secrets. `BODY_QUEUE_SECRET` is optional and protects the manual `/queue/process` endpoint when configured.
