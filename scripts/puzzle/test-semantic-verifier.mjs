import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCategoryModel } from "./category-model.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { verifyInfiniteShardStructure } from "./validate-infinite-pool.mjs";

const clone = (value) => structuredClone(value);
const model = await loadCategoryModel();
const ruleEvidence = buildCanonicalRuleEvidence(model);
const daily = JSON.parse(await readFile(resolve("data/puzzles/daily/2026-08-24.json"), "utf8"));
const infiniteIndex = JSON.parse(await readFile(resolve("data/puzzles/infinite/index.json"), "utf8"));
const infiniteShard = JSON.parse(await readFile(resolve("data/puzzles/infinite/shard-000.json"), "utf8"));

verifyPuzzleSemantics(daily, { model, ruleEvidence, context: "clean fixture" });

async function mutation(name, pattern, mutate) {
  const puzzle = clone(daily);
  mutate(puzzle);
  await assert.rejects(async () => verifyPuzzleSemantics(puzzle, { model, ruleEvidence, context: name }), pattern, name);
}

await mutation("fabricated predicate", /UNKNOWN_PREDICATE/, (puzzle) => { puzzle.groups[0].predicateSignature = "fabricated:{}"; });
await mutation("swapped label", /LABEL_MISMATCH/, (puzzle) => { puzzle.groups[0].label = puzzle.groups[1].label; });
await mutation("false hint", /HINT_MISMATCH/, (puzzle) => { puzzle.groups[0].hint = "Trust this fabricated hint."; });
await mutation("false explanation", /EXPLANATION_MISMATCH/, (puzzle) => { puzzle.groups[0].explanation = "Fabricated explanation."; });
await mutation("false provenance", /PROVENANCE_MISMATCH/, (puzzle) => { puzzle.groups[0].provenance.provider = "Unpinned source"; });
await mutation("false source type", /PROVENANCE_MISMATCH/, (puzzle) => { puzzle.groups[0].provenance.factField = "community-guess"; });
await mutation("boundary drift", /PROVENANCE_MISMATCH/, (puzzle) => { puzzle.groups[0].provenance.boundary.typing = "Alternate forms inferred."; });
await mutation("member tampering", /(?:MEMBER_|GROUP_MEMBER_)/, (puzzle) => {
  puzzle.groups[0].memberIds[0] = puzzle.groups[1].memberIds[0];
  puzzle.groups[0].members[0] = clone(puzzle.groups[1].members[0]);
});
await mutation("stale matching evidence", /MATCHING_RULE_EVIDENCE_MISMATCH/, (puzzle) => { puzzle.groups[0].matchingRuleEvidence = []; });
await mutation("duplicate card IDs", /DUPLICATE_CARD_ID/, (puzzle) => { puzzle.cards[0].id = puzzle.cards[1].id; });
await mutation("legacy model using v2-only rule", /LEGACY_MODEL_RULE_MISMATCH/, (puzzle) => {
  puzzle.categoryModelId = "pokesort-source-backed-categories-v1";
  puzzle.groups[0].predicateSignature = 'monotype:{"type":"bug"}';
});

const staleIndexHash = clone(infiniteIndex);
staleIndexHash.poolSize += 1;
assert.throws(() => verifyCanonicalHash(staleIndexHash, { label: "mutated Infinite index" }), /CONTENT_HASH_MISMATCH/);

const malformedShard = clone(infiniteShard);
malformedShard.puzzles = { fabricated: true };
assert.throws(() => verifyInfiniteShardStructure(malformedShard, infiniteIndex.shards[0]), /Malformed shard puzzle content/);

console.log(JSON.stringify({
  canonicalPredicates: ruleEvidence.byPredicateSignature.size,
  cleanPuzzleAccepted: true,
  semanticMutationsRejected: 11,
  staleIndexHashRejected: true,
  malformedShardRejected: true,
}, null, 2));
console.log("R1 canonical semantic mutation Gate passed.");
