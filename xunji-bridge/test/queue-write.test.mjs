import assert from "node:assert/strict";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;

async function runQueueCase({ confirmed, upstreamOk = true }) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("action=queue_pending")) {
      return Response.json({
        ok: true,
        items: [{
          rowIndex: 2,
          action: "WRITE_TRAINING",
          targetDate: "2026-08-29",
          targetId: "896452342598053",
          payloadJson: JSON.stringify({
            client_request_id: "test-upper-b-2026-08-29",
            res: [{ datestr: "2026-08-29", title: "Upper B 背部主训", movements: [] }]
          }),
          confirmed
        }]
      });
    }

    if (url.includes("api_upsert_trains_for_llm_v2")) {
      return Response.json(
        upstreamOk ? { ok: true, data: { success: true } } : { ok: false, error: "upstream rejected" },
        { status: upstreamOk ? 200 : 400 }
      );
    }

    if (init.method === "POST" && url.startsWith("https://script.google.com/")) {
      return Response.json({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = await worker.fetch(
    new Request("https://bridge.test/queue/process", { method: "POST" }),
    { XUNJI_TRAIN_API_KEY: "test-only" },
    {}
  );
  const body = await response.json();
  return { body, calls };
}

try {
  const waiting = await runQueueCase({ confirmed: false });
  assert.equal(waiting.body.results[0].status, "waiting_confirmation");
  assert.equal(waiting.calls.some(call => call.url.includes("api_upsert_trains_for_llm_v2")), false);

  const written = await runQueueCase({ confirmed: true });
  assert.equal(written.body.results[0].status, "success");
  assert.equal(written.calls.filter(call => call.url.includes("api_upsert_trains_for_llm_v2")).length, 1);

  const updateCall = written.calls.find(call => {
    if (!call.init.body) return false;
    try { return JSON.parse(call.init.body).action === "queue_update"; } catch { return false; }
  });
  assert.ok(updateCall);
  assert.equal(JSON.parse(updateCall.init.body).status, "success");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("queue-write tests passed");
