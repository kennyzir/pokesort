import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assessBoardQuality, DAILY_BOARD_QUALITY_POLICY, difficultyBand, targetDifficultyBand } from "./board-quality-policy.mjs";
import { assertRollingPredicateCooldown, preparePrivateDailyBuffer, validatePrivateDailyBuffer } from "./prepare-private-daily-buffer.mjs";
import { loadCategoryModel } from "./category-model.mjs";
import { buildRuleUniverse } from "./rule-universe.mjs";

const TEST_ONLY_SEED = "TEST_ONLY_R2_DETERMINISTIC_PRIVATE_INPUT_0000000000";
const calendarDirectory = resolve("data/puzzles/daily");
const elapsedNames = (await readdir(calendarDirectory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) <= "2026-08-24").sort();
assert.equal(elapsedNames.length, 31, "the protected elapsed baseline must contain 31 manifests");
const elapsedBytesBefore = new Map(await Promise.all(elapsedNames.map(async (name) => [name, await readFile(resolve(calendarDirectory, name), "utf8")])));

assert.equal(difficultyBand(12), "easy");
assert.equal(difficultyBand(36), "medium");
assert.equal(difficultyBand(100), "hard");
assert.equal(difficultyBand(101), "extreme");
assert.deepEqual(Array.from({ length: 8 }, (_, index) => targetDifficultyBand(index)), ["easy", "medium", "hard", "medium", "easy", "medium", "hard", "medium"]);

await assert.rejects(preparePrivateDailyBuffer({ asOfDate: "2026-08-24", readyDays: 30, write: false }), /private seed/i);
await assert.rejects(preparePrivateDailyBuffer({ asOfDate: "2026-08-24", readyDays: 29, privateSeed: TEST_ONLY_SEED, write: false }), /at least 30 days/i);
await assert.rejects(preparePrivateDailyBuffer({ asOfDate: "2026-08-24", readyDays: 30, alertThresholdDays: 6, privateSeed: TEST_ONLY_SEED, write: false }), /between 7 and readyDays/i);

