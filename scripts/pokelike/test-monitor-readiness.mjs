import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareSamples, normalizeSample } from "./capture-official.mjs";
import { computeDrillSha256, createFailureDrillRecords, validateFailureDrill } from "./generate-failure-drills.mjs";
import { summarizeReadiness } from "./monitor-readiness.mjs";

const timezone = "Asia/Shanghai";
const pad = (value) => String(value).padStart(2, "0");
const sampleFor = (dayOfMonth, puzzleNumber, sourceDay = dayOfMonth) => ({
  capturedAt: `2026-08-${pad(sourceDay)}T01:08:00.000Z`,
  source: { url: "https://pokelike.xyz/pokesort", status: 200, date: `2026-08-${pad(sourceDay)}T01:08:00.000Z`, etag: '"html"', bodyBytes: 12, bodySha256: "a".repeat(64) },
  bundle: { url: "https://pokelike.xyz/js/bundle.abc123.js", status: 200, date: `2026-08-${pad(sourceDay)}T01:08:00.000Z`, etag: '"bundle"', bodyBytes: 34, bodySha256: "b".repeat(64) },
  snapshot: {
    day: 20689 - (24 - dayOfMonth), puzzleNumber,
    state: { slots: [299, 562, 679, 330, 107, 536], conds: ["stage_lt", "stage_gt", "color", "stage_lt", "gen_gt"], solution: [562, 330, 107, 679, 536, 299] },
    candidates: [
      { id: 299, name: "Nosepass", gen: 3, stage: 0, color: "gray", types: ["Rock"] },
      { id: 562, name: "Yamask", gen: 5, stage: 0, color: "black", types: ["Ghost"] },
      { id: 679, name: "Honedge", gen: 6, stage: 0, color: "brown", types: ["Steel", "Ghost"] },
      { id: 330, name: "Flygon", gen: 3, stage: 2, color: "green", types: ["Ground", "Dragon"] },
      { id: 107, name: "Hitmonchan", gen: 1, stage: 1, color: "brown", types: ["Fighting"] },
      { id: 536, name: "Palpitoad", gen: 5, stage: 1, color: "blue", types: ["Water", "Ground"] },
    ],
    conditionDefinitions: [
      { key: "stage_lt", label: "Stage", cmp: "<", desc: "Left is less evolved." },
      { key: "stage_gt", label: "Stage", cmp: ">", desc: "Left is further evolved." },
      { key: "color", label: "Colour", cmp: "=", desc: "They share a colour." },
      { key: "stage_lt", label: "Stage", cmp: "<", desc: "Left is less evolved." },
      { key: "gen_gt", label: "Gen", cmp: ">", desc: "Left is later." },
    ],
    officialSolutionCount: 1,
  },
});

function verifiedRecord(dayOfMonth) {
  const first = sampleFor(dayOfMonth, 54 - (24 - dayOfMonth));
  const second = structuredClone(first);
  second.capturedAt = `2026-08-${pad(dayOfMonth)}T01:08:02.000Z`;
  const verifiedAt = new Date(`2026-08-${pad(dayOfMonth)}T01:09:00.000Z`);
  const manifest = { ...normalizeSample(first, timezone, verifiedAt), status: "VERIFIED" };
  return {
    ok: true,
    status: "VERIFIED",
    timezone,
    transitions: [
      { state: "PENDING", at: `2026-08-${pad(dayOfMonth)}T01:07:00.000Z` },
      { state: "EXTRACTED", at: `2026-08-${pad(dayOfMonth)}T01:08:30.000Z` },
      { state: "VERIFIED", at: manifest.verifiedAt },
    ],
    consistencySha256: compareSamples([first, second]),
    samples: [first, second],
    manifest,
    verification: { localSolutionCount: 1, officialSolutionCount: 1, permutationsChecked: 720 },
  };
}

