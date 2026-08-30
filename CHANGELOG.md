# BODY GO! 更新紀錄

## 2026-08-30

- 建立跨裝置雲端狀態文件與機器可讀狀態檔。
- 建立手機端最高指導原則，並提供 Cloudflare Preview 唯讀鏡像。
- 確認訓記 API token 可透過 Cloudflare Worker 使用，Production 與 Preview 均能唯讀同步模板。
- 定位手機無法修改模板的原因：手機沒有 Action/Connector，且 Apps Script 尚無安全的 `queue_enqueue` 入口。
- 確認訓記模板 revision 28；四個重訓模板、居家恢復伸展、睡前舒緩拉伸共 6 個正式模板。
- 明確記錄 Production／Preview 版本差距；未發布任何 Production。

## 2026-08-29

- BODY GO! Preview 更新至 V25.8，目標體態圖片統一為脖子到膝蓋比例。
- 恢復動態目標圖片同步與圖片 cache busting。
- BODY × 訓記橋接 Preview 更新至 2.2.0，加入 Queue training writes 與固定 request ID。
- 訓記四個重訓模組加入排球訓練調整。
- 建立有訓記內建動作示範的居家恢復伸展與睡前舒緩拉伸模板。

## 2026-08-27

- BODY GO! Production 更新至 V25.6，統一體態圖顯示方式。

## 2026-08-25

- Apps Script 更新為 V21.1-fast。
- `XunjiQueue` 加入 pending、processing 與 update 流程。
- 建立並部署 BODY × 訓記橋接 Production 2.1.1。
