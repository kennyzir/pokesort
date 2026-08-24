import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCategoryModel } from "./category-model.mjs";
import { runProductionDataGate } from "./production-data-gate.mjs";
import { buildCanonicalRuleEvidence, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { sha256 } from "./stable.mjs";
import { validateDailyCalendar } from "./validate-daily-calendar.mjs";
import { validateInfinitePool } from "./validate-infinite-pool.mjs";

const clone = (value) => structuredClone(value);
const rehash = (value) => {
  delete value.contentHash;
  value.contentHash = sha256(value);
  return value;
};
const model = await loadCategoryModel();
const ruleEvidence = buildCanonicalRuleEvidence(model);
const infiniteIndex = JSON.parse(await readFile(resolve("data/puzzles/infinite/index.json"), "utf8"));
const infiniteShard = JSON.parse(await readFile(resolve("data/puzzles/infinite/shard-000.json"), "utf8"));
const cleanPuzzle = infiniteShard.puzzles[0];

function semanticMutation(name, pattern, mutate) {
  const puzzle = clone(cleanPuzzle);
  mutate(puzzle);
  assert.throws(
    () => verifyPuzzleSemantics(puzzle, { model, ruleEvidence, context: name, verifyCompletePartition: false }),
    pattern,
    name,
  );
}

semanticMutation("deleted card identifier", /MEMBER_IDENTITY_SHAPE_MISMATCH/, (puzzle) => { delete puzzle.cards[0].identifier; });
semanticMutation("deleted member provenanceRefs", /MEMBER_IDENTITY_SHAPE_MISMATCH/, (puzzle) => { delete puzzle.groups[0].members[0].provenanceRefs; });
semanticMutation("deleted memberIds", /GROUP_MEMBER_CARDINALITY/, (puzzle) => { delete puzzle.groups[0].memberIds; });
semanticMutation("fabricated dataset", /DATASET_ID_MISMATCH/, (puzzle) => { puzzle.datasetId = "fabricated-dataset"; });
semanticMutation("fabricated category model", /CATEGORY_MODEL_ID_MISMATCH/, (puzzle) => { puzzle.categoryModelId = "fabricated-model"; });
semanticMutation("fabricated facts schema", /FACTS_SCHEMA_MISMATCH/, (puzzle) => { puzzle.factsSchemaVersion += 1; });

const temporaryRoot = await mkdtemp(join(tmpdir(), "pokesort-r1-regressions-"));
assert(resolve(temporaryRoot).startsWith(resolve(tmpdir())), "Temporary R1 regression directory escaped OS temp");
try {
  const infiniteDirectory = join(temporaryRoot, "infinite");
  await mkdir(infiniteDirectory);
  await cp(resolve("data/puzzles/infinite/diversity-report.json"), join(infiniteDirectory, "diversity-report.json"));

  const duplicateIndex = clone(infiniteIndex);
  duplicateIndex.shards[1].file = duplicateIndex.shards[0].file;
  rehash(duplicateIndex);
  await writeFile(join(infiniteDirectory, "index.json"), `${JSON.stringify(duplicateIndex)}\n`);
  await assert.rejects(
    validateInfinitePool({ poolDirectory: infiniteDirectory, resolveSolverProof: false }),
    /Duplicate Infinite shard file/,
    "validator must reject duplicate shard names after a valid index rehash",
  );

  const chainIndex = clone(infiniteIndex);
  const chainShard = clone(infiniteShard);
  const chainPuzzle = chainShard.puzzles[0];
  chainPuzzle.groups[0].label = "Fabricated rehashed label";
  delete chainPuzzle.contentHash;
  delete chainPuzzle.puzzleId;
  chainPuzzle.contentHash = sha256(chainPuzzle);
  chainPuzzle.puzzleId = `infinite-${chainPuzzle.contentHash.slice(0, 20)}`;
  rehash(chainShard);
  chainIndex.shards[0].contentHash = chainShard.contentHash;
  rehash(chainIndex);
  await writeFile(join(infiniteDirectory, "index.json"), `${JSON.stringify(chainIndex)}\n`);
  await writeFile(join(infiniteDirectory, chainIndex.shards[0].file), `${JSON.stringify(chainShard)}\n`);
  await assert.rejects(
    validateInfinitePool({ poolDirectory: infiniteDirectory, resolveSolverProof: false }),
    /LABEL_MISMATCH/,
    "validator must reject semantic tampering after puzzle, shard, and index hashes are all recomputed",
  );

  const fakeModelIndex = clone(infiniteIndex);
  fakeModelIndex.datasetId = "fabricated-dataset";
  fakeModelIndex.categoryModelId = "fabricated-model";
  fakeModelIndex.factsSchemaVersion += 1;
  rehash(fakeModelIndex);
  await writeFile(join(infiniteDirectory, "index.json"), `${JSON.stringify(fakeModelIndex)}\n`);
  await assert.rejects(
    validateInfinitePool({ poolDirectory: infiniteDirectory, resolveSolverProof: false }),
    /facts schema does not match pinned facts/,
    "Infinite index identity must be pinned independently of its valid self-hash",
  );

  const forgedSummaryDirectory = join(temporaryRoot, "infinite-forged-summary");
  await cp(resolve("data/puzzles/infinite"), forgedSummaryDirectory, { recursive: true });
  const forgedReportPath = join(forgedSummaryDirectory, "diversity-report.json");
  const forgedIndexPath = join(forgedSummaryDirectory, "index.json");
  const forgedReport = JSON.parse(await readFile(forgedReportPath, "utf8"));
  const forgedSummary = {
    ...forgedReport.summary,
    maximumFamilyGroups: 1,
    maximumFamilyShare: 0.00025,
    maximumBoardsPerSpecies: 1,
    maximumBoardsPerPair: 1,
  };
  forgedReport.summary = forgedSummary;
  rehash(forgedReport);
  const forgedIndex = JSON.parse(await readFile(forgedIndexPath, "utf8"));
  forgedIndex.diversity.summary = forgedSummary;
  forgedIndex.diversity.contentHash = forgedReport.contentHash;
  rehash(forgedIndex);
  await writeFile(forgedReportPath, `${JSON.stringify(forgedReport)}\n`);
  await writeFile(forgedIndexPath, `${JSON.stringify(forgedIndex)}\n`);
  await assert.rejects(
    validateInfinitePool({ poolDirectory: forgedSummaryDirectory, resolveSolverProof: false }),
    /summary\/fresh recomputation mismatch/,
    "validator must reject forged passing summaries after report and index hashes are recomputed",
  );

  const dailyEntryDirectory = join(temporaryRoot, "daily-entry");
  await cp(resolve("data/puzzles/daily"), dailyEntryDirectory, { recursive: true });
  const dailyEntryIndexPath = join(dailyEntryDirectory, "index.json");
  const dailyEntryIndex = JSON.parse(await readFile(dailyEntryIndexPath, "utf8"));
  dailyEntryIndex.entries[0].boardSignature = "fabricated-board-signature";
  rehash(dailyEntryIndex);
  await writeFile(dailyEntryIndexPath, `${JSON.stringify(dailyEntryIndex)}\n`);
  await assert.rejects(
    validateDailyCalendar({ calendarDirectory: dailyEntryDirectory, resolveSolverProof: false }),
    /Index\/manifest mismatch/,
    "Daily validator must bind every index receipt field to its manifest",
  );

  const shortDailyDirectory = join(temporaryRoot, "daily-shortened");
  await cp(resolve("data/puzzles/daily"), shortDailyDirectory, { recursive: true });
  const shortIndexPath = join(shortDailyDirectory, "index.json");
  const shortIndex = JSON.parse(await readFile(shortIndexPath, "utf8"));
  shortIndex.range.dayCount = 1;
  shortIndex.range.endDate = shortIndex.range.startDate;
  shortIndex.entries = shortIndex.entries.slice(0, 1);
  rehash(shortIndex);
  await writeFile(shortIndexPath, `${JSON.stringify(shortIndex)}\n`);
  await assert.rejects(
    runProductionDataGate({ dailyDirectory: shortDailyDirectory, infiniteDirectory: resolve("data/puzzles/infinite") }),
    /Unexpected public Daily history schema|Unexpected calendar day count/,
    "production Gate must use trusted calendar expectations instead of a self-declared index range",
  );

  console.log(JSON.stringify({
    strictIdentityMutationsRejected: 3,
    pinnedModelMutationsRejected: 3,
    duplicateShardRejectedByFullValidator: true,
    rehashedPuzzleShardIndexChainRejected: true,
    rehashedDiversitySummaryChainRejected: true,
    dailyIndexReceiptBindingRejected: true,
    selfShortenedCalendarRejectedByProductionGate: true,
    semanticsStillCheckedWithoutPartitionSolve: true,
  }, null, 2));
  console.log("R1 semantic bypass regression fixtures passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
