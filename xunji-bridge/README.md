# BODY × 訓記 Bridge

This is the canonical source for the `body-xunji-bridge` Cloudflare Worker.

- Production Worker: `body-xunji-bridge.armoruse.workers.dev`
- Google Apps Script: BODY `V21.1-fast`
- Queue sheet: `XunjiQueue`
- Scheduled processing: every five minutes

Upload a preview version only:

```powershell
npx wrangler versions upload --preview-alias preview
```

Do not run `wrangler deploy` for this project unless production publication is explicitly approved.

Secrets are managed in Cloudflare and must not be committed. The Worker currently expects the existing `XUNJI_*_API_KEY` secrets. `BODY_QUEUE_SECRET` is optional and protects the manual `/queue/process` endpoint when configured.
