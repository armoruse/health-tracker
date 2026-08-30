const BRIDGE_URL = (process.env.BRIDGE_URL || "https://body-xunji-bridge.armoruse.workers.dev").replace(/\/$/, "");
const APPLY = process.argv.includes("--apply");
const OFFICIAL_NAMES_URL = "https://raw.githubusercontent.com/Foveluy/Xunji-movements/main/README.md";

const PLANS = Object.freeze({
  "896988171949717": ["杠铃卧推", "上斜杠铃卧推", "哑铃卧推", "拉杆坐姿划船(宽握)", "哑铃推肩", "侧平举", "面拉", "直杆绳索下压", "绳索Pallof推"],
  "896452342598053": ["宽距高位下拉", "窄距下拉", "拉杆坐姿划船(窄握)", "拉杆坐姿划船(宽握)", "绳索肩外旋", "哑铃弯举", "侧平举", "悍马机卷腹"],
  "894662602360569": ["腿举", "坐姿腿屈伸", "哑铃保加利亚蹲", "坐姿髋外展", "坐姿髋内收", "坐姿器械提踵", "绳索Pallof推"],
  "898294457839639": ["深蹲跳", "悍马机臀冲", "坐姿腿弯举", "腿举", "坐姿髋外展", "坐姿器械提踵"],
  "897112973978855": ["9090旋转", "最伟大拉伸", "单腿跪姿股四头肌拉伸", "坐姿单腿腘绳肌拉伸", "台阶式小腿拉伸", "胸椎拉伸和打开", "肩内外旋动态拉伸", "下犬式"],
  "897173877255151": ["深蹲跳", "自重保加利亚蹲", "单腿地面提踵", "自重臀冲", "死虫", "哥本哈根屈膝侧平板支撑", "肩胛屈伸", "俯卧撑"]
});

const NOTES = Object.freeze({
  "896988171949717": [["warmup"], null, "單手重量", null, null, null, null, null, "左右各做"],
  "896452342598053": [null, null, null, null, "左右各做", null, null, null],
  "894662602360569": [null, ["warmup"], "左右各做", null, null, null, "左右各做"],
  "898294457839639": [null, null, ["warmup"], null, null, null],
  "897112973978855": ["左右各做", "左右各做", "左右各做", "左右各做", "左右各做", null, "左右各做", null],
  "897173877255151": [null, "左右各做", "左右各做", null, "左右各做", "左右各做", null, null]
});

const syncBefore = await post("/templates/sync", { cursor: 0, limit: 15, include_content: true });
const beforeRevision = Number(syncBefore.data.current_revision);
const templates = latestTemplates(syncBefore.data.changes);
const catalogResponse = await post("/movements/catalog", {});
const catalogNames = new Set((catalogResponse.normalized || []).map(item => item.name));
const officialNames = await fetchOfficialNames();
const mappings = [];
const upserts = [];
const prescriptions = new Map();

for (const [templateId, officialMovementNames] of Object.entries(PLANS)) {
  const template = templates.get(templateId);
  if (!template) throw new Error(`Target template is missing: ${templateId}`);
  if (template.movement.length !== officialMovementNames.length) throw new Error(`Movement count mismatch for ${template.name}`);
  if (officialMovementNames.length > 15) throw new Error(`Movement limit exceeded for ${template.name}`);

  const movements = officialMovementNames.map((officialName, index) => {
    if (!officialNames.has(officialName)) throw new Error(`Not in official movement list: ${officialName}`);
    const source = template.movement[index];
    const sets = structuredClone(source.sets || []);
    if (sets.length > 20) throw new Error(`Set limit exceeded for ${template.name}: ${officialName}`);
    mappings.push({
      template_id: templateId,
      template: template.name,
      original: source.label || source.name || source.key,
      official: officialName,
      key: null,
      method: catalogNames.has(officialName) ? "catalog_name_exact" : "official_public_name_exact",
      confidence: 1
    });
    return { name: officialName, sets };
  });

  prescriptions.set(templateId, movements.map(item => structuredClone(item.sets)));
  upserts.push({ template_id: templateId, base_version: template.version, name: template.name, color: template.color || "", movements });
}

if (templates.size > 14 || upserts.length > 14) throw new Error("Template limit exceeded");

const summary = { apply: APPLY, before_revision: beforeRevision, total_movements: mappings.length, official_name_matches: mappings.length, unresolved: 0, mappings };
if (!APPLY) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const alreadyNative = Object.entries(PLANS).every(([templateId, names]) => {
  const template = templates.get(templateId);
  return template?.movement?.every((item, index) => item.key && item.key !== item.label && item.label === names[index]);
});

