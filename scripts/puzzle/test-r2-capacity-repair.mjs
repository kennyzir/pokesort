import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadCategoryModel } from "./category-model.mjs";
import { buildRuleUniverse } from "./rule-universe.mjs";
import { enumerateInducedQuartets, solveBoard } from "./solver.mjs";

const choose4 = (count) => count < 4 ? 0 : count * (count - 1) * (count - 2) * (count - 3) / 24;
const model = await loadCategoryModel();
const universe = buildRuleUniverse(model);
const added = universe.filter(({ ruleId }) => ruleId === "monotype");
assert.equal(added.length, 1, "capacity repair must remain a single narrow predicate");
assert.equal(added[0].signature, 'monotype:{"type":"bug"}');
assert.equal(added[0].memberIds.length, 23);
assert.equal(choose4(added[0].memberIds.length), 8_855);
const baseUniverse = universe.filter(({ ruleId }) => ruleId !== "monotype");
assert.equal(baseUniverse.filter(({ memberIds }) => choose4(memberIds.length) >= 25).length, 59);
assert.equal(universe.filter(({ memberIds }) => choose4(memberIds.length) >= 25).length, 60);

let elapsedBoardsWithAddedQuartets = 0;
let elapsedBoardsWithChangedPartitions = 0;
let elapsedIntendedGroupsWithChangedEvidence = 0;
for (let date = new Date("2026-07-25T00:00:00.000Z"); date <= new Date("2026-08-24T00:00:00.000Z"); date.setUTCDate(date.getUTCDate() + 1)) {
  const dateKey = date.toISOString().slice(0, 10);
  const manifest = JSON.parse(await readFile(new URL(`../../data/puzzles/daily/${dateKey}.json`, import.meta.url), "utf8"));
  const ids = manifest.cards.map(({ id }) => id);
  const before = enumerateInducedQuartets(ids, baseUniverse);
  const after = enumerateInducedQuartets(ids, universe);
  if (after.length !== before.length) elapsedBoardsWithAddedQuartets += 1;
  const matchingBefore = new Map(before.map((quartet) => [quartet.mask, quartet.matchingRules.map(({ signature }) => signature).join("|")]));
  const intended = new Set(manifest.groups.map(({ memberSignature }) => memberSignature));
  elapsedIntendedGroupsWithChangedEvidence += after.filter((quartet) => (
    intended.has([...quartet.memberIds].sort((left, right) => left - right).join("-"))
    && quartet.matchingRules.map(({ signature }) => signature).join("|") !== matchingBefore.get(quartet.mask)
  )).length;
  const solvedBefore = solveBoard(ids, baseUniverse, { maxPartitions: 2, retainPartitions: 2 });
  const solvedAfter = solveBoard(ids, universe, { maxPartitions: 2, retainPartitions: 2 });
  if (JSON.stringify(solvedAfter.partitions) !== JSON.stringify(solvedBefore.partitions)) elapsedBoardsWithChangedPartitions += 1;
}
assert.equal(elapsedBoardsWithAddedQuartets, 0);
assert.equal(elapsedBoardsWithChangedPartitions, 0);
assert.equal(elapsedIntendedGroupsWithChangedEvidence, 0);
console.log(JSON.stringify({ gate: "PASS", beforeYearEligiblePredicates: 59, afterYearEligiblePredicates: 60, addedPredicate: added[0].signature, qualifyingSpecies: 23, distinctQuartets: 8855, elapsedBoardsChecked: 31, elapsedBoardsWithAddedQuartets, elapsedBoardsWithChangedPartitions, elapsedIntendedGroupsWithChangedEvidence }, null, 2));
