import assert from "node:assert/strict";
import worker from "../src/index.js";

const previewOrigin = "https://preview-body-xunji-bridge.armoruse.workers.dev";
const response = await worker.fetch(new Request(`${previewOrigin}/openapi.json`), {}, {});
assert.equal(response.status, 200);

const raw = await response.text();
assert.doesNotThrow(() => JSON.parse(raw), "OpenAPI response must be valid JSON");
const spec = JSON.parse(raw);

assert.equal(spec.openapi, "3.0.3");
assert.equal(spec.servers?.[0]?.url, previewOrigin);
assert.ok(spec.components?.schemas && !Array.isArray(spec.components.schemas));
assert.ok(Object.keys(spec.components.schemas).length > 0);
assert.deepEqual(spec.components.securitySchemes.bearerAuth, { type: "http", scheme: "bearer" });

const operationIds = [];
for (const pathItem of Object.values(spec.paths)) {
  for (const operation of Object.values(pathItem)) {
    if (operation && typeof operation === "object" && operation.operationId) {
      operationIds.push(operation.operationId);
    }
  }
}
assert.equal(operationIds.length, 5);
assert.equal(new Set(operationIds).size, operationIds.length, "operationId values must be unique");

walk(spec, "openapi");
console.log("OpenAPI compatibility tests passed");

function walk(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (value.type === "object") {
    assert.ok(
      value.properties && typeof value.properties === "object" && !Array.isArray(value.properties),
      `${path}: object schema must define properties`
    );
    assert.ok(Object.keys(value.properties).length > 0, `${path}: object schema properties must not be empty`);
  }

  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
    const schemaName = value.$ref.slice("#/components/schemas/".length);
    assert.ok(spec.components.schemas[schemaName], `${path}: unresolved schema reference ${value.$ref}`);
  }

  for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
}
