import { loadCategoryModel } from "./category-model.mjs";
import { SeededRandom } from "./prng.mjs";
import {
  buildRuleUniverse,
  canonicalBoardSignature,
  canonicalGroupSignature,
  canonicalMemberSignature,
} from "./rule-universe.mjs";
import { solveBoard } from "./solver.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";

export const GENERATOR_VERSION = "qb2-generator-v1";
export const PUZZLE_SCHEMA_VERSION = 1;

export class PuzzleGenerationError extends Error {
  constructor(message, { code = "GENERATION_EXHAUSTED", audit, cause } = {}) {
    super(message, { cause });
    this.name = "PuzzleGenerationError";
    this.code = code;
    this.audit = audit;
  }
}

function emptyAudit() {
  return {
    attempted: 0,
    accepted: 0,
    ambiguous: 0,
    unsolved: 0,
    duplicate: 0,
    constructionRejected: 0,
    exhausted: 0,
  };
}

function mergeAudit(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0;
}

function sampledGroupPartitionSignature(groups) {
  return groups.map(({ memberIds }) => canonicalMemberSignature(memberIds)).sort().join("|");
}

function solutionPartitionSignature(partition) {
  return partition.map(({ memberSignature }) => memberSignature).sort().join("|");
}

function enumerateQuartets(memberIds) {
  const quartets = [];
  for (let a = 0; a < memberIds.length - 3; a += 1) {
    for (let b = a + 1; b < memberIds.length - 2; b += 1) {
      for (let c = b + 1; c < memberIds.length - 1; c += 1) {
        for (let d = c + 1; d < memberIds.length; d += 1) quartets.push([memberIds[a], memberIds[b], memberIds[c], memberIds[d]]);
      }
    }
  }
  return quartets;
}

function createAnchorPool(ruleUniverse, rootSeed) {
  const pools = new Map();
  for (const instance of ruleUniverse.filter(({ ruleId }) => ["dual_type", "baby", "mythical"].includes(ruleId))) {
    const poolRandom = new SeededRandom(`${rootSeed}|anchor-pool|${instance.signature}`);
    pools.set(instance.signature, { quartets: poolRandom.shuffle(enumerateQuartets(instance.memberIds)), cursor: 0 });
  }
  return {
    has(instance) {
      const pool = pools.get(instance.signature);
      return Boolean(pool?.quartets.length);
    },
    draw(instance, usedSpecies = new Set(), forbiddenMemberGroupSignatures = new Set()) {
      const pool = pools.get(instance.signature);
      if (!pool) return null;
      // Rejected candidates do not publish their groups, so their quartets may be
      // reconsidered in a different board. The cursor advances deterministically and
      // this loop is strictly bounded by the finite precomputed pool.
      for (let checked = 0; checked < pool.quartets.length; checked += 1) {
        const memberIds = pool.quartets[pool.cursor % pool.quartets.length];
        pool.cursor += 1;
        if (memberIds.some((id) => usedSpecies.has(id))) continue;
        if (forbiddenMemberGroupSignatures.has(canonicalMemberSignature(memberIds))) continue;
        return memberIds;
      }
      return null;
    },
    capacity: [...pools.values()].reduce((total, pool) => total + pool.quartets.length, 0),
  };
}

function selectConstructiveGroups(ruleUniverse, rng, anchorPool, forbiddenMemberGroupSignatures) {
  // V1 uses narrow, source-backed exact typing and official flag rules as constructive
  // anchors. The solver still evaluates every published QB1 rule, including broad
  // type, generation, color, and evolution-stage rules.
  const flags = rng.shuffle(ruleUniverse.filter((instance) => ["baby", "mythical"].includes(instance.ruleId) && anchorPool.has(instance)));
  const dualTypes = rng.shuffle(ruleUniverse.filter((instance) => instance.ruleId === "dual_type" && anchorPool.has(instance)));
  const selected = [];
  const usedSpecies = new Set();
  const usedTypes = new Set();
  const flagCount = rng.integer(flags.length + 1);
  for (const instance of flags.slice(0, flagCount)) {
    const memberIds = anchorPool.draw(instance, usedSpecies, forbiddenMemberGroupSignatures);
    if (!memberIds) continue;
    selected.push({ instance, memberIds });
    memberIds.forEach((id) => usedSpecies.add(id));
  }
  for (const instance of dualTypes) {
    const types = [instance.parameters.typeA, instance.parameters.typeB];
    if (types.some((type) => usedTypes.has(type))) continue;
    const memberIds = anchorPool.draw(instance, usedSpecies, forbiddenMemberGroupSignatures);
    if (!memberIds) continue;
    selected.push({ instance, memberIds });
    memberIds.forEach((id) => usedSpecies.add(id));
    types.forEach((type) => usedTypes.add(type));
    if (selected.length === 4) return selected;
  }
  return null;
}

