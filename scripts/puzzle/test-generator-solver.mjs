import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { loadCategoryModel } from "./category-model.mjs";
import { evaluateCandidateBoard, generateBatch, generatePuzzle, PuzzleGenerationError, serializeGenerated } from "./generator.mjs";
import { buildRuleUniverse, canonicalRuleInstanceSignature } from "./rule-universe.mjs";
import { enumerateInducedQuartets, solveBoard } from "./solver.mjs";

const model = await loadCategoryModel();
const universe = buildRuleUniverse(model);

assert.equal(universe.length, 101);
assert.equal(new Set(universe.map(({ signature }) => signature)).size, universe.length);
assert.equal(
  canonicalRuleInstanceSignature("dual_type", { typeA: "water", typeB: "fire" }),
  canonicalRuleInstanceSignature("dual_type", { typeA: "fire", typeB: "water" }),
);

const first = await generatePuzzle({ seed: "qb2-byte-stability", model, ruleUniverse: universe });
const second = await generatePuzzle({ seed: "qb2-byte-stability", model, ruleUniverse: universe });
assert.equal(serializeGenerated(first), serializeGenerated(second), "same seed and versions must be byte-stable");
assert.equal(first.puzzle.cards.length, 16);
assert.equal(new Set(first.puzzle.cards.map(({ id }) => id)).size, 16);
assert.equal(first.puzzle.groups.length, 4);
assert.ok(first.puzzle.groups.every((group) => group.members.length === 4));
assert.equal(first.puzzle.solver.solutionCount, 1);
assert.equal(first.puzzle.solver.countComplete, true);
for (const group of first.puzzle.groups) {
  assert.ok(group.label && group.hint && group.explanation);
  assert.ok(group.provenance.datasetId && group.provenance.sourceCommit && group.provenance.factField);
  assert.ok(group.members.every((member) => member.provenanceRefs.length > 0));
  assert.ok(group.matchingRuleEvidence.length >= 1);
  assert.ok(group.matchingRuleEvidence.every((evidence) => evidence.label && evidence.hint && evidence.explanation && evidence.provenance.datasetId));
}

function fixtureInstance(signature, memberIds) {
  return {
    signature,
    ruleId: "fixture",
    parameters: { signature },
    memberIds,
    memberIdSet: new Set(memberIds),
    label: signature,
    hint: `Hint ${signature}`,
    explanation: `Explanation ${signature}`,
    provenance: { datasetId: "fixture", provider: "fixture", sourceCommit: "fixture", factField: "fixture", sourceFiles: ["fixture"], boundary: {} },
  };
}

const rows = [
  [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16],
  [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [4, 8, 12, 16],
].map((ids, index) => fixtureInstance(`fixture:${index}`, ids));
const ambiguous = solveBoard(Array.from({ length: 16 }, (_, index) => index + 1), rows);
assert.equal(ambiguous.solutionCount, 2, "ambiguous fixture must have two exact member partitions");
assert.equal(ambiguous.countComplete, true);
const ambiguousEvaluation = evaluateCandidateBoard({
  model,
  ruleUniverse: rows,
  boardIds: Array.from({ length: 16 }, (_, index) => index + 1),
  intendedGroups: rows.slice(0, 4).map(({ memberIds }) => ({ memberIds })),
});
assert.equal(ambiguousEvaluation.status, "ambiguous", "an intentionally ambiguous candidate must be rejected before publication");

const onePartitionWithOverlappingLabels = [
  fixtureInstance("specific:first", [1, 2, 3, 4]),
  fixtureInstance("alternate:first", [1, 2, 3, 4, 17]),
  ...rows.slice(1, 4),
];
const overlapSolved = solveBoard(Array.from({ length: 16 }, (_, index) => index + 1), onePartitionWithOverlappingLabels);
assert.equal(overlapSolved.solutionCount, 1, "two valid labels for one quartet must remain one member partition");
assert.equal(overlapSolved.partitions[0][0].matchingRules.length, 2, "both labels must be retained as overlap evidence");
assert.equal(overlapSolved.partitions[0][0].matchingRules[0].signature, "specific:first", "the globally narrower label must be selected deterministically");
const overlapReversed = solveBoard(Array.from({ length: 16 }, (_, index) => index + 1), [...onePartitionWithOverlappingLabels].reverse());
assert.deepEqual(overlapReversed, overlapSolved, "rule-universe input order must not change overlap evidence or intended-label ordering");

const broadUniverse = [fixtureInstance("broad", [1, 2, 3, 4, 5])];
assert.equal(enumerateInducedQuartets(Array.from({ length: 16 }, (_, index) => index + 1), broadUniverse).length, 5, "a broad rule must induce every qualifying four-subset");

const batchStarted = performance.now();
const batch = await generateBatch({ seed: "qb2-focused-batch", count: 20, maxAttempts: 20_000, model, ruleUniverse: universe });
const batchMs = performance.now() - batchStarted;
assert.equal(batch.puzzles.length, 20);
assert.equal(new Set(batch.puzzles.map(({ boardSignature }) => boardSignature)).size, 20);
const allExactGroupSignatures = batch.puzzles.flatMap((puzzle) => puzzle.groups.map(({ signature }) => signature));
const allMemberGroupSignatures = batch.puzzles.flatMap((puzzle) => puzzle.groups.map(({ memberSignature }) => memberSignature));
assert.equal(new Set(allExactGroupSignatures).size, 80);
assert.equal(new Set(allMemberGroupSignatures).size, 80);
assert.ok(batch.puzzles.every((puzzle) => puzzle.solver.solutionCount === 1 && puzzle.groups.length === 4));

await assert.rejects(
  generatePuzzle({ seed: "qb2-bounded-failure", maxAttempts: 1, model, ruleUniverse: [] }),
  (error) => error instanceof PuzzleGenerationError
    && error.code === "GENERATION_EXHAUSTED"
    && error.audit.attempted === 1
    && error.audit.exhausted === 1,
);

console.log(JSON.stringify({
  ruleInstances: universe.length,
  stablePuzzleId: first.puzzle.puzzleId,
  batch: { requested: 20, ...batch.audit, milliseconds: Number(batchMs.toFixed(2)) },
  ambiguousFixturePartitions: ambiguous.solutionCount,
  broadFiveCardRuleQuartets: 5,
}, null, 2));
console.log("QB2 generator and uniqueness solver passed focused validation.");
