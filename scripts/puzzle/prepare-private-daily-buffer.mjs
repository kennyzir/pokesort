import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDailyCalendar } from "./build-daily-calendar.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";
import { validateDailyCalendar } from "./validate-daily-calendar.mjs";
import { loadCategoryModel } from "./category-model.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { DAILY_BOARD_QUALITY_POLICY, targetDifficultyBand } from "./board-quality-policy.mjs";

export const PRIVATE_BUFFER_SCHEMA_VERSION = 2;
export const DEFAULT_READY_DAYS = 30;
export const MINIMUM_ALERT_DAYS = 7;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultElapsedDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");
const defaultPrivateDirectory = resolve(moduleDirectory, "../../data/puzzles/private/daily");
const defaultInfiniteDirectory = resolve(moduleDirectory, "../../data/puzzles/infinite");

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

async function elapsedSnapshot(directory, asOfDate) {
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) <= asOfDate).sort();
  const manifests = [];
  const hashes = {};
  for (const name of names) {
    const bytes = await readFile(resolve(directory, name));
    hashes[name] = createHash("sha256").update(bytes).digest("hex");
    manifests.push(JSON.parse(bytes));
  }
  return { names, manifests, hashes };
}

async function infiniteExclusionSnapshot(directory) {
  const indexPath = resolve(directory, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  verifyCanonicalHash(index, { label: indexPath });
  const boards = new Set();
  const exactGroups = new Set();
  const memberGroups = new Set();
  let puzzleCount = 0;
  for (const entry of index.shards ?? []) {
    const shardPath = resolve(directory, entry.file);
    const shard = JSON.parse(await readFile(shardPath, "utf8"));
    verifyCanonicalHash(shard, { label: shardPath });
    if (shard.contentHash !== entry.contentHash || shard.count !== entry.count || shard.puzzles?.length !== entry.count) {
      throw new Error(`INFINITE_EXCLUSION_SHARD_MISMATCH: ${entry.file}`);
    }
    for (const puzzle of shard.puzzles) {
      boards.add(puzzle.boardSignature);
      for (const group of puzzle.groups) {
        exactGroups.add(group.signature);
        memberGroups.add(group.memberSignature);
      }
      puzzleCount += 1;
    }
  }
  if (puzzleCount !== index.poolSize || boards.size !== puzzleCount) throw new Error("INFINITE_EXCLUSION_POOL_MISMATCH");
  return {
    boardSignatures: boards,
    exactGroupSignatures: exactGroups,
    memberGroupSignatures: memberGroups,
    receipt: {
      indexContentHash: index.contentHash,
      puzzleCount,
      boardSignatureCount: boards.size,
      exactGroupSignatureCount: exactGroups.size,
      memberGroupSignatureCount: memberGroups.size,
    },
  };
}

function assertNoPrivateDerivationMaterial(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ["sourceSeed", "productionSeed", '"seed":']) {
    if (serialized.includes(forbidden)) throw new Error(`PRIVATE_BUFFER_SEED_LEAK: ${forbidden}`);
  }
}

export function assertRollingPredicateCooldown({
  historyManifests,
  privateManifests,
  cooldownDays = DAILY_BOARD_QUALITY_POLICY.predicateCooldownDays,
}) {
  const recentPredicates = historyManifests.slice(-cooldownDays)
    .map(({ groups }) => groups.map(({ predicateSignature }) => predicateSignature));
  for (const manifest of privateManifests) {
    const forbidden = new Set(recentPredicates.flat());
    if (manifest.groups.some(({ predicateSignature }) => forbidden.has(predicateSignature))) {
      throw new Error(`PRIVATE_BUFFER_HISTORY_COOLDOWN_MISMATCH: ${manifest.date}`);
    }
    recentPredicates.push(manifest.groups.map(({ predicateSignature }) => predicateSignature));
    if (recentPredicates.length > cooldownDays) recentPredicates.shift();
  }
}

