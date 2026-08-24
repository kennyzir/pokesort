import assert from "node:assert/strict";
import { compareSamples, evidencePath, normalizeSample, parseArgs, runShadowCapture } from "./capture-official.mjs";
import { markPublished } from "./mark-published.mjs";
import { inspectManifest } from "./verify-manifest.mjs";

const sample = (overrides = {}) => ({
  capturedAt: "2026-08-24T01:08:00.000Z",
  source: { url: "https://pokelike.xyz/pokesort", status: 200, date: "Mon, 24 Aug 2026 01:08:00 GMT", etag: '"html"', bodyBytes: 12, bodySha256: "a".repeat(64) },
  bundle: { url: "https://pokelike.xyz/js/bundle.abc123.js", status: 200, date: "Mon, 24 Aug 2026 01:08:00 GMT", etag: '"bundle"', bodyBytes: 34, bodySha256: "b".repeat(64) },
  snapshot: {
    day: 20689,
    puzzleNumber: 54,
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
  ...overrides,
});

assert.equal(parseArgs(["--timezone", "Asia/Shanghai", "--interval-ms", "0"]).timezone, "Asia/Shanghai");
assert.throws(() => parseArgs(["--samples", "1"]), /at least 2/);
assert.throws(() => parseArgs(["--timezone", "Shanghai"]), /IANA/);

const first = sample();
const second = structuredClone(first);
second.capturedAt = "2026-08-24T01:08:02.000Z";
assert.match(compareSamples([first, second]), /^[a-f0-9]{64}$/);
const changed = structuredClone(second);
changed.snapshot.puzzleNumber = 55;
assert.throws(() => compareSamples([first, changed]), /inconsistent/);

const manifest = normalizeSample(first, "Asia/Shanghai", new Date("2026-08-24T01:09:00.000Z"));
assert.equal(manifest.status, "EXTRACTED");
assert.equal(manifest.localDate, "2026-08-24");
assert.equal(manifest.provenance.bundleSha256, "b".repeat(64));

let attempts = 0;
const successful = await runShadowCapture(
  { timezone: "Asia/Shanghai", samples: 2, intervalMs: 0, retries: 2, retryDelayMs: 0 },
  {
    chromium: {},
    captureOnce: async () => { attempts += 1; if (attempts === 1) throw new Error("transient"); return structuredClone(first); },
    delay: async () => {},
    now: () => new Date("2026-08-24T01:09:00.000Z"),
  },
);
assert.equal(successful.status, "VERIFIED");
assert.deepEqual(successful.transitions.map(({ state }) => state), ["PENDING", "EXTRACTED", "VERIFIED"]);
assert.equal(successful.verification.permutationsChecked, 720);
assert.equal(successful.manifest.status, "VERIFIED");
assert(!successful.transitions.some(({ state }) => state === "PUBLISHED"), "collector must never self-publish");
assert.match(evidencePath(successful, "shadow-root"), /Asia__Shanghai[\\/]2026-08-24/);
assert.throws(() => markPublished(successful, ""), /evidence/);
const published = markPublished(successful, "deployment receipt #example", new Date("2026-08-24T01:10:00.000Z"));
assert.equal(published.status, "PUBLISHED");
assert.equal(published.transitions.at(-1).state, "PUBLISHED");
assert.equal(successful.status, "VERIFIED", "publication command must not mutate immutable shadow evidence");
const publishedInspection = inspectManifest(published.manifest, { now: new Date("2026-08-24T01:10:00.000Z") });
assert.equal(publishedInspection.valid, true);
assert.equal(publishedInspection.publishable, true);
assert.equal(publishedInspection.freshness, "CURRENT");
assert.equal(publishedInspection.solutionCount, 1);

const tampered = structuredClone(successful);
tampered.manifest.candidates[0].name = "Tampered";
assert.throws(
  () => markPublished(tampered, "deployment receipt", new Date("2026-08-24T01:10:00.000Z")),
  /CONTENT_HASH_MISMATCH/,
);
assert.throws(
  () => markPublished(successful, "deployment receipt", new Date("2026-08-25T01:10:00.000Z")),
  /STALE_MANIFEST/,
);
for (const mutate of [
  (record) => { record.ok = false; },
  (record) => { record.transitions = []; },
  (record) => { record.consistencySha256 = "0".repeat(64); },
  (record) => { record.verification.officialSolutionCount = 2; },
  (record) => { record.verification.localSolutionCount = 0; },
  (record) => { record.verification.permutationsChecked = 719; },
]) {
  const invalid = structuredClone(successful);
  mutate(invalid);
  assert.throws(
    () => markPublished(invalid, "deployment receipt", new Date("2026-08-24T01:10:00.000Z")),
    /VERIFIED|counters|transitions|consistency/,
  );
}

const inconsistent = await runShadowCapture(
  { timezone: "Asia/Shanghai", samples: 2, intervalMs: 0, retries: 1, retryDelayMs: 0 },
  { chromium: {}, captureOnce: async () => (attempts++ % 2 ? first : changed), delay: async () => {}, now: () => new Date("2026-08-24T01:09:00.000Z") },
);
assert.equal(inconsistent.status, "BLOCKED");
assert.equal(inconsistent.transitions.at(-1).state, "BLOCKED");

const staleSample = sample({ source: { ...first.source, date: "Tue, 25 Aug 2026 01:08:00 GMT" } });
const stale = await runShadowCapture(
  { timezone: "Asia/Shanghai", samples: 2, intervalMs: 0, retries: 1, retryDelayMs: 0 },
  { chromium: {}, captureOnce: async () => structuredClone(staleSample), delay: async () => {}, now: () => new Date("2026-08-25T01:09:00.000Z") },
);
assert.equal(stale.status, "STALE");

const failed = await runShadowCapture(
  { timezone: "UTC", samples: 2, intervalMs: 0, retries: 2, retryDelayMs: 0 },
  { chromium: {}, captureOnce: async () => { throw new Error("offline"); }, delay: async () => {}, now: () => new Date("2026-08-24T01:09:00.000Z") },
);
assert.equal(failed.status, "BLOCKED");
assert.equal(failed.samples.length, 0);

console.log("Pokelike shadow capture tests passed (retry, consistency, stale, blocked, and explicit publication states).");
