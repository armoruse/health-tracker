import assert from "node:assert/strict";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;

async function runQueueCase(upstreamBody) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("action=queue_pending")) {
      return Response.json({
        ok: true,
        items: [{
          rowIndex: 2,
          action: "READ_TRAINING",
          targetDate: "2026-08-29",
          targetId: "",
          payloadJson: JSON.stringify({ datestr: "2026-08-29" }),
          confirmed: false
        }]
      });
    }

    if (url.includes("api_trains_for_llm_v2")) {
      return Response.json(upstreamBody);
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
  const trainsResponse = { res: { trains: [{ datestr: "2026-08-29", title: "Upper B" }] } };
  const read = await runQueueCase(trainsResponse);
  assert.equal(read.body.results[0].status, "success");

  const updateCall = read.calls.find(call => {
    if (!call.init.body) return false;
    try { return JSON.parse(call.init.body).action === "queue_update"; } catch { return false; }
  });
  assert.ok(updateCall);
  assert.equal(JSON.parse(updateCall.init.body).status, "success");
  assert.deepEqual(JSON.parse(JSON.parse(updateCall.init.body).resultJson), trainsResponse);

  const legacy = await runQueueCase({ ok: true });
  assert.equal(legacy.body.results[0].status, "success");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("queue READ_TRAINING tests passed");
