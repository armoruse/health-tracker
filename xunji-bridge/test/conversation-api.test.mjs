import assert from "node:assert/strict";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const actionSecret = "test-conversation-secret";

async function call(path, body, token = actionSecret, env = {}) {
  return worker.fetch(
    new Request(`https://preview.bridge.test${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { BODY_QUEUE_SECRET: actionSecret, XUNJI_TRAIN_API_KEY: "test-upstream-key", ...env },
    {}
  );
}

try {
  console.log = () => {};

  const schemaResponse = await worker.fetch(new Request("https://preview.bridge.test/openapi.json"), {}, {});
  const schema = await schemaResponse.json();
  assert.equal(schema.openapi, "3.0.3");
  assert.equal(schema.servers[0].url, "https://preview.bridge.test");
  assert.equal(schema.paths["/conversation/training/read"].post.operationId, "readTraining");
  assert.equal(schema.paths["/conversation/training/write"].post.operationId, "writeTraining");

  let upstreamCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    upstreamCalls++;
    if (url.includes("api_trains_for_llm_v2")) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.datestr, "2026-09-02");
      return Response.json({ ok: true, res: { trains: [] } });
    }
    if (url.includes("api_upsert_trains_for_llm_v2")) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.client_request_id, "body-chat-20260903-001");
      return Response.json({ ok: true, data: { success: true } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const missingConfig = await call(
    "/conversation/training/read",
    { datestr: "2026-09-02" },
    actionSecret,
    { BODY_QUEUE_SECRET: undefined }
  );
  assert.equal(missingConfig.status, 503);

  const unauthorized = await call("/conversation/training/read", { datestr: "2026-09-02" }, "wrong-secret");
  assert.equal(unauthorized.status, 401);

  const invalidDate = await call("/conversation/training/read", { datestr: "yesterday" });
  assert.equal(invalidDate.status, 400);

  const read = await call("/conversation/training/read", { datestr: "2026-09-02", include_full_data: true });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).ok, true);

  const unconfirmed = await call("/conversation/training/write", {
    confirmed: false,
    client_request_id: "body-chat-20260903-001",
    res: [{ datestr: "2026-09-03", movements: [] }]
  });
  assert.equal(unconfirmed.status, 400);

  const missingRequestId = await call("/conversation/training/write", {
    confirmed: true,
    res: [{ datestr: "2026-09-03", movements: [] }]
  });
  assert.equal(missingRequestId.status, 400);

  const written = await call("/conversation/training/write", {
    confirmed: true,
    client_request_id: "body-chat-20260903-001",
    res: [{ datestr: "2026-09-03", movements: [] }]
  });
  assert.equal(written.status, 200);
  assert.equal((await written.json()).ok, true);
  assert.equal(upstreamCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
}

console.log("conversation API tests passed");