function materializePuzzle({ model, candidateSeed, contentSeed = candidateSeed, attemptNumber, boardIds, solved }) {
  const pokemonById = new Map(model.facts.pokemon.map((pokemon) => [pokemon.id, pokemon]));
  const partition = solved.partitions[0];
  const groups = partition
    .map((group) => {
      const intendedRule = group.matchingRules[0];
      const members = group.memberIds.map((id) => {
        const pokemon = pokemonById.get(id);
        if (!pokemon) throw new Error(`Missing facts for species ${id}`);
        return { id, identifier: pokemon.identifier, name: pokemon.name, provenanceRefs: pokemon.provenanceRefs };
      });
      return {
        signature: canonicalGroupSignature(intendedRule.signature, group.memberIds),
        memberSignature: group.memberSignature,
        predicateSignature: intendedRule.signature,
        memberIds: group.memberIds,
        members,
        label: intendedRule.label,
        hint: intendedRule.hint,
        explanation: intendedRule.explanation,
        provenance: intendedRule.provenance,
        matchingRuleEvidence: group.matchingRules,
      };
    })
    .sort((left, right) => left.memberSignature.localeCompare(right.memberSignature));

  const cards = boardIds.map((id) => {
    const pokemon = pokemonById.get(id);
    return { id, identifier: pokemon.identifier, name: pokemon.name, provenanceRefs: pokemon.provenanceRefs };
  });
  const content = {
    schemaVersion: PUZZLE_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    factsSchemaVersion: model.facts.schemaVersion,
    datasetId: model.facts.datasetId,
    categoryModelId: model.rules.modelId,
    ...(contentSeed === null || contentSeed === undefined ? {} : { seed: contentSeed }),
    boardSignature: canonicalBoardSignature(boardIds),
    cards,
    groups,
    solver: {
      solutionCount: solved.solutionCount,
      countComplete: solved.countComplete,
      partitionSignature: solutionPartitionSignature(partition),
      validQuartetCount: solved.validQuartetCount,
      overlapRuleCount: groups.reduce((total, group) => total + Math.max(0, group.matchingRuleEvidence.length - 1), 0),
    },
    difficulty: {
      inducedValidQuartets: solved.validQuartetCount,
      solutionLabelOverlaps: groups.map((group) => group.matchingRuleEvidence.length),
    },
    generationAudit: { acceptedOnAttempt: attemptNumber },
  };
  const contentHash = sha256(content);
  return {
    ...content,
    contentHash,
    puzzleId: `qb2-${contentHash.slice(0, 20)}`,
  };
}

export function evaluateCandidateBoard({ model, ruleUniverse, boardIds, intendedGroups, candidateSeed = "fixture", contentSeed = candidateSeed, attemptNumber = 1 }) {
  if (boardIds.length !== 16 || new Set(boardIds).size !== 16) return { status: "construction_rejected", reason: "board_cardinality" };
  const solved = solveBoard(boardIds, ruleUniverse, { maxPartitions: 2, retainPartitions: 2 });
  if (solved.solutionCount === 0) return { status: "unsolved", solved };
  if (solved.solutionCount !== 1) return { status: "ambiguous", solved };
  if (!solved.countComplete) throw new Error("A single retained partition must be a complete count");
  if (intendedGroups && sampledGroupPartitionSignature(intendedGroups) !== solutionPartitionSignature(solved.partitions[0])) {
    return { status: "construction_rejected", reason: "intended_partition_mismatch", solved };
  }
  return { status: "accepted", puzzle: materializePuzzle({ model, candidateSeed, contentSeed, attemptNumber, boardIds, solved }), solved };
}