async function validateGeneratedPrivateBuffer({ generated, historyManifests, infiniteExclusions }) {
  const model = await loadCategoryModel();
  const ruleEvidence = buildCanonicalRuleEvidence(model);
  if (canonicalJson(generated.index.qualityPolicy) !== canonicalJson(DAILY_BOARD_QUALITY_POLICY)) throw new Error("PRIVATE_BUFFER_QUALITY_POLICY_MISMATCH");
  const recentPredicates = historyManifests.slice(-DAILY_BOARD_QUALITY_POLICY.predicateCooldownDays)
    .map(({ groups }) => groups.map(({ predicateSignature }) => predicateSignature));
  let priorSpecies = new Set(historyManifests.at(-1)?.cards.map(({ id }) => id) ?? []);
  const usedBoards = new Set([...infiniteExclusions.boardSignatures, ...historyManifests.map(({ boardSignature }) => boardSignature)]);
  const usedExactGroups = new Set([...infiniteExclusions.exactGroupSignatures, ...historyManifests.flatMap(({ groups }) => groups.map(({ signature }) => signature))]);
  const usedGroups = new Set([...infiniteExclusions.memberGroupSignatures, ...historyManifests.flatMap(({ groups }) => groups.map(({ memberSignature }) => memberSignature))]);
  for (const [index, manifest] of generated.manifests.entries()) {
    verifyCanonicalHash(manifest, { label: `private Daily ${manifest.date}`, excludedKeys: ["contentHash", "puzzleId"] });
    verifyPuzzleSemantics(manifest, { model, ruleEvidence, context: `private Daily ${manifest.date}` });
    if (!manifest.quality?.accepted) throw new Error(`PRIVATE_BUFFER_QUALITY_REJECTED: ${manifest.date}`);
    const expectedBand = targetDifficultyBand(historyManifests.length + index, generated.index.qualityPolicy);
    if (manifest.quality.expectedDifficultyBand !== expectedBand
      || manifest.quality.difficultyTargetMet !== (manifest.quality.difficultyBand === expectedBand)) {
      throw new Error(`PRIVATE_BUFFER_DIFFICULTY_SCHEDULE_MISMATCH: ${manifest.date}`);
    }
    const predicates = manifest.groups.map(({ predicateSignature }) => predicateSignature);
    const forbiddenPredicates = new Set(recentPredicates.flat());
    if (predicates.some((signature) => forbiddenPredicates.has(signature))) throw new Error(`PRIVATE_BUFFER_PREDICATE_COOLDOWN: ${manifest.date}`);
    const species = new Set(manifest.cards.map(({ id }) => id));
    if ([...species].some((id) => priorSpecies.has(id))) throw new Error(`PRIVATE_BUFFER_CONSECUTIVE_SPECIES: ${manifest.date}`);
    if (usedBoards.has(manifest.boardSignature)) throw new Error(`PRIVATE_BUFFER_DUPLICATE_BOARD: ${manifest.date}`);
    if (manifest.groups.some(({ signature }) => usedExactGroups.has(signature))) throw new Error(`PRIVATE_BUFFER_DUPLICATE_EXACT_GROUP: ${manifest.date}`);
    if (manifest.groups.some(({ memberSignature }) => usedGroups.has(memberSignature))) throw new Error(`PRIVATE_BUFFER_DUPLICATE_GROUP: ${manifest.date}`);
    recentPredicates.push(predicates);
    if (recentPredicates.length > DAILY_BOARD_QUALITY_POLICY.predicateCooldownDays) recentPredicates.shift();
    priorSpecies = species;
    usedBoards.add(manifest.boardSignature);
    manifest.groups.forEach(({ signature, memberSignature }) => {
      usedExactGroups.add(signature);
      usedGroups.add(memberSignature);
    });
  }
  if (!generated.index.qualityReport.difficultyDistributionPass) throw new Error("PRIVATE_BUFFER_DIFFICULTY_DISTRIBUTION_BLOCKED");
  if (generated.index.qualityReport.calibratedCoverage < generated.index.qualityPolicy.calibratedCoverageMinimum) throw new Error("PRIVATE_BUFFER_CALIBRATED_COVERAGE_BLOCKED");
  assertNoPrivateDerivationMaterial({ manifests: generated.manifests, index: generated.index });
}