const privateRoot = await mkdtemp(join(tmpdir(), "pokesort-r2-private-"));
try {
  const options = {
    outputDirectory: privateRoot,
    asOfDate: "2026-08-24",
    readyDays: 30,
    attemptsPerRuleSet: 100,
    maximumRuleSetsPerDate: 500,
    preferredBandSearchRuleSets: 50,
    privateSeed: TEST_ONLY_SEED,
    write: false,
  };
  const first = await preparePrivateDailyBuffer(options);
  const second = await preparePrivateDailyBuffer(options);
  assert.equal(first.receipt.contentHash, second.receipt.contentHash, "same private TEST input must be deterministic");
  assert.equal(first.generated.manifests.length, 30);
  assert.equal(first.receipt.alertThresholdDays, 7);
  assert.equal(first.receipt.elapsedManifestCount, 31);
  assert(first.receipt.elapsedBytesUnchanged);
  assert(first.receipt.qualityReport.calibratedCoverage >= DAILY_BOARD_QUALITY_POLICY.calibratedCoverageMinimum);
  assert(first.receipt.qualityReport.difficultyDistributionPass);
  assert(first.generated.manifests.every((manifest) => manifest.quality.accepted));
  assert(first.generated.manifests.every((manifest) => manifest.solver.validQuartetCount >= 12 && manifest.solver.validQuartetCount <= 100));
  assert(first.generated.manifests.every((manifest) => manifest.quality.threeCardUnintendedCount <= 30));
  assert(!JSON.stringify(first.generated).includes(TEST_ONLY_SEED));
  assert(!JSON.stringify(first.generated.manifests).includes("sourceSeed"));
  assert(!JSON.stringify(first.generated.manifests).includes('"seed":'));
  assert.equal(new Set(first.generated.manifests.map(({ boardSignature }) => boardSignature)).size, 30);
  assert.equal(new Set(first.generated.manifests.flatMap(({ groups }) => groups.map(({ signature }) => signature))).size, 120);
  for (let index = 1; index < first.generated.manifests.length; index += 1) {
    const previous = new Set(first.generated.manifests[index - 1].cards.map(({ id }) => id));
    assert(!first.generated.manifests[index].cards.some(({ id }) => previous.has(id)), "species must not repeat on consecutive days");
  }
  for (let index = 0; index < first.generated.manifests.length; index += 1) {
    const current = new Set(first.generated.manifests[index].groups.map(({ predicateSignature }) => predicateSignature));
    for (const prior of first.generated.manifests.slice(Math.max(0, index - 14), index)) {
      assert(!prior.groups.some(({ predicateSignature }) => current.has(predicateSignature)), "predicate must not occur in the preceding 14 boards");
    }
  }

  const model = await loadCategoryModel();
  const universe = buildRuleUniverse(model);
  const sample = first.generated.manifests.find(({ quality }) => quality.validOverlapMemberSignatures.length > 0);
  assert(sample, "accepted buffer must include a factual-overlap feedback fixture");
  const quality = assessBoardQuality({ puzzle: sample, ruleUniverse: universe, expectedDifficultyBand: sample.quality.expectedDifficultyBand });
  assert.deepEqual(quality, sample.quality, "stored overlap evidence must be reproducible from canonical rules");

  assert.equal((await readdir(privateRoot)).length, 0);
  await preparePrivateDailyBuffer({ ...options, write: true });
  const names = await readdir(privateRoot);
  assert.equal(names.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).length, 30);
  assert(names.includes("index.json") && names.includes("receipts"));
  assert.deepEqual(await readdir(resolve(privateRoot, "receipts")), ["receipt.json"]);
  for (const name of names.filter((name) => name.endsWith(".json"))) {
    const bytes = await readFile(resolve(privateRoot, name), "utf8");
    assert(!bytes.includes(TEST_ONLY_SEED), `private seed leaked into ${name}`);
    assert(!bytes.includes("sourceSeed") && !bytes.includes('"seed"'), `seed field leaked into ${name}`);
  }
  const receiptBytes = await readFile(resolve(privateRoot, "receipts/receipt.json"), "utf8");
  assert(!receiptBytes.includes(TEST_ONLY_SEED) && !receiptBytes.includes('"seed"'));
  const validation = await validatePrivateDailyBuffer({ bufferDirectory: privateRoot, asOfDate: "2026-08-24" });
  assert.equal(validation.gate, "PASS");
  assert.equal(validation.semanticGate, "PASS");
  assert.equal(validation.remainingReadyDays, 30);
  assert.equal(validation.belowAlertThreshold, false);

  // Construct a deterministic day-two violation against the exact rolling Gate
  // used by stored-buffer validation. This cannot depend on a generated group
  // exposing any particular alternate matching-rule evidence.
  const historyManifests = elapsedNames.map((name) => JSON.parse(elapsedBytesBefore.get(name)));
  const cooldownProbe = structuredClone(first.generated.manifests.slice(0, 2));
  const canonicalElapsedPredicate = historyManifests.at(-1).groups[0].predicateSignature;
  assert(!cooldownProbe[0].groups.some(({ predicateSignature }) => predicateSignature === canonicalElapsedPredicate));
  cooldownProbe[1].groups[0].predicateSignature = canonicalElapsedPredicate;
  assert.throws(
    () => assertRollingPredicateCooldown({ historyManifests, privateManifests: cooldownProbe }),
    new RegExp(`PRIVATE_BUFFER_HISTORY_COOLDOWN_MISMATCH: ${cooldownProbe[1].date}`),
    "the rolling cooldown Gate must reject a canonical elapsed predicate on private day two",
  );
  await assert.rejects(preparePrivateDailyBuffer({ ...options, write: true }), /EEXIST/, "private date keys must be immutable");

  for (const [name, bytes] of elapsedBytesBefore) {
    assert.equal(await readFile(resolve(calendarDirectory, name), "utf8"), bytes, `elapsed manifest bytes changed: ${name}`);
  }

  console.log(JSON.stringify({
    gate: "PASS",
    readyDays: 30,
    alertThresholdDays: 7,
    deterministic: true,
    elapsedManifestCount: 31,
    elapsedBytesUnchanged: true,
    qualityReport: first.receipt.qualityReport,
  }, null, 2));
} finally {
  await rm(privateRoot, { recursive: true, force: true });
}
