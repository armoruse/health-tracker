import assert from "node:assert/strict";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalError = console.error;

function captureLogs() {
  const entries = [];
  console.log = message => entries.push(JSON.parse(message));
  console.error = message => entries.push(JSON.parse(message));
  return entries;
}

try {
  {
    const logs = captureLogs();
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.includes("action=queue_pending")) {
        return Response.json({ ok: true, count: 0, items: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    let scheduledWork;
    worker.scheduled(
      { scheduledTime: Date.parse("2026-09-03T00:05:00Z"), cron: "*/5 * * * *" },
      {},
      { waitUntil(promise) { scheduledWork = promise; } }
    );
    await scheduledWork;

    assert.ok(logs.some(entry => entry.event === "cron_triggered" && entry.triggeredAt === "2026-09-03T00:05:00.000Z"));
    assert.ok(logs.some(entry => entry.event === "queue_pending_response" && entry.httpStatus === 200));
    assert.ok(logs.some(entry => entry.event === "queue_pending_items" && entry.count === 0));
    assert.ok(logs.some(entry => entry.event === "cron_finished" && entry.processed === 0));
  }

  {
    const logs = captureLogs();
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.includes("action=queue_pending")) {
        return Response.json({
          ok: true,
          items: [{
            rowIndex: 7,
            action: "READ_TRAINING",
            targetDate: "2026-09-02",
            targetId: "body-read-20260902-100700",
            payloadJson: JSON.stringify({ datestr: "2026-09-02", include_full_data: true }),
            confirmed: false
          }]
        });
      }
      if (init.method === "POST" && url.startsWith("https://script.google.com/")) {
        return Response.json({ ok: false, error: "write rejected" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const response = await worker.fetch(
      new Request("https://bridge.test/queue/process", { method: "POST" }),
      { XUNJI_TRAIN_API_KEY: "test-only" },
      {}
    );
    const body = await response.json();

    assert.equal(body.processed, 1);
    assert.equal(body.successCount, 0);
    assert.equal(body.errorCount, 1);
    assert.equal(body.results[0].writebackOk, false);
    assert.ok(logs.some(entry => entry.event === "queue_item_started" && entry.rowIndex === 7));
    assert.ok(logs.some(entry => entry.event === "queue_processing_write" && entry.gasOk === false));
    assert.equal(logs.some(entry => Object.hasOwn(entry, "payloadJson")), false);
  }
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  console.error = originalError;
}

console.log("queue observability tests passed");