export async function validatePrivateDailyBuffer({
  elapsedDirectory = defaultElapsedDirectory,
  bufferDirectory = defaultPrivateDirectory,
  infiniteDirectory = defaultInfiniteDirectory,
  asOfDate = new Date().toISOString().slice(0, 10),
} = {}) {
  if (!validDate(asOfDate)) throw new Error("asOfDate must be a valid UTC date");
  const receiptPath = resolve(bufferDirectory, "receipts/receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  verifyCanonicalHash(receipt, { label: receiptPath });
  if (receipt.privateBufferSchemaVersion !== PRIVATE_BUFFER_SCHEMA_VERSION) throw new Error("PRIVATE_BUFFER_SCHEMA_MISMATCH");
  if (receipt.asOfDate !== asOfDate || receipt.range.startDate !== addDays(asOfDate, 1)) throw new Error("PRIVATE_BUFFER_DATE_BOUNDARY_MISMATCH");
  if (receipt.readyDays < DEFAULT_READY_DAYS || receipt.alertThresholdDays < MINIMUM_ALERT_DAYS) throw new Error("PRIVATE_BUFFER_DEPTH_BLOCKED");
  const elapsed = await elapsedSnapshot(elapsedDirectory, asOfDate);
  const infiniteExclusions = await infiniteExclusionSnapshot(infiniteDirectory);
  if (canonicalJson(receipt.infiniteExclusion) !== canonicalJson(infiniteExclusions.receipt)) {
    throw new Error("PRIVATE_BUFFER_INFINITE_EXCLUSION_MISMATCH");
  }
  if (canonicalJson(elapsed.hashes) !== canonicalJson(receipt.elapsedByteHashesBefore)
    || canonicalJson(elapsed.hashes) !== canonicalJson(receipt.elapsedByteHashesAfter)) {
    throw new Error("ELAPSED_MANIFEST_MUTATION: receipt does not match current elapsed bytes");
  }
  const calendar = await validateDailyCalendar({
    calendarDirectory: bufferDirectory,
    expectedStartDate: receipt.range.startDate,
    expectedDayCount: receipt.readyDays,
    asOfDate,
  });
  const index = JSON.parse(await readFile(resolve(bufferDirectory, "index.json"), "utf8"));
  if (canonicalJson(index.entries) !== canonicalJson(receipt.entries)) throw new Error("PRIVATE_BUFFER_RECEIPT_INDEX_MISMATCH");
  assertNoPrivateDerivationMaterial({ receipt, index });
  const privateManifests = [];
  for (const { file } of index.entries) {
    const manifest = JSON.parse(await readFile(resolve(bufferDirectory, file), "utf8"));
    assertNoPrivateDerivationMaterial(manifest);
    privateManifests.push(manifest);
  }
  assertRollingPredicateCooldown({ historyManifests: elapsed.manifests, privateManifests });
  for (const manifest of privateManifests) {
    if (infiniteExclusions.boardSignatures.has(manifest.boardSignature)
      || manifest.groups.some(({ signature }) => infiniteExclusions.exactGroupSignatures.has(signature))
      || manifest.groups.some(({ memberSignature }) => infiniteExclusions.memberGroupSignatures.has(memberSignature))) {
      throw new Error(`PRIVATE_BUFFER_INFINITE_COLLISION: ${manifest.date}`);
    }
  }
  const lastElapsedSpecies = new Set(elapsed.manifests.at(-1).cards.map(({ id }) => id));
  if (privateManifests[0].cards.some(({ id }) => lastElapsedSpecies.has(id))) throw new Error("PRIVATE_BUFFER_HISTORY_SPECIES_MISMATCH");
  return {
    gate: calendar.dates >= receipt.alertThresholdDays ? "PASS" : "BLOCKED",
    calendar,
    receipt,
    remainingReadyDays: calendar.dates,
    belowAlertThreshold: calendar.dates < receipt.alertThresholdDays,
    semanticGate: "PASS",
  };
}

export async function preparePrivateDailyBuffer({
  elapsedDirectory = defaultElapsedDirectory,
  outputDirectory = defaultPrivateDirectory,
  infiniteDirectory = defaultInfiniteDirectory,
  asOfDate = new Date().toISOString().slice(0, 10),
  readyDays = DEFAULT_READY_DAYS,
  alertThresholdDays = MINIMUM_ALERT_DAYS,
  privateSeed,
  attemptsPerRuleSet = 500,
  maximumRuleSetsPerDate = 2_000,
  preferredBandSearchRuleSets = 100,
  write = true,
} = {}) {
  if (!validDate(asOfDate)) throw new Error("asOfDate must be a valid UTC date");
  if (!Number.isSafeInteger(readyDays) || readyDays < DEFAULT_READY_DAYS) throw new Error(`Private ready buffer must contain at least ${DEFAULT_READY_DAYS} days`);
  if (!Number.isSafeInteger(alertThresholdDays) || alertThresholdDays < MINIMUM_ALERT_DAYS || alertThresholdDays > readyDays) throw new Error(`Alert threshold must be between ${MINIMUM_ALERT_DAYS} and readyDays`);
  if (typeof privateSeed !== "string" || privateSeed.length < 32) throw new Error("A private seed of at least 32 characters is required");

  const before = await elapsedSnapshot(elapsedDirectory, asOfDate);
  const infiniteExclusions = await infiniteExclusionSnapshot(infiniteDirectory);
  if (!before.manifests.length) throw new Error("No elapsed manifests were found to preserve");
  const startDate = addDays(asOfDate, 1);
  let generated;
  let generationAttempt = 0;
  const maximumGenerationAttempts = 8;
  for (; generationAttempt < maximumGenerationAttempts; generationAttempt += 1) {
    try {
      generated = await buildDailyCalendar({
        outputDirectory,
        startDate,
        dayCount: readyDays,
        attemptsPerRuleSet,
        maximumRuleSetsPerDate,
        preferredBandSearchRuleSets,
        calendarSeed: `${privateSeed}|infinite-exclusion-v1|attempt:${generationAttempt}`,
        historyManifests: before.manifests,
        excludedBoardSignatures: infiniteExclusions.boardSignatures,
        excludedExactGroupSignatures: infiniteExclusions.exactGroupSignatures,
        excludedMemberGroupSignatures: infiniteExclusions.memberGroupSignatures,
        write: false,
      });
      break;
    } catch (error) {
      if (!/^(DAILY_QUALITY_DISTRIBUTION_BLOCKED|CALENDAR_DATE_EXHAUSTED|CALENDAR_RULE_CAPACITY_EXHAUSTED):/.test(error.message)
        || generationAttempt === maximumGenerationAttempts - 1) throw error;
    }
  }
  if (!generated) throw new Error("PRIVATE_BUFFER_GENERATION_EXHAUSTED");
  await validateGeneratedPrivateBuffer({ generated, historyManifests: before.manifests, infiniteExclusions });
  const after = await elapsedSnapshot(elapsedDirectory, asOfDate);
  if (canonicalJson(before.hashes) !== canonicalJson(after.hashes)) throw new Error("ELAPSED_MANIFEST_MUTATION: elapsed Daily bytes changed during private preparation");

  const receiptBase = {
    privateBufferSchemaVersion: PRIVATE_BUFFER_SCHEMA_VERSION,
    storageClass: "private-ignored-precomputed-input",
    asOfDate,
    range: generated.index.range,
    readyDays,
    alertThresholdDays,
    elapsedManifestCount: before.manifests.length,
    elapsedByteHashesBefore: before.hashes,
    elapsedByteHashesAfter: after.hashes,
    elapsedBytesUnchanged: true,
    infiniteExclusion: infiniteExclusions.receipt,
    generationDerivation: { id: "infinite-exclusion-v1", attempt: generationAttempt, maximumAttempts: maximumGenerationAttempts },
    qualityPolicy: generated.index.qualityPolicy,
    qualityReport: generated.index.qualityReport,
    generationAudit: generated.index.generationAudit,
    entries: generated.index.entries,
  };
  const receipt = { ...receiptBase, contentHash: sha256(receiptBase) };
  if (write) {
    await mkdir(outputDirectory, { recursive: true });
    for (const item of generated.output) await writeFile(item.path, item.bytes, { encoding: "utf8", flag: "wx" });
    await mkdir(resolve(outputDirectory, "receipts"), { recursive: true });
    await writeFile(resolve(outputDirectory, "receipts/receipt.json"), `${canonicalJson(receipt, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const validation = await validatePrivateDailyBuffer({ elapsedDirectory, bufferDirectory: outputDirectory, infiniteDirectory, asOfDate });
    if (validation.gate !== "PASS") throw new Error("PRIVATE_BUFFER_GATE_BLOCKED");
  }
  return { generated, receipt };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--elapsed-dir") options.elapsedDirectory = resolve(argv[++index]);
    else if (value === "--output-dir") options.outputDirectory = resolve(argv[++index]);
    else if (value === "--infinite-dir") options.infiniteDirectory = resolve(argv[++index]);
    else if (value === "--as-of") options.asOfDate = argv[++index];
    else if (value === "--days") options.readyDays = Number(argv[++index]);
    else if (value === "--alert-threshold-days") options.alertThresholdDays = Number(argv[++index]);
    else if (value === "--attempts-per-rule-set") options.attemptsPerRuleSet = Number(argv[++index]);
    else if (value === "--max-rule-sets-per-date") options.maximumRuleSetsPerDate = Number(argv[++index]);
    else if (value === "--preferred-band-search-rule-sets") options.preferredBandSearchRuleSets = Number(argv[++index]);
    else if (value === "--no-write") options.write = false;
    else if (value === "--ephemeral-seed") options.privateSeed = randomBytes(48).toString("base64url");
    else if (value === "--validate-only") options.validateOnly = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  options.privateSeed ??= process.env.POKESORT_DAILY_SEED;
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (options.validateOnly) {
    const validation = await validatePrivateDailyBuffer({
      elapsedDirectory: options.elapsedDirectory,
      bufferDirectory: options.outputDirectory,
      infiniteDirectory: options.infiniteDirectory,
      asOfDate: options.asOfDate,
    });
    console.log(JSON.stringify({
      gate: validation.gate,
      semanticGate: validation.semanticGate,
      range: validation.receipt.range,
      readyDays: validation.receipt.readyDays,
      alertThresholdDays: validation.receipt.alertThresholdDays,
      elapsedBytesUnchanged: validation.receipt.elapsedBytesUnchanged,
      qualityReport: validation.receipt.qualityReport,
      receiptHash: validation.receipt.contentHash,
    }, null, 2));
    process.exit(0);
  }
  const { receipt } = await preparePrivateDailyBuffer(options);
  console.log(JSON.stringify({
    gate: receipt.readyDays >= receipt.alertThresholdDays ? "PASS" : "BLOCKED",
    storageClass: receipt.storageClass,
    range: receipt.range,
    readyDays: receipt.readyDays,
    alertThresholdDays: receipt.alertThresholdDays,
    elapsedManifestCount: receipt.elapsedManifestCount,
    elapsedBytesUnchanged: receipt.elapsedBytesUnchanged,
    qualityReport: receipt.qualityReport,
    generationAudit: receipt.generationAudit,
    semanticGate: "PASS",
    receiptHash: receipt.contentHash,
  }, null, 2));
}