function attemptCandidate({ model, ruleUniverse, rootSeed, attemptNumber, anchorPool, forbiddenMemberGroupSignatures = new Set() }) {
  const candidateSeed = `${rootSeed}|${model.facts.datasetId}|${GENERATOR_VERSION}|attempt:${attemptNumber}`;
  const rng = new SeededRandom(candidateSeed);
  const intendedGroups = selectConstructiveGroups(ruleUniverse, rng, anchorPool, forbiddenMemberGroupSignatures);
  if (!intendedGroups) return { status: "construction_rejected", reason: "four_disjoint_anchor_rules_unavailable" };
  const boardIds = rng.shuffle(intendedGroups.flatMap(({ memberIds }) => memberIds));
  return evaluateCandidateBoard({ model, ruleUniverse, boardIds, intendedGroups, candidateSeed, attemptNumber });
}

function recordResult(audit, result) {
  audit.attempted += 1;
  if (result.status === "accepted") audit.accepted += 1;
  else if (result.status === "ambiguous") audit.ambiguous += 1;
  else if (result.status === "unsolved") audit.unsolved += 1;
  else audit.constructionRejected += 1;
}

export async function generatePuzzle({ seed, maxAttempts = 2_000, model: suppliedModel, ruleUniverse: suppliedUniverse } = {}) {
  if (seed === undefined || seed === null || seed === "") throw new TypeError("A non-empty seed is required");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) throw new RangeError("maxAttempts must be a positive safe integer");
  const model = suppliedModel ?? await loadCategoryModel();
  const ruleUniverse = suppliedUniverse ?? buildRuleUniverse(model);
  const anchorPool = createAnchorPool(ruleUniverse, String(seed));
  const audit = emptyAudit();
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const result = attemptCandidate({ model, ruleUniverse, rootSeed: String(seed), attemptNumber, anchorPool });
    recordResult(audit, result);
    if (result.status === "accepted") return { puzzle: result.puzzle, audit };
  }
  audit.exhausted = 1;
  throw new PuzzleGenerationError(`Could not generate a unique puzzle in ${maxAttempts} attempts`, { audit });
}

export async function generateBatch({ seed, count, maxAttempts = count * 2_000, model: suppliedModel, ruleUniverse: suppliedUniverse } = {}) {
  if (seed === undefined || seed === null || seed === "") throw new TypeError("A non-empty seed is required");
  if (!Number.isSafeInteger(count) || count <= 0) throw new RangeError("count must be a positive safe integer");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) throw new RangeError("maxAttempts must be a positive safe integer");
  const model = suppliedModel ?? await loadCategoryModel();
  const ruleUniverse = suppliedUniverse ?? buildRuleUniverse(model);
  const anchorPool = createAnchorPool(ruleUniverse, String(seed));
  const audit = emptyAudit();
  const puzzles = [];
  const boardSignatures = new Set();
  const exactGroupSignatures = new Set();
  const memberGroupSignatures = new Set();

  for (let attemptNumber = 1; attemptNumber <= maxAttempts && puzzles.length < count; attemptNumber += 1) {
    const result = attemptCandidate({
      model,
      ruleUniverse,
      rootSeed: String(seed),
      attemptNumber,
      anchorPool,
      forbiddenMemberGroupSignatures: memberGroupSignatures,
    });
    recordResult(audit, result);
    if (result.status !== "accepted") continue;
    const puzzle = result.puzzle;
    const exactGroups = puzzle.groups.map(({ signature }) => signature);
    const memberGroups = puzzle.groups.map(({ memberSignature }) => memberSignature);
    const duplicate = boardSignatures.has(puzzle.boardSignature)
      || exactGroups.some((signature) => exactGroupSignatures.has(signature))
      || memberGroups.some((signature) => memberGroupSignatures.has(signature));
    if (duplicate) {
      audit.accepted -= 1;
      audit.duplicate += 1;
      continue;
    }
    puzzles.push(puzzle);
    boardSignatures.add(puzzle.boardSignature);
    exactGroups.forEach((signature) => exactGroupSignatures.add(signature));
    memberGroups.forEach((signature) => memberGroupSignatures.add(signature));
  }
  if (puzzles.length !== count) {
    audit.exhausted = 1;
    throw new PuzzleGenerationError(`Generated ${puzzles.length} of ${count} requested unique puzzles in ${maxAttempts} attempts`, { audit });
  }
  return {
    schemaVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    datasetId: model.facts.datasetId,
    seed: String(seed),
    puzzles,
    audit,
  };
}

export function serializeGenerated(value) {
  return `${canonicalJson(value, 2)}\n`;
}

export function combineAudit(...audits) {
  const combined = emptyAudit();
  audits.forEach((audit) => mergeAudit(combined, audit));
  return combined;
}
