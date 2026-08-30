import assert from "node:assert/strict";
import {
  KNOWN_NATIVE_MOVEMENTS,
  bindNativeMovement,
  normalizeCatalog,
  resolveNativeMovement
} from "../src/movement-resolver.js";

const catalog = normalizeCatalog({ res: { movements: [
  { key: "barbell-bench", name: "杠铃卧推", aliases: ["平板杠铃卧推"], equipment: "杠铃", muscle: "胸", type: "力量", exetype: "weight" },
  { key: "incline-barbell-bench", name: "上斜杠铃卧推", aliases: [], equipment: "杠铃", muscle: "胸", type: "力量", exetype: "weight" },
  { key: "cable-row-wide", name: "宽握坐姿划船", aliases: ["宽距坐姿划船"], equipment: "绳索", muscle: "背", type: "力量", exetype: "weight" },
  { key: "cable-row-close", name: "窄握坐姿划船", aliases: ["窄距坐姿划船"], equipment: "绳索", muscle: "背", type: "力量", exetype: "weight" }
] } });

const exact = resolveNativeMovement("杠铃卧推", catalog);
assert.equal(exact.matched, true);
assert.equal(exact.method, "name_exact");
assert.equal(exact.movement.identity, "barbell-bench");

const alias = resolveNativeMovement("宽距坐姿划船", catalog);
assert.equal(alias.matched, true);
assert.equal(alias.method, "alias");
assert.equal(alias.movement.identity, "cable-row-wide");

const ambiguous = resolveNativeMovement("坐姿划船", catalog);
assert.equal(ambiguous.matched, false);
assert.equal(ambiguous.reason, "fuzzy_requires_equipment_muscle_and_movement_type");
assert.ok(ambiguous.candidates.length >= 2);

const differentMovement = resolveNativeMovement("哑铃卧推", catalog, {
  equipment: "哑铃", muscle: "胸", movementType: "weight"
});
assert.equal(differentMovement.matched, false);

for (const [name, key] of Object.entries(KNOWN_NATIVE_MOVEMENTS)) {
  const resolution = resolveNativeMovement({ name, key }, []);
  assert.equal(resolution.matched, true);
  assert.equal(resolution.method, "key_exact");
  assert.equal(resolution.movement.identity, key);
}

const original = {
  name: "杠铃卧推",
  label: "杠铃卧推",
  sets: [
    { reps: "12", weight: "20", comment: "warmup" },
    { reps: "8", weight: "70", comment: "working" }
  ]
};
const before = structuredClone(original.sets);
const bound = bindNativeMovement(original, exact).movement;
assert.equal(bound.key, "barbell-bench");
assert.equal("name" in bound, false);
assert.deepEqual(bound.sets, before);
assert.deepEqual(original.sets, before);

console.log("movement resolver tests passed");
