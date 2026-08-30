const BRIDGE_URL = (process.env.BRIDGE_URL || "https://body-xunji-bridge.armoruse.workers.dev").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");
const TEMPLATE_IDS = [
  "896988171949717",
  "896452342598053",
  "894662602360569",
  "898294457839639",
  "897112973978855",
  "897173877255151"
];

const MANUAL = Object.freeze({
  "宽距高位下拉": { official: "宽距下拉", key: "宽距下拉", method: "supported_variant", confidence: 0.97 },
  "哑铃保加利亚蹲": { official: "保加利亚蹲", key: "保加利亚蹲", method: "supported_variant", confidence: 0.94 },
  "自重保加利亚蹲": { official: "保加利亚蹲", key: "保加利亚蹲", method: "supported_variant", confidence: 0.94 },
  "悍马机卷腹": { official: "器械卷腹", key: "器械卷腹", method: "supported_variant", confidence: 0.92 },
  "最伟大拉伸": { official: "最伟大拉伸", key: "f_s_f138", method: "known_key", confidence: 1 },
  "单腿跪姿股四头肌拉伸": { official: "单腿跪姿股四头肌拉伸", key: "f_s_f14", method: "known_key", confidence: 1 },
  "坐姿单腿腘绳肌拉伸": { official: "坐姿腿拉伸", key: "06921301-Seated-Single-Leg-Hamstring-Stretch", method: "known_key_supported_variant", confidence: 0.98 },
  "台阶式小腿拉伸": { official: "站姿腓肠肌拉伸", key: "f_s_f205", method: "known_key_supported_variant", confidence: 0.93 },
  "胸椎拉伸和打开": { official: "胸椎拉伸和打开", key: "thoracicSpineStretchAndOpening", method: "known_key", confidence: 1 }
});

const UNRESOLVED = new Set([
  "绳索Pallof推", "绳索肩外旋", "悍马机臀冲", "9090旋转", "下犬式",
  "单腿地面提踵", "自重臀冲", "死虫", "哥本哈根屈膝侧平板支撑", "肩胛屈伸"
]);

const syncBefore = await post("/templates/sync", { cursor: 0, include_content: true });
const beforeRevision = Number(syncBefore.data.current_revision);
const templates = latestTemplates(syncBefore.data.changes);
const selected = TEMPLATE_IDS.map(id => templates.get(id));
if (selected.some(template => !template)) throw new Error("One or more target templates are missing from TEMPLATE_SYNC");

const catalogResponse = await post("/movements/catalog", {});
const catalog = catalogResponse.normalized || [];
const catalogNames = new Set(catalog.map(item => item.name));
const mappings = [];
const upserts = [];
const prescriptions = new Map();

for (const template of selected) {
  prescriptions.set(template.template_id, template.movement.map(item => structuredClone(item.sets || [])));
  const movement = template.movement.map(item => {
    const source = item.label || item.name;
    let match = MANUAL[source];
    if (!match && catalogNames.has(source)) {
      match = { official: source, key: source, method: "catalog_name_exact", confidence: 1 };
    }
    if (!match && !UNRESOLVED.has(source)) {
      throw new Error(`Unexpected unresolved movement: ${source}`);
    }

    mappings.push({
      template_id: template.template_id,
      template: template.name,
      original: source,
      official: match?.official || null,
      key: match?.key || null,
      method: match?.method || "unresolved",
      confidence: match?.confidence || 0
    });

    if (!match) return { name: item.name || source, label: item.label || source, sets: structuredClone(item.sets || []) };
    return { key: match.key, label: match.official, sets: structuredClone(item.sets || []) };
  });

  upserts.push({
    client_id: `body-native-${template.template_id}-20260831`,
    template_id: template.template_id,
    base_version: template.version,
    name: template.name,
    color: template.color || "",
    order: template.order,
    folder_id: template.folder_id,
    movement,
    rules: template.rules || {}
  });
}

const summary = {
  apply: APPLY,
  bridge: BRIDGE_URL,
  before_revision: beforeRevision,
  total_movements: mappings.length,
  native_bindings: mappings.filter(item => item.key).length,
  unresolved: mappings.filter(item => !item.key).length,
  mappings
};

if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const applied = [];
for (let index = 0; index < upserts.length; index++) {
  if (index > 0) await sleep(16_000);
  const upsert = upserts[index];
  const response = await post("/templates/mutate", {
    confirmed: true,
    mutation_id: `body-native-${upsert.template_id}-${Date.now()}`,
    upserts: [upsert],
    deletes: []
  });
  if (response.data?.success === false) throw new Error(`Mutation failed for ${upsert.template_id}: ${response.data.res || "unknown"}`);
  applied.push(response.data?.applied?.[0] || { template_id: upsert.template_id });
}

await sleep(16_000);
const syncAfter = await post("/templates/sync", { cursor: 0, include_content: true });
const afterRevision = Number(syncAfter.data.current_revision);
const verified = latestTemplates(syncAfter.data.changes);
for (const id of TEMPLATE_IDS) {
  const template = verified.get(id);
  if (!template) throw new Error(`Template missing after mutation: ${id}`);
  const beforeSets = prescriptions.get(id);
  if (template.movement.length !== beforeSets.length) throw new Error(`Movement count changed for ${id}`);
  template.movement.forEach((item, index) => {
    if (JSON.stringify(item.sets || []) !== JSON.stringify(beforeSets[index])) {
      throw new Error(`Prescription changed for ${id} movement ${index + 1}`);
    }
  });
}
if (afterRevision <= beforeRevision) throw new Error("Template revision did not increase");

console.log(JSON.stringify({
  ...summary,
  after_revision: afterRevision,
  applied,
  templates: TEMPLATE_IDS.map(id => {
    const template = verified.get(id);
    return { template_id: id, name: template.name, version: template.version, movements: template.movement.length };
  })
}, null, 2));

function latestTemplates(changes) {
  const map = new Map();
  for (const change of changes || []) {
    if (change.entity_type !== "template") continue;
    if (change.operation === "delete") map.delete(String(change.entity_id));
    else if (change.data) map.set(String(change.entity_id), change.data);
  }
  return map;
}

async function post(path, body) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path} failed (${response.status}): ${data.error || data.data?.res || "unknown"}`);
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