let resolvedSync = syncBefore;
if (!alreadyNative) {
  const mutationId = process.env.MUTATION_ID || `body-native-public-rev-${beforeRevision}`;
  const mutation = await post("/templates/mutate", { confirmed: true, mutation_id: mutationId, upserts, deletes: [] });
  if (mutation.data?.success === false) throw new Error(`Mutation failed: ${mutation.data.res || "unknown"}`);
  resolvedSync = await post("/templates/sync", { cursor: 0, limit: 15, include_content: true });
}

const resolvedTemplates = latestTemplates(resolvedSync.data.changes);
const nativeUpserts = Object.entries(PLANS).map(([templateId]) => {
  const template = resolvedTemplates.get(templateId);
  const movement = structuredClone(template.movement);
  movement.forEach((item, index) => applyNotes(item.sets || [], NOTES[templateId]?.[index]));
  return {
    template_id: templateId,
    base_version: template.version,
    name: template.name,
    color: template.color || "",
    movement,
    rules: template.rules || {}
  };
});
const notesMutation = await post("/templates/mutate", {
  confirmed: true,
  mutation_id: `body-native-notes-rev-${Number(resolvedSync.data.current_revision)}`,
  upserts: nativeUpserts,
  deletes: []
});
if (notesMutation.data?.success === false) throw new Error(`Notes mutation failed: ${notesMutation.data.res || "unknown"}`);

const syncAfter = await post("/templates/sync", { cursor: 0, limit: 15, include_content: true });
const afterRevision = Number(syncAfter.data.current_revision);
const verified = latestTemplates(syncAfter.data.changes);
let nativeBindings = 0;
for (const [templateId, officialMovementNames] of Object.entries(PLANS)) {
  const template = verified.get(templateId);
  if (!template) throw new Error(`Template missing after mutation: ${templateId}`);
  if (template.movement.length !== officialMovementNames.length) throw new Error(`Movement count changed for ${templateId}`);
  template.movement.forEach((item, index) => {
    if (JSON.stringify(prescriptionSignature(item.sets || [])) !== JSON.stringify(prescriptionSignature(prescriptions.get(templateId)[index]))) {
      throw new Error(`Prescription changed for ${templateId} movement ${index + 1}`);
    }
    if (!item.key || item.key === item.label || item.key === item.name) throw new Error(`Native identity was not resolved for ${templateId} movement ${index + 1}`);
    verifyNotes(item.sets || [], NOTES[templateId]?.[index], templateId, index);
    nativeBindings++;
    const mapping = mappings.find(entry => entry.template_id === templateId && entry.official === officialMovementNames[index] && entry.key == null);
    if (mapping) {
      mapping.key = String(item.key);
      mapping.official = item.label || item.name || mapping.official;
      mapping.server_resolved = true;
    }
  });
}
if (afterRevision <= beforeRevision) throw new Error("Template revision did not increase");

console.log(JSON.stringify({
  ...summary,
  after_revision: afterRevision,
  native_bindings: nativeBindings,
  mappings,
  templates: Object.keys(PLANS).map(id => {
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

function prescriptionSignature(sets) {
  return sets.map(set => ({
    weight: String(set.weight ?? set.weight_kg ?? ""),
    reps: String(set.reps ?? ""),
    time: Number(set.time ?? set.duration_s ?? 0)
  }));
}

function applyNotes(sets, noteSpec) {
  if (typeof noteSpec === "string") {
    sets.forEach(set => { set.comment = noteSpec; });
  } else if (Array.isArray(noteSpec)) {
    noteSpec.forEach((note, index) => {
      if (note != null && sets[index]) sets[index].comment = note;
    });
  }
}

function verifyNotes(sets, noteSpec, templateId, movementIndex) {
  if (typeof noteSpec === "string" && sets.some(set => set.comment !== noteSpec)) {
    throw new Error(`Movement note changed for ${templateId} movement ${movementIndex + 1}`);
  }
  if (Array.isArray(noteSpec)) {
    noteSpec.forEach((note, setIndex) => {
      if (note != null && sets[setIndex]?.comment !== note) throw new Error(`Set note changed for ${templateId} movement ${movementIndex + 1}`);
    });
  }
}

async function fetchOfficialNames() {
  const response = await fetch(OFFICIAL_NAMES_URL);
  if (!response.ok) throw new Error(`Official movement list failed (${response.status})`);
  const names = new Set();
  for (const line of (await response.text()).split(/\r?\n/)) {
    const match = line.match(/^\s*\|?\s*\d+\s*\|\s*(.+?)\s*\|?\s*$/);
    if (match) names.add(match[1]);
  }
  if (names.size < 1000) throw new Error("Official movement list is incomplete");
  return names;
}

async function post(path, body) {
  const response = await fetch(`${BRIDGE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(`${path} failed (${response.status}): ${data.error || data.data?.res || "unknown"}`);
  return data;
}
