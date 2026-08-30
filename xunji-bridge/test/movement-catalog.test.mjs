import assert from "node:assert/strict";
import worker, { normalizeMovementCatalog } from "../src/index.js";

const fixture = {
  res: {
    schema: "movement_catalog_v1",
    version: 1,
    movements: [
      { name: "杠铃卧推", type: "胸", exetype: "", aliases: ["平板杠铃卧推"] },
      { name: "俯卧撑", type: "胸", exetype: "times", aliases: [] }
    ]
  }
};

const normalized = normalizeMovementCatalog(fixture);
assert.equal(normalized.length, 2);
assert.deepEqual(normalized[0], {
  identity: "杠铃卧推",
  identity_field: "name",
  name: "杠铃卧推",
  label: "杠铃卧推",
  aliases: ["平板杠铃卧推"],
  equipment: null,
  muscle: null,
  category: "胸",
  movement_type: "",
  raw: fixture.res.movements[0]
});

const originalFetch = globalThis.fetch;
try {
  let upstreamBody;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://trains.xunjiapp.cn/api_movement_catalog_for_llm_v2");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-key");
    upstreamBody = JSON.parse(init.body);
    return Response.json(fixture);
  };

  const response = await worker.fetch(
    new Request("https://bridge.test/movements/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }),
    { XUNJI_TRAIN_API_KEY: "test-key" },
    {}
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody, {});
  assert.equal(body.normalized[0].identity, "杠铃卧推");

  const missingKey = await worker.fetch(
    new Request("https://bridge.test/movement/catalog", { method: "POST", body: "{}" }),
    {},
    {}
  );
  assert.equal(missingKey.status, 500);
  assert.match((await missingKey.json()).error, /Missing Cloudflare Secret/);

  globalThis.fetch = async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
  const upstreamError = await worker.fetch(
    new Request("https://bridge.test/xunji/movements", { method: "POST", body: "{}" }),
    { XUNJI_API_KEY: "fallback-key" },
    {}
  );
  assert.equal(upstreamError.status, 429);
  assert.equal((await upstreamError.json()).ok, false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("movement catalog tests passed");
