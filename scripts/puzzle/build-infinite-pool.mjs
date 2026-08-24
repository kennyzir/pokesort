import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { loadCategoryModel } from "./category-model.mjs";
import { evaluateCandidateBoard, GENERATOR_VERSION } from "./generator.mjs";
import {
  ADVERTISED_INFINITE_RULE_FAMILIES,
  groupPairs,
  INFINITE_DIVERSITY_POLICY,
  scaledFamilyTargets,
} from "./infinite-diversity-policy.mjs";
import { SeededRandom } from "./prng.mjs";
import { buildRuleUniverse, canonicalMemberSignature } from "./rule-universe.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";

export const INFINITE_POOL_SCHEMA_VERSION = 2;
export const INFINITE_POOL_GENERATOR_VERSION = "qb4-infinite-pool-v2";
export const INFINITE_POOL_SEED = "pokesort-infinite-pool-diverse-2026-v2";
export const INFINITE_POOL_SIZE = 1_000;
export const INFINITE_SHARD_SIZE = 50;
export const INFINITE_SEQUENCE_STEP = 791;
export const INFINITE_SEQUENCE_OFFSET = 137;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputDirectory = resolve(moduleDirectory, "../../data/puzzles/infinite");
const defaultDailyDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");

function bytes(value) {
  return `${canonicalJson(value, 2)}\n`;
}

