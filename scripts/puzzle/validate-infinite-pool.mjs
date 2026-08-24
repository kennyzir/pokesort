import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCategoryModel } from "./category-model.mjs";
import { canonicalGroupSignature, canonicalMemberSignature } from "./rule-universe.mjs";
import { buildCanonicalRuleEvidence, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";
import { ADVERTISED_INFINITE_RULE_FAMILIES, groupPairs, INFINITE_DIVERSITY_POLICY } from "./infinite-diversity-policy.mjs";
import {
  INFINITE_POOL_GENERATOR_VERSION,
  INFINITE_POOL_SCHEMA_VERSION,
  INFINITE_POOL_SIZE,
  INFINITE_SEQUENCE_OFFSET,
  INFINITE_SEQUENCE_STEP,
} from "./build-infinite-pool.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPoolDirectory = resolve(moduleDirectory, "../../data/puzzles/infinite");
const defaultDailyDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function verifyContentHash(value, label) {
  const { contentHash, puzzleId, ...rest } = value;
  const base = puzzleId ? rest : { ...rest, ...(puzzleId === undefined ? {} : { puzzleId }) };
  assert(sha256(base) === contentHash, `${label} content hash mismatch`);
}

function partitionSignature(groups) {
  return groups.map(({ memberSignature }) => memberSignature).sort().join("|");
}

export function verifyInfiniteShardStructure(shard, entry, label = entry?.file ?? "Infinite shard") {
  assert(shard && typeof shard === "object" && !Array.isArray(shard), `Malformed shard object: ${label}`);
  assert(shard.schemaVersion === INFINITE_POOL_SCHEMA_VERSION, `Malformed shard schema: ${label}`);
  assert(shard.poolGeneratorVersion === INFINITE_POOL_GENERATOR_VERSION, `Malformed shard generator version: ${label}`);
  assert(Number.isSafeInteger(shard.start) && shard.start >= 0, `Malformed shard start: ${label}`);
  assert(Number.isSafeInteger(shard.count) && shard.count > 0, `Malformed shard count: ${label}`);
  assert(Array.isArray(shard.puzzles) && shard.puzzles.length === shard.count, `Malformed shard puzzle content: ${label}`);
  if (entry) assert(shard.contentHash === entry.contentHash && shard.start === entry.start && shard.count === entry.count, `Infinite shard/index mismatch: ${label}`);
}

export function infinitePoolIndexForRound(round, index) {
  assert(Number.isSafeInteger(round) && round >= 0, "Infinite round must be a non-negative safe integer");
  return (index.sequence.offset + (round % index.poolSize) * index.sequence.step) % index.poolSize;
}

async function loadDailySignatures(dailyDirectory) {
  const index = JSON.parse(await readFile(resolve(dailyDirectory, "index.json"), "utf8"));
  const boards = new Set(), exactGroups = new Set(), memberGroups = new Set();
  for (const entry of index.entries) {
    const manifest = JSON.parse(await readFile(resolve(dailyDirectory, entry.file), "utf8"));
    boards.add(manifest.boardSignature);
    manifest.groups.forEach(({ signature, memberSignature }) => { exactGroups.add(signature); memberGroups.add(memberSignature); });
  }
  return { boards, exactGroups, memberGroups };
}

export async function validateInfinitePool({ poolDirectory = defaultPoolDirectory, dailyDirectory = defaultDailyDirectory, resolveSolverProof = true } = {}) {
  const index = JSON.parse(await readFile(resolve(poolDirectory, "index.json"), "utf8"));
  verifyContentHash(index, "Infinite index");
  assert(index.schemaVersion === INFINITE_POOL_SCHEMA_VERSION, "Unexpected Infinite pool schema version");
  assert(index.poolGeneratorVersion === INFINITE_POOL_GENERATOR_VERSION, "Unexpected Infinite pool generator version");
  assert(index.poolSize === INFINITE_POOL_SIZE, `Infinite pool must contain ${INFINITE_POOL_SIZE} puzzles`);
  assert(index.sequence.step === INFINITE_SEQUENCE_STEP && index.sequence.offset === INFINITE_SEQUENCE_OFFSET, "Unexpected Infinite sequence mapping");
  assert(index.sequence.guaranteedNoRepeatRounds >= 500, "Infinite pool must guarantee at least 500 non-repeating rounds");
  assert(Array.isArray(index.shards) && index.shards.length > 0, "Infinite index shards must be a non-empty array");
  assert(new Set(index.shards.map(({ file }) => file)).size === index.shards.length, "Duplicate Infinite shard file in index");
  assert(index.shards.every(({ file }) => /^shard-\d{3}\.json$/.test(file)), "Malformed Infinite shard filename");
  const sequence = Array.from({ length: index.poolSize }, (_, round) => infinitePoolIndexForRound(round, index));
  assert(new Set(sequence).size === index.poolSize, "Infinite sequence must be a full no-repeat pool permutation");

  const daily = await loadDailySignatures(dailyDirectory);
  const model = await loadCategoryModel();
  const ruleEvidence = buildCanonicalRuleEvidence(model);
  assert(index.factsSchemaVersion === model.facts.schemaVersion, "Infinite index facts schema does not match pinned facts");
  assert(index.datasetId === model.facts.datasetId, "Infinite index dataset does not match pinned facts");
  assert(index.categoryModelId === model.rules.modelId, "Infinite index category model does not match pinned rules");
  assert(index.diversity?.policyId === INFINITE_DIVERSITY_POLICY.policyId, "Infinite diversity policy is missing or stale");
  const report = JSON.parse(await readFile(resolve(poolDirectory, index.diversity.reportFile), "utf8"));
  verifyContentHash(report, "Infinite diversity report");
  assert(report.contentHash === index.diversity.contentHash, "Infinite diversity report/index hash mismatch");
  assert(report.poolGeneratorVersion === INFINITE_POOL_GENERATOR_VERSION, "Infinite diversity report generator mismatch");
  assert(report.datasetId === model.facts.datasetId && report.categoryModelId === model.rules.modelId, "Infinite diversity report model mismatch");
  const boards = new Set(), exactGroups = new Set(), memberGroups = new Set(), puzzleIds = new Set();
  const familyExposure = new Map(ADVERTISED_INFINITE_RULE_FAMILIES.map((family) => [family, 0]));
  const predicateExposure = new Map(), speciesExposure = new Map(), pairExposure = new Map();
  const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  let puzzleCount = 0;
  for (const [shardNumber, entry] of index.shards.entries()) {
    const shard = JSON.parse(await readFile(resolve(poolDirectory, entry.file), "utf8"));
    verifyContentHash(shard, `Infinite shard ${entry.file}`);
    verifyInfiniteShardStructure(shard, entry);
    assert(shard.start === puzzleCount && shard.puzzles.length === shard.count, `Infinite shard range gap: ${entry.file}`);
    for (const puzzle of shard.puzzles) {
      verifyContentHash(puzzle, `Infinite puzzle ${puzzle.poolIndex}`);
      assert(puzzle.puzzleId === `infinite-${puzzle.contentHash.slice(0, 20)}`, `Infinite puzzle ID/hash mismatch: ${puzzle.poolIndex}`);
      assert(puzzle.poolIndex === puzzleCount, `Infinite pool index gap at ${puzzleCount}`);
      assert(puzzle.cards.length === 16 && new Set(puzzle.cards.map(({ id }) => id)).size === 16, `Infinite card cardinality failure: ${puzzle.poolIndex}`);
      assert(puzzle.groups.length === 4 && puzzle.groups.every(({ members }) => members.length === 4), `Infinite group cardinality failure: ${puzzle.poolIndex}`);
      assert(!puzzleIds.has(puzzle.puzzleId) && !boards.has(puzzle.boardSignature), `Duplicate Infinite puzzle/board: ${puzzle.poolIndex}`);
      assert(!daily.boards.has(puzzle.boardSignature), `Infinite board collides with Daily: ${puzzle.poolIndex}`);
      puzzleIds.add(puzzle.puzzleId); boards.add(puzzle.boardSignature);
      puzzle.cards.forEach(({ id }) => increment(speciesExposure, id));
      for (const group of puzzle.groups) {
        const ids = group.members.map(({ id }) => id);
        assert(group.memberSignature === canonicalMemberSignature(ids), `Infinite member signature mismatch: ${puzzle.poolIndex}`);
        assert(group.signature === canonicalGroupSignature(group.predicateSignature, ids), `Infinite exact signature mismatch: ${puzzle.poolIndex}`);
        assert(!exactGroups.has(group.signature) && !memberGroups.has(group.memberSignature), `Duplicate Infinite group: ${puzzle.poolIndex}`);
        assert(!daily.exactGroups.has(group.signature) && !daily.memberGroups.has(group.memberSignature), `Infinite group collides with Daily: ${puzzle.poolIndex}`);
        assert(group.label && group.hint && group.explanation, `Infinite group copy missing: ${puzzle.poolIndex}`);
        const family = ruleEvidence.byPredicateSignature.get(group.predicateSignature)?.ruleId;
        assert(familyExposure.has(family), `Infinite intended group uses unadvertised family ${family}: ${puzzle.poolIndex}`);
        increment(familyExposure, family);
        increment(predicateExposure, group.predicateSignature);
        groupPairs(ids).forEach((key) => increment(pairExposure, key));
        exactGroups.add(group.signature); memberGroups.add(group.memberSignature);
      }
      const solved = verifyPuzzleSemantics(puzzle, {
        model,
        ruleEvidence,
        context: `Infinite ${puzzle.poolIndex}`,
        verifyCompletePartition: resolveSolverProof,
      });
      if (resolveSolverProof) {
        assert(solved.partitionSignature === puzzle.solver.partitionSignature, `Infinite partition mismatch: ${puzzle.poolIndex}`);
      }
      puzzleCount += 1;
    }
    assert(shardNumber === Math.floor(entry.start / index.shardSize), `Unexpected Infinite shard order: ${entry.file}`);
  }
  assert(puzzleCount === index.poolSize, `Expected ${index.poolSize} Infinite puzzles, found ${puzzleCount}`);
  const object = (map) => Object.fromEntries([...map].sort(([left], [right]) => String(left).localeCompare(String(right), "en", { numeric: true })));
  const coveredAdvertisedFamilies = ADVERTISED_INFINITE_RULE_FAMILIES.filter((family) => (familyExposure.get(family) ?? 0) > 0);
  const freshSummary = {
    coveredAdvertisedFamilies,
    advertisedFamilyCoverage: coveredAdvertisedFamilies.length,
    maximumFamilyGroups: Math.max(...familyExposure.values()),
    maximumFamilyShare: Math.max(...familyExposure.values()) / (puzzleCount * 4),
    speciesCoverage: speciesExposure.size,
    totalSpecies: model.facts.pokemon.length,
    maximumBoardsPerSpecies: Math.max(...speciesExposure.values()),
    distinctPairs: pairExposure.size,
    maximumBoardsPerPair: Math.max(...pairExposure.values()),
  };
  assert(canonicalJson(report.familyExposure) === canonicalJson(object(familyExposure)), "Infinite family exposure report mismatch");
  assert(canonicalJson(report.predicateExposure) === canonicalJson(object(predicateExposure)), "Infinite predicate exposure report mismatch");
  assert(canonicalJson(report.speciesExposure) === canonicalJson(object(speciesExposure)), "Infinite species exposure report mismatch");
  assert(canonicalJson(report.pairExposure) === canonicalJson(object(pairExposure)), "Infinite pair exposure report mismatch");
  assert(canonicalJson(report.generationAudit) === canonicalJson(index.generationAudit), "Infinite generation audit/report mismatch");
  assert(canonicalJson(report.summary) === canonicalJson(freshSummary), "Infinite diversity report summary/fresh recomputation mismatch");
  assert(canonicalJson(index.diversity.summary) === canonicalJson(freshSummary), "Infinite diversity index summary/fresh recomputation mismatch");
  assert(freshSummary.advertisedFamilyCoverage === ADVERTISED_INFINITE_RULE_FAMILIES.length, "Infinite does not cover every advertised family");
  assert(freshSummary.maximumFamilyShare <= INFINITE_DIVERSITY_POLICY.maximumFamilyShare, "Infinite family share exceeds diversity policy");
  assert(freshSummary.speciesCoverage >= INFINITE_DIVERSITY_POLICY.minimumSpeciesCoverage, "Infinite species coverage is below diversity policy");
  assert(freshSummary.maximumBoardsPerSpecies <= INFINITE_DIVERSITY_POLICY.maximumBoardsPerSpecies, "Infinite species exposure exceeds diversity policy");
  assert(freshSummary.maximumBoardsPerPair <= INFINITE_DIVERSITY_POLICY.maximumBoardsPerPair, "Infinite pair exposure exceeds diversity policy");
  return {
    poolSize: puzzleCount,
    shards: index.shards.length,
    distinctBoards: boards.size,
    distinctExactGroups: exactGroups.size,
    distinctMemberGroups: memberGroups.size,
    dailyBoardsExcluded: daily.boards.size,
    noRepeatSequenceRounds: new Set(sequence).size,
    first500SequenceUnique: new Set(sequence.slice(0, 500)).size,
    solverProofsRecomputed: resolveSolverProof ? puzzleCount : 0,
    diversity: freshSummary,
    familyExposure: report.familyExposure,
    generationAudit: report.generationAudit,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await validateInfinitePool(), null, 2));
