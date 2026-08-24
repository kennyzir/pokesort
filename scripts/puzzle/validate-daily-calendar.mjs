import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { categoryModelAccepts, loadCategoryModel } from "./category-model.mjs";
import { GENERATOR_VERSION } from "./generator.mjs";
import { buildCanonicalRuleEvidence, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";
import { assessBoardQuality, DAILY_BOARD_QUALITY_POLICY, summarizeQuality } from "./board-quality-policy.mjs";
import {
  CALENDAR_GENERATOR_VERSION,
  CALENDAR_SCHEMA_VERSION,
  DEFAULT_DAY_COUNT,
  DEFAULT_START_DATE,
  REQUIRED_PREDICATE_COOLDOWN_DAYS,
} from "./build-daily-calendar.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultCalendarDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseUtcDate(value) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `Invalid UTC date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  assert(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value, `Invalid UTC date: ${value}`);
  return date;
}

function addUtcDays(value, days) {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function partitionSignature(partition) {
  return partition.map(({ memberSignature }) => memberSignature).sort().join("|");
}

function verifyManifestHash(manifest) {
  const { puzzleId, contentHash, ...base } = manifest;
  assert(sha256(base) === contentHash, `Manifest content hash mismatch: ${manifest.date}`);
  assert(puzzleId === `daily-${manifest.date}-${contentHash.slice(0, 16)}`, `Puzzle ID/hash mismatch: ${manifest.date}`);
  const board = {
    schemaVersion: manifest.puzzleSchemaVersion,
    generatorVersion: manifest.generatorVersion,
    factsSchemaVersion: manifest.factsSchemaVersion,
    datasetId: manifest.datasetId,
    categoryModelId: manifest.categoryModelId,
    ...(manifest.sourceSeed === null || manifest.sourceSeed === undefined ? {} : { seed: manifest.sourceSeed }),
    boardSignature: manifest.boardSignature,
    cards: manifest.cards,
    groups: manifest.groups,
    solver: manifest.solver,
    difficulty: manifest.difficulty,
    generationAudit: { acceptedOnAttempt: manifest.generationAudit.acceptedOnAttempt },
  };
  assert(sha256(board) === manifest.boardContentHash, `Board content hash mismatch: ${manifest.date}`);
}

function verifyIndexHash(index) {
  const { contentHash, ...base } = index;
  assert(sha256(base) === contentHash, "Calendar index content hash mismatch");
}

export async function validateDailyCalendar({
  calendarDirectory = defaultCalendarDirectory,
  expectedStartDate = DEFAULT_START_DATE,
  expectedDayCount = DEFAULT_DAY_COUNT,
  asOfDate = new Date().toISOString().slice(0, 10),
  resolveSolverProof = true,
} = {}) {
  parseUtcDate(asOfDate);
  const names = (await readdir(calendarDirectory)).filter((name) => name.endsWith(".json")).sort();
  assert(names.includes("index.json"), "Calendar index.json is missing");
  const manifestNames = names.filter((name) => name !== "index.json");
  assert(manifestNames.length === expectedDayCount, `Expected ${expectedDayCount} manifest files, found ${manifestNames.length}`);
  const index = JSON.parse(await readFile(resolve(calendarDirectory, "index.json"), "utf8"));
  verifyIndexHash(index);
  assert(index.calendarSchemaVersion === CALENDAR_SCHEMA_VERSION, "Unexpected calendar schema version");
  assert(index.calendarGeneratorVersion === CALENDAR_GENERATOR_VERSION, "Unexpected calendar generator version");
  assert(index.generatorVersion === GENERATOR_VERSION, "Unexpected puzzle generator version");
  assert(index.range.startDate === expectedStartDate, "Unexpected calendar start date");
  assert(index.range.dayCount === expectedDayCount, "Unexpected calendar day count");
  assert(index.range.endDate === addUtcDays(expectedStartDate, expectedDayCount - 1), "Calendar end date is not contiguous");
  assert(index.entries.length === expectedDayCount, "Calendar index entry count mismatch");
  assert(index.publicationPolicy.timezone === "UTC", "Publication timezone must be UTC");
  assert(index.publicationPolicy.futureStorageIsPublication === false, "Future storage must not be treated as publication");
  assert(index.cooldownPolicy.achievedPredicateCooldownDays >= REQUIRED_PREDICATE_COOLDOWN_DAYS, "Required predicate cooldown was not achieved");
  const qualityEnabled = Boolean(index.qualityPolicy);
  if (qualityEnabled) assert(canonicalJson(index.qualityPolicy) === canonicalJson(DAILY_BOARD_QUALITY_POLICY), "Unexpected Daily quality policy");

  const model = await loadCategoryModel();
  const ruleEvidence = buildCanonicalRuleEvidence(model);
  assert(index.factsSchemaVersion === model.facts.schemaVersion, "Calendar index facts schema does not match pinned facts");
  assert(index.datasetId === model.facts.datasetId, "Calendar index dataset does not match pinned facts");
  assert(categoryModelAccepts(model.rules, index.categoryModelId), "Calendar index category model does not match pinned rules");
  const boardSignatures = new Set();
  const exactGroupSignatures = new Set();
  const memberGroupSignatures = new Set();
  const puzzleIds = new Set();
  const recentPredicates = [];
  let previousSpecies = new Set();
  let publishableCount = 0;
  let futureStoredCount = 0;
  const qualityAssessments = [];

  for (let dayIndex = 0; dayIndex < expectedDayCount; dayIndex += 1) {
    const date = addUtcDays(expectedStartDate, dayIndex);
    const expectedName = `${date}.json`;
    assert(manifestNames[dayIndex] === expectedName, `Calendar gap or unexpected file at ${date}: ${manifestNames[dayIndex] ?? "missing"}`);
    const manifest = JSON.parse(await readFile(resolve(calendarDirectory, expectedName), "utf8"));
    verifyManifestHash(manifest);
    assert(manifest.date === date, `Manifest date mismatch in ${expectedName}`);
    assert(manifest.publishAtUtc === `${date}T00:00:00.000Z`, `UTC publication time mismatch: ${date}`);
    assert(manifest.calendarSchemaVersion === CALENDAR_SCHEMA_VERSION, `Schema mismatch: ${date}`);
    assert(manifest.calendarGeneratorVersion === CALENDAR_GENERATOR_VERSION, `Calendar generator mismatch: ${date}`);
    assert(manifest.datasetId === index.datasetId && manifest.categoryModelId === index.categoryModelId, `Dataset/model mismatch: ${date}`);
    assert(!("generatedAt" in manifest) && !("updatedAt" in manifest), `Synthetic freshness field is forbidden: ${date}`);
    assert(manifest.cards.length === 16 && new Set(manifest.cards.map(({ id }) => id)).size === 16, `Card cardinality failure: ${date}`);
    assert(manifest.groups.length === 4 && manifest.groups.every(({ members }) => members.length === 4), `Group cardinality failure: ${date}`);
    assert(manifest.solver.solutionCount === 1 && manifest.solver.countComplete === true, `Stored solver proof failure: ${date}`);
    assert(manifest.groups.every(({ hint, explanation, provenance, members }) => hint && explanation && provenance?.datasetId && members.every(({ provenanceRefs }) => provenanceRefs?.length)), `Hint/explanation/provenance failure: ${date}`);
    assert(!puzzleIds.has(manifest.puzzleId), `Duplicate puzzle ID: ${date}`);
    assert(!boardSignatures.has(manifest.boardSignature), `Duplicate board signature: ${date}`);
    puzzleIds.add(manifest.puzzleId);
    boardSignatures.add(manifest.boardSignature);
    for (const group of manifest.groups) {
      assert(!exactGroupSignatures.has(group.signature), `Duplicate exact group signature: ${date} ${group.signature}`);
      assert(!memberGroupSignatures.has(group.memberSignature), `Duplicate member group signature: ${date} ${group.memberSignature}`);
      exactGroupSignatures.add(group.signature);
      memberGroupSignatures.add(group.memberSignature);
    }
    const species = new Set(manifest.cards.map(({ id }) => id));
    assert(![...species].some((id) => previousSpecies.has(id)), `Species repeats on consecutive dates: ${date}`);
    previousSpecies = species;
    const predicates = manifest.groups.map(({ predicateSignature }) => predicateSignature);
    const forbiddenPredicates = new Set(recentPredicates.flat());
    assert(!predicates.some((signature) => forbiddenPredicates.has(signature)), `Predicate cooldown failure: ${date}`);
    recentPredicates.push(predicates);
    const retainedCooldownBoards = qualityEnabled ? REQUIRED_PREDICATE_COOLDOWN_DAYS : REQUIRED_PREDICATE_COOLDOWN_DAYS - 1;
    if (recentPredicates.length > retainedCooldownBoards) recentPredicates.shift();

    const solved = verifyPuzzleSemantics(manifest, {
      model,
      ruleEvidence,
      context: `Daily ${date}`,
      verifyCompletePartition: resolveSolverProof,
    });
    if (resolveSolverProof) {
      assert(solved.partitionSignature === manifest.solver.partitionSignature, `Solver partition mismatch: ${date}`);
    }
    if (qualityEnabled) {
      assert(manifest.quality?.accepted === true, `Quality Gate not accepted: ${date}`);
      const assessment = assessBoardQuality({
        puzzle: manifest,
        ruleUniverse: ruleEvidence.universe,
        policy: index.qualityPolicy,
        expectedDifficultyBand: manifest.quality.expectedDifficultyBand,
      });
      assert(canonicalJson(assessment) === canonicalJson(manifest.quality), `Stored quality evidence mismatch: ${date}`);
      assert(assessment.accepted, `Quality Gate failure: ${date} ${assessment.rejectionReasons.join(",")}`);
      qualityAssessments.push(assessment);
    }
    const indexed = index.entries[dayIndex];
    assert(
      indexed.date === date
      && indexed.file === expectedName
      && indexed.puzzleId === manifest.puzzleId
      && indexed.contentHash === manifest.contentHash
      && indexed.boardContentHash === manifest.boardContentHash
      && indexed.boardSignature === manifest.boardSignature
      && indexed.publishAtUtc === manifest.publishAtUtc,
      `Index/manifest mismatch: ${date}`,
    );
    if (date <= asOfDate) publishableCount += 1;
    else futureStoredCount += 1;
  }

  if (qualityEnabled) {
    const recomputed = summarizeQuality(qualityAssessments, index.generationAudit.qualityRejections, index.qualityPolicy);
    assert(canonicalJson(recomputed) === canonicalJson(index.qualityReport), "Calendar quality report mismatch");
    assert(recomputed.calibratedCoverage >= index.qualityPolicy.calibratedCoverageMinimum, "Calendar calibrated quality coverage failed");
    assert(recomputed.difficultyDistributionPass, "Calendar difficulty-band distribution failed");
  }

  return {
    calendarDirectory,
    dates: expectedDayCount,
    range: index.range,
    distinctPuzzleIds: puzzleIds.size,
    distinctBoards: boardSignatures.size,
    distinctExactGroups: exactGroupSignatures.size,
    distinctMemberGroups: memberGroupSignatures.size,
    predicateCooldownDays: index.cooldownPolicy.achievedPredicateCooldownDays,
    consecutiveSpeciesRepeats: 0,
    solverProofsRecomputed: resolveSolverProof ? expectedDayCount : 0,
    publicationAsOfUtcDate: asOfDate,
    publishableCount,
    futureStoredCount,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--calendar-dir") options.calendarDirectory = resolve(argv[++index]);
    else if (value === "--start-date") options.expectedStartDate = argv[++index];
    else if (value === "--days") options.expectedDayCount = Number(argv[++index]);
    else if (value === "--as-of-date") options.asOfDate = argv[++index];
    else if (value === "--skip-solver") options.resolveSolverProof = false;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await validateDailyCalendar(parseArguments(process.argv.slice(2))), null, 2));
}
