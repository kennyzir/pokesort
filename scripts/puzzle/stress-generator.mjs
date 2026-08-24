import { performance } from "node:perf_hooks";
import { loadCategoryModel } from "./category-model.mjs";
import { generateBatch } from "./generator.mjs";
import { buildRuleUniverse } from "./rule-universe.mjs";

const count = Number(process.argv[2] ?? 100);
const maxAttempts = Number(process.argv[3] ?? count * 2_000);
if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error("Usage: node scripts/puzzle/stress-generator.mjs [positive count] [positive maxAttempts]");
}

const model = await loadCategoryModel();
const universe = buildRuleUniverse(model);
const started = performance.now();
const batch = await generateBatch({ seed: `qb2-stress-${count}`, count, maxAttempts, model, ruleUniverse: universe });
const milliseconds = performance.now() - started;
const boardSignatures = batch.puzzles.map(({ boardSignature }) => boardSignature);
const groupSignatures = batch.puzzles.flatMap((puzzle) => puzzle.groups.map(({ signature }) => signature));

console.log(JSON.stringify({
  requested: count,
  produced: batch.puzzles.length,
  ruleInstances: universe.length,
  uniqueBoardSignatures: new Set(boardSignatures).size,
  uniqueExactGroupSignatures: new Set(groupSignatures).size,
  audit: batch.audit,
  timing: {
    milliseconds: Number(milliseconds.toFixed(2)),
    attemptsPerSecond: Number((batch.audit.attempted / (milliseconds / 1_000)).toFixed(2)),
    acceptedPerSecond: Number((batch.audit.accepted / (milliseconds / 1_000)).toFixed(2)),
  },
}, null, 2));
