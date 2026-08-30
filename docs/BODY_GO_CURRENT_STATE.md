# BODY GO! 目前雲端狀態

最後驗證：2026-08-30（Asia/Taipei）

這份文件是不同電腦、手機與新對話接手 BODY GO! 時的第一入口。GitHub 是程式與更新紀錄的唯一來源；Google Sheet 是健康、飲食、體態與訓練資料的正式資料庫；Cloudflare 保存 Worker 與加密 API secrets。

## 正式來源

| 元件 | 唯一原始碼 | Production | Preview | 已驗證版本 |
| --- | --- | --- | --- | --- |
| BODY GO! 網站 | `cloudflare-worker/` | `https://body-go-app.armoruse.workers.dev/` | `https://preview-body-go-app.armoruse.workers.dev/` | Production V25.6；Preview V25.8 |
| BODY × 訓記橋接 | `xunji-bridge/` | `https://body-xunji-bridge.armoruse.workers.dev/` | `https://preview-body-xunji-bridge.armoruse.workers.dev/` | Production 2.1.1；Preview 2.2.0 |
| Google Sheet API | `apps-script/` | 現有 Apps Script Web App | 無獨立 Preview | V21.1-fast |
| 訓記任務佇列 | Google Sheet `XunjiQueue` | 由橋接 Worker 每 5 分鐘處理 | Preview 可唯讀驗證 | 架構保留 |

禁止使用 repository 根目錄的舊 `index.html` 或 Downloads 裡的 ZIP 部署。它們不是目前 BODY GO! 的正式來源。

## 手機無法修改訓記模板的原因

訓記 token 沒有失效。2026-08-30 已從 Production 2.1.1 與 Preview 2.2.0 成功同步訓記模板，Cloudflare 上六個 `XUNJI_*_API_KEY` secret 名稱也都存在。

目前手機無法修改的真正原因有四個：

1. 手機上的 ChatGPT 對話沒有綁定可呼叫訓記橋接的 Action 或 Connector；一般對話文字不會自動取得 HTTP 工具。
2. 訓記 API credentials 只存在 Cloudflare 的加密 secrets，不會同步到手機、對話內容或 GitHub。
3. Apps Script V21.1-fast 目前有 `queue_pending`、`queue_processing`、`queue_update`，但沒有供手機安全送出任務的 `queue_enqueue` 入口。
4. 最新 Queue 寫入能力在橋接 Preview 2.2.0；Production 仍為 2.1.1。手機若只連 Production，就不會取得最新 Queue 流程。

因此「電腦 Codex 可以改、手機 ChatGPT 不可以」是工具與授權入口不同，不是模板或 token 壞掉。

## 讓手機可安全修改所缺的串接

手機端要正式可用，還需要完成以下一條受保護的路徑：

`手機 ChatGPT／BODY GO! → 已驗證的 enqueue 入口 → XunjiQueue → body-xunji-bridge → 訓記`

enqueue 必須有身份驗證、變更摘要、`confirmed: true`、穩定 request ID 與結果回寫。完成 Preview 驗證前不得發布 Production，也不能把 Cloudflare secret 放到手機前端。

目前手機修改狀態：**尚未串接完成**。不要在其他裝置誤判為已可直接修改。

## 目前訓記模板

2026-08-30 唯讀同步結果：current revision 28；目前使用中的正式模板共 6 個。

| 模板 | 版本 | 目前重點 |
| --- | --- | --- |
| Upper A 胸部主訓 | v5 | 已加入排球所需核心旋轉與腹部訓練 |
| Upper B 背部主訓 | v5 | 已更新背部、Face Pull 與腹部安排 |
| Lower A 股四頭主訓 | v5 | 已調整保加利亞分腿蹲 |
| Lower B 臀腿後側 | v3 | 已加入深蹲跳並調整動作順序 |
| 居家恢復伸展 | v2 | 7 個有訓記內建示範的動作 |
| 睡前舒緩拉伸 | v1 | 5 個簡短且有內建示範的動作 |

模板 mutation 一律先提出變更摘要，取得使用者明確確認後才寫入。

## 最近更新

- BODY GO! Preview 已到 V25.8：目標體態正／側／背統一為脖子到膝蓋比例，並保留動態目標圖片同步與 cache busting。
- BODY GO! Production 目前為 V25.6；V25.8 尚未發布 Production。
- 訓記橋接 Preview 2.2.0 已補齊 Queue training writes 與 canonical source；Production 仍為 2.1.1。
- Apps Script 維持 V21.1-fast 與 `XunjiQueue`，沒有換架構。
- 訓記四個重訓模組已加入排球相關調整；另有居家恢復與睡前拉伸模板。

完整 commit 級更新見 [`CHANGELOG.md`](../CHANGELOG.md)。

## 跨裝置取用規則

1. 先讀本文件，再讀 `DEPLOYMENT_SOURCES.md`。
2. 執行 `git pull` 取得最新版；不要從聊天附件或 Downloads ZIP 覆蓋。
3. 正式健康資料從 Google Sheet/API 讀取，不把個人健康資料複製進 GitHub。
4. API secret 只留在 Cloudflare；GitHub 只記錄 secret 名稱與設定方式。
5. 所有 Cloudflare 修改先用 Preview；沒有明確 production approval 不得發布正式站。

## 安全與隱私

這個版本庫不保存 API token 值、Cloudflare OAuth credential、Google 登入資訊或完整個人健康資料。若某裝置需要操作能力，應建立可撤銷的受保護入口，不可複製主 secret 到裝置或對話。
