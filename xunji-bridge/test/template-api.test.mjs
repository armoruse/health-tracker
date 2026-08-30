import assert from "node:assert/strict";
import worker from "../src/index.js";

const originalFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ ok: true, data: { success: true, changes: [], applied: [] } });
  };

  const env = { XUNJI_TEMPLATE_API_KEY: "test-template-key" };
  const sync = await worker.fetch(new Request("https://bridge.test/templates/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor: 12, limit: 999, include_content: true })
  }), env, {});
  assert.equal(sync.status, 200);
  const syncBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(syncBody, { cursor: 12, limit: 15, include_content: true });

  const prescription = [{ weight: "70", reps: "8", unit: "kg" }];
  const mutate = await worker.fetch(new Request("https://bridge.test/templates/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      mutation_id: "test-public-movements",
      upserts: [{
        template_id: "1",
        base_version: 4,
        name: "Upper A",
        movements: [{ name: "杠铃卧推", sets: prescription }]
      }],
      deletes: []
    })
  }), env, {});
  assert.equal(mutate.status, 200);
  const mutateBody = JSON.parse(calls[1].init.body);
  assert.equal(mutateBody.upserts[0].movements[0].name, "杠铃卧推");
  assert.equal("movement" in mutateBody.upserts[0], false);
  assert.deepEqual(mutateBody.upserts[0].movements[0].sets, prescription);

  const unconfirmed = await worker.fetch(new Request("https://bridge.test/templates/mutate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upserts: [] })
  }), env, {});
  assert.equal(unconfirmed.status, 400);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("template API tests passed");
