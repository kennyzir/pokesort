export const ADVERTISED_INFINITE_RULE_FAMILIES = Object.freeze([
  "type",
  "dual_type",
  "generation",
  "color",
  "evolution_stage",
  "baby",
  "legendary",
  "mythical",
]);

// Monotype is intentionally absent. It is an additive Daily capacity predicate,
// not one of the eight category families promised by the Infinite product copy.
export const INFINITE_DIVERSITY_POLICY = Object.freeze({
  schemaVersion: 1,
  policyId: "pokesort-infinite-diversity-v1",
  poolSize: 1_000,
  groupsPerBoard: 4,
  familyWeights: Object.freeze({
    type: 800,
    dual_type: 600,
    generation: 750,
    color: 700,
    evolution_stage: 650,
    baby: 120,
    legendary: 200,
    mythical: 180,
  }),
  maximumFamilyShare: 0.4,
  minimumSpeciesCoverage: 820,
  maximumBoardsPerSpecies: 50,
  maximumBoardsPerPair: 12,
  maximumAttemptsPerBoard: 5_000,
  quartetSamplesPerRule: 96,
});

export function scaledFamilyTargets(poolSize, policy = INFINITE_DIVERSITY_POLICY) {
  if (!Number.isSafeInteger(poolSize) || poolSize <= 0) throw new RangeError("poolSize must be a positive safe integer");
  const totalSlots = poolSize * policy.groupsPerBoard;
  const entries = Object.entries(policy.familyWeights);
  if (totalSlots < entries.length) throw new RangeError("poolSize is too small to cover every advertised family");
  const totalWeight = entries.reduce((total, [, weight]) => total + weight, 0);
  const raw = entries.map(([family, weight]) => ({ family, raw: (weight / totalWeight) * totalSlots }));
  const targets = Object.fromEntries(raw.map(({ family, raw: value }) => [family, Math.max(1, Math.floor(value))]));
  let assigned = Object.values(targets).reduce((total, value) => total + value, 0);
  for (const { family } of [...raw].sort((left, right) => (right.raw % 1) - (left.raw % 1) || left.family.localeCompare(right.family))) {
    if (assigned >= totalSlots) break;
    targets[family] += 1;
    assigned += 1;
  }
  while (assigned > totalSlots) {
    const candidate = Object.entries(targets)
      .filter(([, value]) => value > 1)
      .sort(([leftFamily, left], [rightFamily, right]) => right - left || leftFamily.localeCompare(rightFamily))[0];
    if (!candidate) throw new Error("Could not scale Infinite family targets");
    targets[candidate[0]] -= 1;
    assigned -= 1;
  }
  const overCapacity = Object.entries(targets).find(([, value]) => value > poolSize);
  if (overCapacity) throw new Error(`Infinite family target exceeds one-per-board capacity: ${overCapacity[0]}=${overCapacity[1]}`);
  return targets;
}

export function pairKey(left, right) {
  return left < right ? `${left}-${right}` : `${right}-${left}`;
}

export function groupPairs(memberIds) {
  const pairs = [];
  for (let left = 0; left < memberIds.length - 1; left += 1) {
    for (let right = left + 1; right < memberIds.length; right += 1) pairs.push(pairKey(memberIds[left], memberIds[right]));
  }
  return pairs;
}