async function writeOutput(path, contents, replaceExisting) {
  let existing;
  try { existing = await readFile(path, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing !== undefined) {
    if (existing === contents) return "unchanged";
    if (!replaceExisting) throw new Error(`IMMUTABLE_POOL_MISMATCH: ${path}; pass --replace only for an explicitly approved pool version migration`);
    await writeFile(path, contents, "utf8");
    return "replaced";
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return "created";
}

async function dailyExclusions(dailyDirectory) {
  const index = JSON.parse(await readFile(resolve(dailyDirectory, "index.json"), "utf8"));
  const boardSignatures = new Set();
  const exactGroupSignatures = new Set();
  const memberGroupSignatures = new Set();
  for (const entry of index.entries) {
    const manifest = JSON.parse(await readFile(resolve(dailyDirectory, entry.file), "utf8"));
    boardSignatures.add(manifest.boardSignature);
    manifest.groups.forEach(({ signature, memberSignature }) => {
      exactGroupSignatures.add(signature);
      memberGroupSignatures.add(memberSignature);
    });
  }
  return { boardSignatures, exactGroupSignatures, memberGroupSignatures };
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function choose4Count(count) {
  return count < 4 ? 0 : (count * (count - 1) * (count - 2) * (count - 3)) / 24;
}

function selectFamilies(remaining, boardsLeft, rng) {
  const required = [...remaining].filter(([, count]) => count === boardsLeft).map(([family]) => family);
  if (required.length > 4) throw new Error(`INFINITE_FAMILY_SCHEDULE_BLOCKED: ${required.length} mandatory families with ${boardsLeft} boards left`);
  const selected = [...required];
  const candidates = [...remaining]
    .filter(([family, count]) => count > 0 && !selected.includes(family))
    .map(([family, count]) => ({ family, pressure: count / boardsLeft, exploration: rng.next() * 0.35 }))
    .sort((left, right) => (right.pressure + right.exploration) - (left.pressure + left.exploration));
  for (const { family } of candidates) {
    if (selected.length === 4) break;
    selected.push(family);
  }
  if (selected.length !== 4) throw new Error(`INFINITE_FAMILY_SCHEDULE_BLOCKED: only ${selected.length} families with ${boardsLeft} boards left`);
  return rng.shuffle(selected);
}

function predicatePriority(rule, predicateExposure) {
  const capacityWeight = Math.max(1, Math.log2(choose4Count(rule.memberIds.length) + 1));
  return (predicateExposure.get(rule.signature) ?? 0) / capacityWeight;
}

function orderedRules(family, rulesByFamily, predicateExposure, rng) {
  const ranked = rng.shuffle(rulesByFamily.get(family) ?? [])
    .sort((left, right) => predicatePriority(left, predicateExposure) - predicatePriority(right, predicateExposure));
  // A strict least-used choice can trap one board on a mutually ambiguous set
  // of broad predicates forever. Explore a bounded low-exposure window while
  // retaining the global quota bias and deterministic seed behavior.
  const windowSize = Math.min(8, ranked.length);
  return [...rng.shuffle(ranked.slice(0, windowSize)), ...ranked.slice(windowSize)];
}

function sampledQuartets(available, rng, maximum) {
  const total = choose4Count(available.length);
  const limit = Math.min(total, maximum);
  const output = [];
  const seen = new Set();
  for (let attempt = 0; output.length < limit && attempt < limit * 20; attempt += 1) {
    const ids = rng.sample(available, 4).sort((left, right) => left - right);
    const signature = canonicalMemberSignature(ids);
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(ids);
  }
  if (output.length === limit) return output;
  for (let a = 0; a < available.length - 3 && output.length < limit; a += 1) {
    for (let b = a + 1; b < available.length - 2 && output.length < limit; b += 1) {
      for (let c = b + 1; c < available.length - 1 && output.length < limit; c += 1) {
        for (let d = c + 1; d < available.length && output.length < limit; d += 1) {
          const ids = [available[a], available[b], available[c], available[d]];
          const signature = canonicalMemberSignature(ids);
          if (!seen.has(signature)) { seen.add(signature); output.push(ids); }
        }
      }
    }
  }
  return output;
}

function quartetScore(memberIds, speciesExposure, pairExposure) {
  const counts = memberIds.map((id) => speciesExposure.get(id) ?? 0);
  const unseen = counts.filter((count) => count === 0).length;
  const pairCount = groupPairs(memberIds).reduce((total, key) => total + (pairExposure.get(key) ?? 0), 0);
  return -unseen * 1_000_000 + Math.max(...counts) * 10_000 + counts.reduce((total, count) => total + count, 0) * 100 + pairCount;
}

function drawQuartet({ rule, rng, usedSpecies, usedExactGroups, usedMemberGroups, speciesExposure, pairExposure, policy }) {
  const available = rule.memberIds.filter((id) => !usedSpecies.has(id) && (speciesExposure.get(id) ?? 0) < policy.maximumBoardsPerSpecies);
  if (available.length < 4) return null;
  const candidates = sampledQuartets(available, rng, policy.quartetSamplesPerRule)
    .filter((memberIds) => {
      const memberSignature = canonicalMemberSignature(memberIds);
      if (usedMemberGroups.has(memberSignature) || usedExactGroups.has(`${rule.signature}#${memberSignature}`)) return false;
      return groupPairs(memberIds).every((key) => (pairExposure.get(key) ?? 0) < policy.maximumBoardsPerPair);
    })
    .sort((left, right) => quartetScore(left, speciesExposure, pairExposure) - quartetScore(right, speciesExposure, pairExposure));
  return candidates[0] ?? null;
}

function matchingIntendedPredicates(puzzle, intendedGroups) {
  const intended = intendedGroups.map(({ instance, memberIds }) => `${canonicalMemberSignature(memberIds)}=${instance.signature}`).sort();
  const actual = puzzle.groups.map(({ memberSignature, predicateSignature }) => `${memberSignature}=${predicateSignature}`).sort();
  return canonicalJson(intended) === canonicalJson(actual);
}

function emptyGenerationAudit() {
  return { attempted: 0, accepted: 0, ambiguous: 0, unsolved: 0, constructionRejected: 0, predicateMismatch: 0, dailyCollision: 0, duplicate: 0, familyScheduleExhausted: 0 };
}

function compactPuzzle(puzzle, poolIndex) {
  const base = {
    schemaVersion: INFINITE_POOL_SCHEMA_VERSION,
    poolGeneratorVersion: INFINITE_POOL_GENERATOR_VERSION,
    generatorVersion: puzzle.generatorVersion,
    factsSchemaVersion: puzzle.factsSchemaVersion,
    datasetId: puzzle.datasetId,
    categoryModelId: puzzle.categoryModelId,
    poolIndex,
    boardSignature: puzzle.boardSignature,
    cards: puzzle.cards.map(({ id, identifier, name, provenanceRefs }) => ({ id, identifier, name, provenanceRefs })),
    groups: puzzle.groups.map((group) => ({
      signature: group.signature,
      memberSignature: group.memberSignature,
      predicateSignature: group.predicateSignature,
      memberIds: group.memberIds,
      label: group.label,
      hint: group.hint,
      explanation: group.explanation,
      provenance: group.provenance,
      matchingRuleEvidence: group.matchingRuleEvidence,
      members: group.members.map(({ id, identifier, name, provenanceRefs }) => ({ id, identifier, name, provenanceRefs })),
    })),
    solver: { solutionCount: puzzle.solver.solutionCount, countComplete: puzzle.solver.countComplete, partitionSignature: puzzle.solver.partitionSignature },
  };
  const contentHash = sha256(base);
  return { ...base, puzzleId: `infinite-${contentHash.slice(0, 20)}`, contentHash };
}

function mapObject(map) {
  return Object.fromEntries([...map].sort(([left], [right]) => String(left).localeCompare(String(right), "en", { numeric: true })));
}

function diversityReport({ poolSize, model, targets, audit, familyExposure, predicateExposure, speciesExposure, pairExposure }) {
  const groups = poolSize * 4;
  const coveredFamilies = ADVERTISED_INFINITE_RULE_FAMILIES.filter((family) => (familyExposure.get(family) ?? 0) > 0);
  const publicFamilyNames = { type: "type", dual_type: "exact dual type", generation: "generation", color: "color", evolution_stage: "evolution stage", baby: "baby", legendary: "legendary", mythical: "mythical" };
  const base = {
    schemaVersion: 1,
    gate: "PASS",
    policy: INFINITE_DIVERSITY_POLICY,
    poolGeneratorVersion: INFINITE_POOL_GENERATOR_VERSION,
    datasetId: model.facts.datasetId,
    categoryModelId: model.rules.modelId,
    poolSize,
    groupCount: groups,
    publicCapabilities: {
      poolSize,
      noRepeatRounds: poolSize,
      advertisedFamilies: coveredFamilies.map((family) => publicFamilyNames[family]),
    },
    targetFamilyCounts: targets,
    familyExposure: mapObject(familyExposure),
    predicateExposure: mapObject(predicateExposure),
    speciesExposure: mapObject(speciesExposure),
    pairExposure: mapObject(pairExposure),
    summary: {
      coveredAdvertisedFamilies: coveredFamilies,
      advertisedFamilyCoverage: coveredFamilies.length,
      maximumFamilyGroups: Math.max(...familyExposure.values()),
      maximumFamilyShare: Math.max(...familyExposure.values()) / groups,
      speciesCoverage: speciesExposure.size,
      totalSpecies: model.facts.pokemon.length,
      maximumBoardsPerSpecies: Math.max(...speciesExposure.values()),
      distinctPairs: pairExposure.size,
      maximumBoardsPerPair: Math.max(...pairExposure.values()),
    },
    generationAudit: audit,
  };
  return { ...base, contentHash: sha256(base) };
}

function enforceDiversityGate(report, policy = INFINITE_DIVERSITY_POLICY) {
  const failures = [];
  if (report.summary.advertisedFamilyCoverage !== ADVERTISED_INFINITE_RULE_FAMILIES.length) failures.push("advertised_family_coverage");
  if (report.summary.maximumFamilyShare > policy.maximumFamilyShare) failures.push("maximum_family_share");
  if (report.summary.speciesCoverage < policy.minimumSpeciesCoverage) failures.push("species_coverage");
  if (report.summary.maximumBoardsPerSpecies > policy.maximumBoardsPerSpecies) failures.push("species_exposure");
  if (report.summary.maximumBoardsPerPair > policy.maximumBoardsPerPair) failures.push("pair_exposure");
  if (failures.length) throw new Error(`INFINITE_DIVERSITY_GATE_BLOCKED: ${failures.join(",")}; ${JSON.stringify(report.summary)}`);
}

export async function buildInfinitePool({
  outputDirectory = defaultOutputDirectory,
  dailyDirectory = defaultDailyDirectory,
  poolSize = INFINITE_POOL_SIZE,
  shardSize = INFINITE_SHARD_SIZE,
  write = true,
  replaceExisting = false,
  enforceDiversity = poolSize === INFINITE_POOL_SIZE,
  policy = INFINITE_DIVERSITY_POLICY,
} = {}) {
  if (!Number.isSafeInteger(poolSize) || poolSize <= 0) throw new Error("poolSize must be a positive safe integer");
  if (!Number.isSafeInteger(shardSize) || shardSize <= 0) throw new Error("shardSize must be a positive safe integer");
  const started = performance.now();
  const [excluded, model] = await Promise.all([dailyExclusions(dailyDirectory), loadCategoryModel()]);
  const universe = buildRuleUniverse(model);
  const rulesByFamily = new Map(ADVERTISED_INFINITE_RULE_FAMILIES.map((family) => [family, universe.filter(({ ruleId }) => ruleId === family)]));
  const missing = [...rulesByFamily].filter(([, rules]) => rules.length === 0).map(([family]) => family);
  if (missing.length) throw new Error(`INFINITE_RULE_FAMILIES_UNAVAILABLE: ${missing.join(",")}`);
  const targets = scaledFamilyTargets(poolSize, policy);
  const remainingFamilyTargets = new Map(Object.entries(targets));
  const audit = emptyGenerationAudit();
  const puzzles = [];
  const usedBoards = new Set(excluded.boardSignatures);
  const usedExactGroups = new Set(excluded.exactGroupSignatures);
  const usedMemberGroups = new Set(excluded.memberGroupSignatures);
  const familyExposure = new Map(ADVERTISED_INFINITE_RULE_FAMILIES.map((family) => [family, 0]));
  const predicateExposure = new Map();
  const speciesExposure = new Map();
  const pairExposure = new Map();

  for (let boardIndex = 0; boardIndex < poolSize; boardIndex += 1) {
    let accepted = null;
    let acceptedFamilies = null;
    for (let attempt = 1; attempt <= policy.maximumAttemptsPerBoard; attempt += 1) {
      audit.attempted += 1;
      const candidateSeed = `${INFINITE_POOL_SEED}|board:${boardIndex}|attempt:${attempt}`;
      const rng = new SeededRandom(candidateSeed);
      const families = selectFamilies(remainingFamilyTargets, poolSize - boardIndex, rng);
      const intendedGroups = [];
      const boardSpecies = new Set();
      let constructionFailed = false;
      for (const family of families) {
        const rules = orderedRules(family, rulesByFamily, predicateExposure, rng);
        let selected = null;
        for (const rule of rules) {
          const memberIds = drawQuartet({ rule, rng, usedSpecies: boardSpecies, usedExactGroups, usedMemberGroups, speciesExposure, pairExposure, policy });
          if (memberIds) { selected = { instance: rule, memberIds }; break; }
        }
        if (!selected) { constructionFailed = true; break; }
        intendedGroups.push(selected);
        selected.memberIds.forEach((id) => boardSpecies.add(id));
      }
      if (constructionFailed || boardSpecies.size !== 16) { audit.constructionRejected += 1; continue; }
      const evaluation = evaluateCandidateBoard({
        model,
        ruleUniverse: universe,
        boardIds: rng.shuffle([...boardSpecies]),
        intendedGroups,
        candidateSeed,
        contentSeed: null,
        attemptNumber: attempt,
      });
      if (evaluation.status !== "accepted") {
        if (evaluation.status === "ambiguous") audit.ambiguous += 1;
        else if (evaluation.status === "unsolved") audit.unsolved += 1;
        else audit.constructionRejected += 1;
        continue;
      }
      if (!matchingIntendedPredicates(evaluation.puzzle, intendedGroups)) { audit.predicateMismatch += 1; continue; }
      if (usedBoards.has(evaluation.puzzle.boardSignature)) { audit.duplicate += 1; continue; }
      if (excluded.boardSignatures.has(evaluation.puzzle.boardSignature)
        || evaluation.puzzle.groups.some(({ signature }) => excluded.exactGroupSignatures.has(signature))
        || evaluation.puzzle.groups.some(({ memberSignature }) => excluded.memberGroupSignatures.has(memberSignature))) {
        audit.dailyCollision += 1;
        continue;
      }
      accepted = evaluation.puzzle;
      acceptedFamilies = families;
      break;
    }
    if (!accepted) {
      audit.familyScheduleExhausted += 1;
      throw new Error(`INFINITE_BOARD_EXHAUSTED: board=${boardIndex}; remainingFamilies=${JSON.stringify(Object.fromEntries(remainingFamilyTargets))}; audit=${JSON.stringify(audit)}`);
    }
    acceptedFamilies.forEach((family) => remainingFamilyTargets.set(family, remainingFamilyTargets.get(family) - 1));
    audit.accepted += 1;
    const puzzle = compactPuzzle(accepted, boardIndex);
    puzzles.push(puzzle);
    usedBoards.add(puzzle.boardSignature);
    for (const group of puzzle.groups) {
      usedExactGroups.add(group.signature);
      usedMemberGroups.add(group.memberSignature);
      const family = group.matchingRuleEvidence.find(({ signature }) => signature === group.predicateSignature)?.ruleId;
      if (!familyExposure.has(family)) throw new Error(`INFINITE_UNADVERTISED_INTENDED_FAMILY: ${family}`);
      increment(familyExposure, family);
      increment(predicateExposure, group.predicateSignature);
      groupPairs(group.memberIds).forEach((key) => increment(pairExposure, key));
    }
    puzzle.cards.forEach(({ id }) => increment(speciesExposure, id));
  }
  const remainingFamilySlots = [...remainingFamilyTargets].filter(([, count]) => count !== 0);
  if (remainingFamilySlots.length) throw new Error(`INFINITE_FAMILY_TARGET_MISMATCH: ${JSON.stringify(remainingFamilySlots)}`);

  const timing = { milliseconds: Number((performance.now() - started).toFixed(2)) };
  const report = diversityReport({ poolSize, model, targets, audit, familyExposure, predicateExposure, speciesExposure, pairExposure });
  if (enforceDiversity) enforceDiversityGate(report, policy);
  const outputs = [];
  const shardEntries = [];
  for (let start = 0; start < puzzles.length; start += shardSize) {
    const number = Math.floor(start / shardSize);
    const file = `shard-${String(number).padStart(3, "0")}.json`;
    const shardBase = { schemaVersion: INFINITE_POOL_SCHEMA_VERSION, poolGeneratorVersion: INFINITE_POOL_GENERATOR_VERSION, start, count: Math.min(shardSize, puzzles.length - start), puzzles: puzzles.slice(start, start + shardSize) };
    const shard = { ...shardBase, contentHash: sha256(shardBase) };
    outputs.push({ path: resolve(outputDirectory, file), contents: bytes(shard) });
    shardEntries.push({ file, start: shard.start, count: shard.count, contentHash: shard.contentHash });
  }
  const reportFile = "diversity-report.json";
  outputs.push({ path: resolve(outputDirectory, reportFile), contents: bytes(report) });
  const indexBase = {
    schemaVersion: INFINITE_POOL_SCHEMA_VERSION,
    poolGeneratorVersion: INFINITE_POOL_GENERATOR_VERSION,
    generatorVersion: GENERATOR_VERSION,
    factsSchemaVersion: puzzles[0].factsSchemaVersion,
    datasetId: puzzles[0].datasetId,
    categoryModelId: puzzles[0].categoryModelId,
    seed: INFINITE_POOL_SEED,
    poolSize,
    shardSize,
    sequence: { offset: INFINITE_SEQUENCE_OFFSET, step: INFINITE_SEQUENCE_STEP, guaranteedNoRepeatRounds: poolSize },
    exclusions: { dailyCalendar: true, dailyBoardsChecked: excluded.boardSignatures.size },
    diversity: { policyId: policy.policyId, reportFile, contentHash: report.contentHash, summary: report.summary },
    generationAudit: audit,
    shards: shardEntries,
  };
  const index = { ...indexBase, contentHash: sha256(indexBase) };
  outputs.push({ path: resolve(outputDirectory, "index.json"), contents: bytes(index) });
  const writes = { created: 0, unchanged: 0, replaced: 0 };
  if (write) for (const output of outputs) writes[await writeOutput(output.path, output.contents, replaceExisting)] += 1;
  return { index, puzzles, report, outputs, writes, timing };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output-dir") options.outputDirectory = resolve(argv[++index]);
    else if (argv[index] === "--replace") options.replaceExisting = true;
    else if (argv[index] === "--no-write") options.write = false;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildInfinitePool(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify({ poolSize: result.index.poolSize, shards: result.index.shards.length, generationAudit: result.index.generationAudit, diversity: result.report.summary, writes: result.writes, timing: result.timing }, null, 2));
}
