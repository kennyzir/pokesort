import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { preparePrivateDailyBuffer } from "./prepare-private-daily-buffer.mjs";

const infiniteDirectory = resolve("data/puzzles/infinite");
const infiniteIndex = JSON.parse(await readFile(resolve(infiniteDirectory, "index.json"), "utf8"));
const infiniteBoards = new Set();
const infiniteExactGroups = new Set();
const infiniteMemberGroups = new Set();
for (const entry of infiniteIndex.shards) {
  const shard = JSON.parse(await readFile(resolve(infiniteDirectory, entry.file), "utf8"));
  for (const puzzle of shard.puzzles) {
    infiniteBoards.add(puzzle.boardSignature);
    for (const group of puzzle.groups) {
      infiniteExactGroups.add(group.signature);
      infiniteMemberGroups.add(group.memberSignature);
    }
  }
}

const options = {
  asOfDate: "2026-08-24",
  readyDays: 365,
  attemptsPerRuleSet: 500,
  // This TEST-only input deterministically exhausts earlier derivations under
  // reciprocal exclusion and succeeds on attempt 5, proving that capacity
  // exhaustion advances the bounded derivation loop instead of aborting it.
  privateSeed: "r2-calibration-private-test-input-never-production-365-days",
  write: false,
};
const started = performance.now();
const first = await preparePrivateDailyBuffer(options);
const second = await preparePrivateDailyBuffer(options);
const milliseconds = performance.now() - started;

assert.equal(first.receipt.contentHash, second.receipt.contentHash, "same TEST input must produce the same reciprocal-exclusion receipt");
assert.equal(first.receipt.contentHash, "985a8749167328084e2fa7f89fbbf73ccf1b7f7455f54ba0ec51dbc811acca02", "365-day reciprocal-exclusion receipt changed");
assert.equal(first.receipt.generationDerivation.attempt, 5, "capacity exhaustion must retry through the deterministic bounded derivation loop");
assert.deepEqual(first.receipt.infiniteExclusion, {
  indexContentHash: infiniteIndex.contentHash,
  puzzleCount: 1_000,
  boardSignatureCount: 1_000,
  exactGroupSignatureCount: 4_000,
  memberGroupSignatureCount: 4_000,
});
assert.equal(first.generated.manifests.length, 365);
assert(first.receipt.generationDerivation.attempt < first.receipt.generationDerivation.maximumAttempts);
assert.equal(first.receipt.qualityReport.acceptedBoards, 365);
assert(first.receipt.qualityReport.calibratedCoverage >= 0.9);
assert(first.receipt.qualityReport.difficultyDistributionPass);
assert.equal(first.receipt.qualityReport.difficultyBands.extreme, 0);
assert(first.receipt.qualityReport.validQuartetDistribution.minimum >= 12);
assert(first.receipt.qualityReport.validQuartetDistribution.maximum <= 100);
assert(first.receipt.qualityReport.threeCardUnintendedDistribution.maximum <= 30);
assert(first.receipt.generationAudit.candidateAttempts <= 365 * 2_000 * 500, "accepted derivation exceeded its explicit candidate bound");

let boardCollisions = 0;
let exactGroupCollisions = 0;
let memberGroupCollisions = 0;
for (const manifest of first.generated.manifests) {
  if (infiniteBoards.has(manifest.boardSignature)) boardCollisions += 1;
  for (const group of manifest.groups) {
    if (infiniteExactGroups.has(group.signature)) exactGroupCollisions += 1;
    if (infiniteMemberGroups.has(group.memberSignature)) memberGroupCollisions += 1;
  }
}
assert.equal(boardCollisions, 0);
assert.equal(exactGroupCollisions, 0);
assert.equal(memberGroupCollisions, 0);
assert(milliseconds < 120_000, `two deterministic 365-day reciprocal-exclusion generations exceeded the 120s bound: ${milliseconds.toFixed(0)}ms`);

console.log(JSON.stringify({
  gate: "PASS",
  days: 365,
  receiptHash: first.receipt.contentHash,
  derivation: first.receipt.generationDerivation,
  milliseconds: Number(milliseconds.toFixed(2)),
  infiniteExclusion: first.receipt.infiniteExclusion,
  collisions: { boards: boardCollisions, exactGroups: exactGroupCollisions, memberGroups: memberGroupCollisions },
  qualityReport: first.receipt.qualityReport,
  candidateAttempts: first.receipt.generationAudit.candidateAttempts,
}, null, 2));
