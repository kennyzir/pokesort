import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDailyCalendar, DEFAULT_START_DATE } from "./build-daily-calendar.mjs";
import { validateDailyCalendar } from "./validate-daily-calendar.mjs";
import { DAILY_BOARD_QUALITY_POLICY } from "./board-quality-policy.mjs";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "pokesort-qb3-calendar-"));
assert(resolve(temporaryDirectory).startsWith(resolve(tmpdir())), "Temporary test directory escaped the OS temp root");

try {
  const calendarSeed = "calendar-test-fixture-input-never-production-0001";
  const impossiblePolicy = {
    ...DAILY_BOARD_QUALITY_POLICY,
    validQuartetCount: { minimum: 10_000, maximum: 10_001 },
    difficultyBands: { easy: { minimum: 10_000, maximum: 10_001 }, medium: { minimum: 10_002, maximum: 10_003 }, hard: { minimum: 10_004, maximum: 10_005 } },
  };
  await assert.rejects(
    buildDailyCalendar({ outputDirectory: temporaryDirectory, dayCount: 1, attemptsPerRuleSet: 1, maximumRuleSetsPerDate: 1, preferredBandSearchRuleSets: 1, calendarSeed, qualityPolicy: impossiblePolicy }),
    /CALENDAR_DATE_EXHAUSTED/,
    "generation exhaustion must fail closed",
  );
  assert.deepEqual(await readdir(temporaryDirectory), [], "generation exhaustion must not emit or relabel any board");
  const dayCount = 30;
  const first = await buildDailyCalendar({ outputDirectory: temporaryDirectory, dayCount, attemptsPerRuleSet: 500, calendarSeed });
  assert.equal(first.manifests.length, dayCount);
  assert.deepEqual(first.writes, { created: 31, unchanged: 0 });
  const firstBytes = new Map(first.output.map(({ path, bytes }) => [path, bytes]));

  const second = await buildDailyCalendar({ outputDirectory: temporaryDirectory, dayCount, attemptsPerRuleSet: 500, calendarSeed });
  assert.deepEqual(second.writes, { created: 0, unchanged: 31 });
  assert.deepEqual(new Map(second.output.map(({ path, bytes }) => [path, bytes])), firstBytes, "Rerun output must be byte-stable");

  const audit = await validateDailyCalendar({
    calendarDirectory: temporaryDirectory,
    expectedStartDate: DEFAULT_START_DATE,
    expectedDayCount: dayCount,
    asOfDate: "2026-08-24",
  });
  assert.equal(audit.dates, dayCount);
  assert.equal(audit.distinctPuzzleIds, dayCount);
  assert.equal(audit.distinctBoards, dayCount);
  assert.equal(audit.distinctExactGroups, 120);
  assert.equal(audit.distinctMemberGroups, 120);
  assert.equal(audit.predicateCooldownDays, 14);
  assert.equal(audit.consecutiveSpeciesRepeats, 0);
  assert.equal(audit.solverProofsRecomputed, dayCount);
  assert.equal(audit.publishableCount, dayCount);
  assert.equal(audit.futureStoredCount, 0);

  const firstManifestPath = join(temporaryDirectory, `${DEFAULT_START_DATE}.json`);
  const original = await readFile(firstManifestPath, "utf8");
  const tampered = JSON.parse(original);
  tampered.cards[0].name = `${tampered.cards[0].name} tampered`;
  await writeFile(firstManifestPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  await assert.rejects(
    validateDailyCalendar({ calendarDirectory: temporaryDirectory, expectedDayCount: dayCount, resolveSolverProof: false }),
    /content hash mismatch/,
    "Validator must detect manifest tampering",
  );
  await assert.rejects(
    buildDailyCalendar({ outputDirectory: temporaryDirectory, dayCount, attemptsPerRuleSet: 500, calendarSeed }),
    /IMMUTABLE_MANIFEST_MISMATCH/,
    "Builder must refuse to overwrite a differing published-date file",
  );
  await writeFile(firstManifestPath, original, "utf8");

  const gapPath = join(temporaryDirectory, "2026-08-10.json");
  await rm(gapPath);
  await assert.rejects(
    validateDailyCalendar({ calendarDirectory: temporaryDirectory, expectedDayCount: dayCount, resolveSolverProof: false }),
    /Expected 30 manifest files, found 29/,
    "Validator must detect a calendar gap",
  );

  console.log(JSON.stringify({
    range: audit.range,
    dates: audit.dates,
    distinctBoards: audit.distinctBoards,
    distinctExactGroups: audit.distinctExactGroups,
    predicateCooldownDays: audit.predicateCooldownDays,
    consecutiveSpeciesRepeats: audit.consecutiveSpeciesRepeats,
    publicationAsOfUtcDate: audit.publicationAsOfUtcDate,
    publishableCount: audit.publishableCount,
    futureStoredCount: audit.futureStoredCount,
    firstBuildMilliseconds: first.timing.milliseconds,
    rerunMilliseconds: second.timing.milliseconds,
    tamperDetected: true,
    immutableOverwriteBlocked: true,
    gapDetected: true,
    byteStableRerun: true,
    generationExhaustionEmittedFiles: 0,
  }, null, 2));
  console.log("QB3 immutable Daily calendar passed generation, proof, cooldown, publication, and tamper validation.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
