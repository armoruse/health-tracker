export const KNOWN_NATIVE_MOVEMENTS = Object.freeze({
  "最伟大拉伸": "f_s_f138",
  "胸椎拉伸和打开": "thoracicSpineStretchAndOpening",
  "辅助胸拉伸": "12591301-Behind-Head-Chest-Stretch",
  "三角肌后束拉伸": "06691301-Rear-Deltoid-Stretch_Shoulders",
  "单腿跪姿股四头肌拉伸": "f_s_f14",
  "坐姿腿拉伸": "06921301-Seated-Single-Leg-Hamstring-Stretch",
  "站姿腓肠肌拉伸": "f_s_f205",
  "手臂交叉拉伸": "19801301-Across-Chest-Shoulder-Stretch_Back",
  "蝴蝶式瑜伽拉伸": "f_s_f178",
  "坐姿下背部拉伸": "f_s_f47"
});

export function normalizeMovementName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s\-_/·•]/g, "")
    .replace(/[，,.:;：；]/g, "");
}

export function normalizeCatalog(payload) {
  const raw = payload?.res?.movements || payload?.data?.movements || payload?.movements || [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(item => item && typeof item === "object" && item.name).map(item => {
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter(Boolean).map(String) : [];
    const explicitIdentity = item.key ?? item.id ?? item.movement_key ?? item.movement_id;
    return {
      identity: explicitIdentity == null ? null : String(explicitIdentity),
      identity_field: explicitIdentity == null ? null :
        (item.key != null ? "key" : item.id != null ? "id" : item.movement_key != null ? "movement_key" : "movement_id"),
      native_identity_available: explicitIdentity != null,
      official_name: String(item.name),
      name: String(item.name),
      label: item.label == null ? String(item.name) : String(item.label),
      aliases,
      equipment: item.equipment ?? null,
      muscle: item.primary_muscle ?? item.muscle ?? null,
      category: item.category ?? item.type ?? null,
      movement_type: item.exetype ?? item.exercise_type ?? null,
      raw: item
    };
  });
}

export function resolveNativeMovement(input, catalog, options = {}) {
  const movements = Array.isArray(catalog) ? catalog : normalizeCatalog(catalog);
  const source = typeof input === "string" ? { name: input } : (input || {});
  const wantedName = String(source.name || source.label || "");
  const knownKey = source.key || source.id || source.movement_key || options.knownKey || KNOWN_NATIVE_MOVEMENTS[wantedName];

  if (knownKey) {
    const byKey = movements.find(item => item.identity === String(knownKey));
    const knownName = Object.entries(KNOWN_NATIVE_MOVEMENTS).find(([, key]) => key === String(knownKey))?.[0];
    if (byKey || knownName === wantedName || options.allowKnownKey !== false) {
      return matched(byKey || {
        identity: String(knownKey), identity_field: "known_key", name: wantedName, label: wantedName,
        aliases: [], equipment: null, muscle: null, category: null, movement_type: null, raw: null
      }, "key_exact", 1);
    }
  }

  const nameExact = movements.filter(item => item.name === wantedName || item.label === wantedName);
  if (nameExact.length === 1) return matched(nameExact[0], "name_exact", 1);
  if (nameExact.length > 1) return ambiguous(nameExact, "name_exact");

  const normalizedWanted = normalizeMovementName(wantedName);
  const normalizedExact = movements.filter(item =>
    normalizeMovementName(item.name) === normalizedWanted || normalizeMovementName(item.label) === normalizedWanted
  );
  if (normalizedExact.length === 1) return matched(normalizedExact[0], "normalized_name_exact", 0.98);
  if (normalizedExact.length > 1) return ambiguous(normalizedExact, "normalized_name_exact");

  const aliasMatches = movements.filter(item => item.aliases.some(alias =>
    alias === wantedName || normalizeMovementName(alias) === normalizedWanted
  ));
  if (aliasMatches.length === 1) return matched(aliasMatches[0], "alias", 0.96);
  if (aliasMatches.length > 1) return ambiguous(aliasMatches, "alias");

  const equipment = source.equipment ?? options.equipment;
  const muscle = source.muscle ?? source.primary_muscle ?? options.muscle;
  const movementType = source.movement_type ?? source.exetype ?? source.exercise_type ?? options.movementType;
  const hasAllMetadata = hasValue(equipment) && hasValue(muscle) && hasValue(movementType);
  const ranked = movements.map(item => ({
    movement: item,
    score: fuzzyScore(wantedName, item, { equipment, muscle, movementType })
  })).sort((a, b) => b.score - a.score).slice(0, options.candidateLimit || 5);

  const top = ranked[0];
  const second = ranked[1];
  const threshold = options.fuzzyThreshold ?? 0.83;
  const margin = options.ambiguityMargin ?? 0.08;
  if (hasAllMetadata && top && top.score >= threshold && (!second || top.score - second.score >= margin)) {
    return matched(top.movement, "fuzzy", Number(top.score.toFixed(3)));
  }

  return {
    matched: false,
    reason: hasAllMetadata ? "low_confidence_or_ambiguous" : "fuzzy_requires_equipment_muscle_and_movement_type",
    confidence: top ? Number(top.score.toFixed(3)) : 0,
    candidates: ranked.map(candidate => candidateView(candidate.movement, candidate.score))
  };
}

export function bindNativeMovement(templateMovement, resolution) {
  if (!resolution?.matched) return { movement: structuredClone(templateMovement), resolution };
  const { name: _name, label: _label, key: _key, id: _id, movement_key: _movementKey, movement_id: _movementId, ...prescription } = structuredClone(templateMovement);
  if (resolution.method === "key_exact" && resolution.movement.identity) {
    return {
      movement: {
        ...prescription,
        label: resolution.movement.label,
        key: resolution.movement.identity
      },
      resolution
    };
  }
  return {
    movement: {
      ...prescription,
      name: resolution.movement.name
    },
    resolution
  };
}

function matched(movement, method, confidence) {
  return { matched: true, method, confidence, movement, candidates: [] };
}

function ambiguous(candidates, method) {
  return {
    matched: false,
    reason: "ambiguous",
    method,
    confidence: 0,
    candidates: candidates.map(item => candidateView(item, 1))
  };
}

function candidateView(item, score) {
  return {
    identity: item.identity,
    official_name: item.name,
    name: item.name,
    label: item.label,
    equipment: item.equipment,
    muscle: item.muscle,
    category: item.category,
    movement_type: item.movement_type,
    confidence: Number(score.toFixed(3))
  };
}

function fuzzyScore(name, item, metadata) {
  const nameScore = diceCoefficient(normalizeMovementName(name), normalizeMovementName(item.name));
  const equipmentScore = metadataScore(metadata.equipment, item.equipment);
  const muscleScore = metadataScore(metadata.muscle, item.muscle ?? item.category);
  const typeScore = metadataScore(metadata.movementType, item.movement_type ?? item.category);
  return (nameScore * 0.58) + (equipmentScore * 0.16) + (muscleScore * 0.16) + (typeScore * 0.10);
}

function metadataScore(wanted, actual) {
  if (!hasValue(wanted) || !hasValue(actual)) return 0;
  const wantedValues = Array.isArray(wanted) ? wanted : [wanted];
  const actualValues = Array.isArray(actual) ? actual : [actual];
  return wantedValues.some(left => actualValues.some(right => {
    const a = normalizeMovementName(left);
    const b = normalizeMovementName(right);
    return a === b || a.includes(b) || b.includes(a);
  })) ? 1 : 0;
}

function diceCoefficient(left, right) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const counts = new Map();
  for (let i = 0; i < left.length - 1; i++) {
    const pair = left.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < right.length - 1; i++) {
    const pair = right.slice(i, i + 2);
    const count = counts.get(pair) || 0;
    if (count > 0) {
      intersection++;
      counts.set(pair, count - 1);
    }
  }
  return (2 * intersection) / ((left.length - 1) + (right.length - 1));
}

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : value != null && String(value).trim() !== "";
}