const fixture = JSON.parse(await readFile(new URL("../../data/pokelike/fixtures/puzzle-54.verified.v1.json", import.meta.url), "utf8"));
const drills = createFailureDrillRecords(fixture);
const acquisitionDrill = drills.find(({ scenario }) => scenario === "acquisition_failure");
const staleDrill = drills.find(({ scenario }) => scenario === "stale_record");
for (const drill of drills) assert.deepEqual(validateFailureDrill(drill), { scenario: drill.scenario, simulated: true });
const currentRun = Array.from({ length: 7 }, (_, index) => verifiedRecord(24 - index));
const options = { now: new Date("2026-08-24T03:00:00.000Z"), timezone, expectedLatestLocalDate: "2026-08-24", maxEvidenceAgeHours: 6 };
const summarize = (records, overrides = {}) => summarizeReadiness(records, { ...options, drillRecords: drills, ...overrides });

const passing = summarize(currentRun);
assert.equal(passing.recordCount, 7, "simulated drills must not increase live shadow recordCount");
assert.equal(passing.drillRecordCount, 2);
assert.equal(passing.validEvidenceBackedGoodRecords, 7);
assert.equal(passing.consecutiveVerifiedDays, 7);
assert.equal(passing.endsOnExpectedDate, true);
assert.equal(passing.freshnessPass, true);
assert.equal(passing.latestEvidenceAgeHours, 1.85);
assert.equal(passing.failureDrills.acquisitionFailureObserved, true);
assert.equal(passing.failureDrills.staleFailureObserved, true);
assert.equal(passing.localGate, "PASS");

const fake = { status: "VERIFIED", manifest: { status: "VERIFIED", localDate: "2026-08-24", timezone } };
const fakeResult = summarize([...currentRun.slice(1), fake]);
assert.equal(fakeResult.consecutiveVerifiedDays, 0);
assert.equal(fakeResult.invalidGoodRecords.length, 1);
assert.equal(fakeResult.localGate, "BLOCKED");

const tampered = structuredClone(currentRun[0]);
tampered.manifest.candidates[0].name = "Tampered";
const tamperedResult = summarize([tampered, ...currentRun.slice(1)]);
assert.equal(tamperedResult.invalidGoodRecords.length, 1);
assert.equal(tamperedResult.localGate, "BLOCKED");

const historicalRun = Array.from({ length: 7 }, (_, index) => verifiedRecord(16 - index));
const historical = summarize(historicalRun);
assert.equal(historical.consecutiveVerifiedDays, 0);
assert.equal(historical.endsOnExpectedDate, false);
assert.equal(historical.localGate, "BLOCKED");

const oldEvidence = summarize(currentRun, { maxEvidenceAgeHours: 1 });
assert.equal(oldEvidence.freshnessPass, false);
assert.equal(oldEvidence.localGate, "BLOCKED");

const sixDaysAndDuplicate = [...currentRun.slice(0, 6), structuredClone(currentRun[0])];
const duplicate = summarize(sixDaysAndDuplicate);
assert.equal(duplicate.consecutiveVerifiedDays, 6);
assert.deepEqual(duplicate.duplicateGoodDates, [{ date: "2026-08-24", count: 2 }]);
assert.equal(duplicate.localGate, "BLOCKED");

const tamperedDrill = structuredClone(acquisitionDrill);
tamperedDrill.trigger.message = "tampered";
const invalidFailureResult = summarizeReadiness(currentRun, { ...options, drillRecords: [tamperedDrill, staleDrill] });
assert.equal(invalidFailureResult.failureDrills.acquisitionFailureObserved, false);
assert.equal(invalidFailureResult.invalidFailureRecords.length, 1);
assert.equal(invalidFailureResult.localGate, "BLOCKED");

const masqueradingDrill = structuredClone(acquisitionDrill);
masqueradingDrill.observedStatus = "VERIFIED";
masqueradingDrill.evidenceSha256 = computeDrillSha256(masqueradingDrill);
const masqueradeResult = summarizeReadiness(currentRun, { ...options, drillRecords: [masqueradingDrill, staleDrill] });
assert.equal(masqueradeResult.validEvidenceBackedGoodRecords, 7, "a simulated drill must never become a good daily observation");
assert.equal(masqueradeResult.failureDrills.acquisitionFailureObserved, false);
assert.equal(masqueradeResult.invalidFailureRecords.length, 1);
assert.equal(masqueradeResult.localGate, "BLOCKED");

assert.deepEqual(new Set(Object.values(passing.externalEvidence)), new Set(["UNVERIFIED"]));
console.log("Pokelike readiness Gate tests passed: reconstructed evidence, current anchored run, freshness, duplicate control, and valid failure drills.");
