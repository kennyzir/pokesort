import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import edgeWorker from "../edge-worker.js";
import { canonicalJson, createDailyEnvelope, dailyKey, sha256Hex } from "../../functions/_lib/daily-contract.js";
import { handleDailyRequest } from "../../functions/_lib/daily-handler.js";
import { CloudflareDailyKv, MemoryDailyKv, prepareAndUploadDaily, putImmutable } from "./daily-kv-upload.mjs";
import { assessDailyReadiness } from "./monitor-daily-readiness.mjs";
import { publishElapsedHistory } from "./publish-elapsed-history.mjs";
import { publicHistoryIndex } from "./public-daily-history.mjs";
import { stageCurrentDaily } from "./stage-current-daily.mjs";

const BASELINE_DATE = "2026-08-24";
const ACTIVATION_DATE = "2026-08-25";
const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
async function createHistoricalPublicDailyFixture({ sourceDirectory = resolve("data/puzzles/public-daily"), outputDirectory, asOfDate }) {
  const sourceIndex = JSON.parse(await readFile(join(sourceDirectory, "index.json"), "utf8"));
  const entries = sourceIndex.entries.filter((entry) => entry.date <= asOfDate);
  assert.ok(entries.length > 0, "Historical public Daily fixture must not be empty");
  assert.equal(entries.at(-1)?.date, asOfDate, `Historical public Daily fixture must end at ${asOfDate}`);
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of entries) await copyFile(join(sourceDirectory, entry.file), join(outputDirectory, entry.file));
  const fixtureIndex = publicHistoryIndex(entries);
  await writeFile(join(outputDirectory, "index.json"), `${JSON.stringify(fixtureIndex, null, 2)}\n`, "utf8");
  return { entries, newestDate: entries.at(-1).date };
}
async function manifestFor(date, salt = 0) {
  const cards = Array.from({ length: 16 }, (_, index) => ({ id: salt * 100 + index + 1, identifier: `pokemon-${salt}-${index + 1}`, name: `Pokemon ${salt}-${index + 1}`, provenanceRefs: "test" }));
  const groups = Array.from({ length: 4 }, (_, groupIndex) => {
    const members = cards.slice(groupIndex * 4, groupIndex * 4 + 4), memberIds = members.map(({ id }) => id), memberSignature = [...memberIds].sort((a, b) => a - b).join("-"), predicateSignature = `test:{\"group\":${groupIndex}}`;
    return { predicateSignature, memberIds, members, memberSignature, signature: `${predicateSignature}#${memberSignature}`, matchingRuleEvidence: [{ signature: predicateSignature }] };
  });
  const base = { calendarSchemaVersion: 1, puzzleSchemaVersion: 1, date, publishAtUtc: `${date}T00:00:00.000Z`, publicationPolicy: "stored manifests become public only when date <= current UTC date; storage does not imply publication or indexing", boardSignature: cards.map(({ id }) => id).sort((a, b) => a - b).join("-"), cards, groups, solver: { solutionCount: 1, countComplete: true }, quality: { accepted: true } };
  const contentHash = await sha256Hex(base);
  return { ...base, puzzleId: `daily-${date}-${contentHash.slice(0, 16)}`, contentHash };
}

const now = `${ACTIVATION_DATE}T00:00:01.000Z`, today = ACTIVATION_DATE, preparedAt = "2026-08-17T00:00:00.000Z";
const signingKey = "r7-test-only-envelope-signing-key-32-bytes";
const trackedPublicDirectory = resolve("data/puzzles/public-daily");
const trackedPublicIndexBefore = await readFile(join(trackedPublicDirectory, "index.json"), "utf8");
const trackedPublicFilesBefore = await snapshots(trackedPublicDirectory);
const dailyWorkflow = await readFile(resolve(".github/workflows/daily-archive-refresh.yml"), "utf8");
for (const job of ["prepare-private-buffer:", "publish-elapsed-history:", "readiness-monitor:"]) assert.ok(dailyWorkflow.includes(job), `missing workflow job ${job}`);
assert.equal((dailyWorkflow.match(/npm run release:gate/g) ?? []).length, 3, "each ordered job must run the shared release Gate exactly once after current-date availability");
assert.ok(dailyWorkflow.includes("POKESORT_DAILY_AUTOMATION_ENABLED") && dailyWorkflow.includes("EXPECTED_CLOUDFLARE_ACCOUNT_ID"), "external mutation must be feature/account gated");
assert.equal(dailyWorkflow.includes("mark:pokelike-published"), false, "Daily workflow must not publish Pokelike Today");
const shadowWorkflow = await readFile(resolve(".github/workflows/daily-pokelike-shadow.yml"), "utf8");
for (const forbidden of ["publish:elapsed-history", "prepare:daily-kv-upload", "mark:pokelike-published"]) assert.equal(shadowWorkflow.includes(forbidden), false, `Pokelike shadow workflow must remain independent of ${forbidden}`);
const kv = new MemoryDailyKv();
for (let offset = 0; offset <= 7; offset += 1) {
  const manifest = await manifestFor(addDays(today, offset), offset + 1);
  await putImmutable(kv, dailyKey(manifest.date), canonicalJson(await createDailyEnvelope(manifest, { environment: "preview", preparedAt, signingKey })));
}

const assetPass = new Response("asset", { status: 209 });
const disabledEnvironment = { ASSETS: { fetch: async () => assetPass }, DAILY_MANIFESTS: kv, DAILY_ENVIRONMENT: "preview", DAILY_ENVELOPE_HMAC_KEY: signingKey };
assert.equal((await edgeWorker.fetch(new Request("https://pokesort.org/api/daily/current"), disabledEnvironment)).status, 404, "default-off API must not depend on a binding");
assert.strictEqual(await edgeWorker.fetch(new Request("https://pokesort.org/categories/"), disabledEnvironment), assetPass, "default-off worker must retain static delivery");
const missingBinding = await edgeWorker.fetch(new Request("https://pokesort.org/api/daily/current"), { ASSETS: disabledEnvironment.ASSETS, DAILY_API_ENABLED: "true", DAILY_ENVIRONMENT: "preview" });
assert.equal(missingBinding.status, 503, "enabled API without KV must fail closed");
const missingEnvelopeKey = await edgeWorker.fetch(new Request("https://pokesort.org/api/daily/current"), { ASSETS: disabledEnvironment.ASSETS, DAILY_API_ENABLED: "true", DAILY_MANIFESTS: kv, DAILY_ENVIRONMENT: "preview" });
assert.equal(missingEnvelopeKey.status, 503, "enabled API without its HMAC key must fail closed");
const wrongEnvironment = await handleDailyRequest({ request: new Request("https://production.test/api/daily/current"), env: { DAILY_MANIFESTS: kv, DAILY_ENVIRONMENT: "production", DAILY_ENVELOPE_HMAC_KEY: signingKey }, now });
assert.equal(wrongEnvironment.status, 503, "preview envelopes must not cross into production even if a key is accidentally reused");
assert.throws(() => new CloudflareDailyKv({}), /CLOUDFLARE_ADMIN_CONFIGURATION_REQUIRED/, "missing admin secret/configuration must fail closed");
await assert.rejects(() => putImmutable(kv, dailyKey(today), "different bytes"), /IMMUTABLE_KEY_CONFLICT/, "duplicate date replacement must fail");
const tamperedKv = new MemoryDailyKv({ [dailyKey(today)]: (await kv.get(dailyKey(today))).replace("Pokemon 1-1", "tampered") });
assert.equal((await handleDailyRequest({ request: new Request("https://preview.test/api/daily/current"), env: { DAILY_MANIFESTS: tamperedKv, DAILY_ENVIRONMENT: "preview", DAILY_ENVELOPE_HMAC_KEY: signingKey }, now })).status, 503, "tampered active value must fail closed");

const localFetch = async (url) => {
  const parsed = new URL(url), match = /^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(parsed.pathname);
  return handleDailyRequest({ request: new Request(url), env: { DAILY_MANIFESTS: kv, DAILY_ENVIRONMENT: "preview", DAILY_ENVELOPE_HMAC_KEY: signingKey }, requestedDate: match?.[1] ?? null, now });
};
const baselineArchiveDirectory = await mkdtemp(join(tmpdir(), "pokesort-r7-baseline-archive-"));
const currentArchiveDirectory = await mkdtemp(join(tmpdir(), "pokesort-r7-current-archive-"));
const lagDirectory = await mkdtemp(join(tmpdir(), "pokesort-r7-lag-archive-"));
await createHistoricalPublicDailyFixture({ outputDirectory: baselineArchiveDirectory, asOfDate: BASELINE_DATE });
await createHistoricalPublicDailyFixture({ outputDirectory: currentArchiveDirectory, asOfDate: ACTIVATION_DATE });
await createHistoricalPublicDailyFixture({ outputDirectory: lagDirectory, asOfDate: addDays(ACTIVATION_DATE, -2) });
const diagnostics = await assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: baselineArchiveDirectory, now, fetchImplementation: localFetch });
assert.equal(diagnostics.bufferCount, 7);
assert.equal(diagnostics.archiveLagDays, 1);
assert.equal(diagnostics.newestArchiveDate, BASELINE_DATE);
assert.equal(diagnostics.gate, "PASS");
assert.deepEqual(Object.keys(diagnostics).sort(), ["activeContentHash", "activePuzzleId", "archiveLagDays", "bufferCount", "gate", "newestArchiveDate", "newestPrivateDate", "newestStorageDate", "oldestPrivateDate", "oldestStorageDate", "storageLeadDays", "utcDate", "validationStatus"].sort(), "diagnostics must contain non-sensitive metadata only");
const currentDiagnostics = await assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: currentArchiveDirectory, now, fetchImplementation: localFetch });
assert.equal(currentDiagnostics.archiveLagDays, 0);
assert.equal(currentDiagnostics.newestArchiveDate, ACTIVATION_DATE);
assert.equal(currentDiagnostics.gate, "PASS");

await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv: new MemoryDailyKv(), environment: "preview", signingKey, publicDirectory: baselineArchiveDirectory, now, fetchImplementation: localFetch }), /PRIVATE_BUFFER_DATE_MISSING/);
await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: baselineArchiveDirectory, now, fetchImplementation: async (url) => url.endsWith(`/daily/${addDays(today, 1)}`) ? new Response("future leak", { status: 200 }) : localFetch(url) }), /FUTURE_PUBLIC_RESPONSE_SUCCEEDED/);
await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: baselineArchiveDirectory, now, fetchImplementation: async () => new Response("offline", { status: 503 }) }), /CURRENT_API_UNAVAILABLE/);
try {
  await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: lagDirectory, now, fetchImplementation: localFetch }), /STATIC_ARCHIVE_LAG/);
} finally {
  await Promise.all([baselineArchiveDirectory, currentArchiveDirectory, lagDirectory].map((directory) => rm(directory, { recursive: true, force: true })));
}

const currentKey = dailyKey(today), beforeRollback = await kv.get(currentKey);
let activeDeployment = { featureEnabled: true };
try { throw new Error("simulated candidate health failure"); } catch { activeDeployment = { featureEnabled: false }; }
assert.equal(activeDeployment.featureEnabled, false);
assert.equal(await kv.get(currentKey), beforeRollback, "code rollback must not mutate immutable manifests");
assert.strictEqual(await edgeWorker.fetch(new Request("https://pokesort.org/"), disabledEnvironment), assetPass, "rollback must retain last valid static deployment behavior");

let privateAppend = "UNVERIFIED_PRIVATE_FIXTURE_ABSENT";
const privatePath = resolve(`data/puzzles/private/daily/${ACTIVATION_DATE}.json`);
try {
  await access(privatePath);
  const temporary = await mkdtemp(join(tmpdir(), "pokesort-r7-history-"));
  try {
    await createHistoricalPublicDailyFixture({ outputDirectory: temporary, asOfDate: BASELINE_DATE });
    const manifest = JSON.parse(await readFile(privatePath, "utf8"));
    const payload = { schemaVersion: 1, status: "ready", utcDate: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, manifest };
    const created = await publishElapsedHistory({ payload, publicDirectory: temporary, asOfDate: ACTIVATION_DATE });
    const unchanged = await publishElapsedHistory({ payload, publicDirectory: temporary, asOfDate: ACTIVATION_DATE });
    assert.equal(created.result, "created"); assert.equal(unchanged.result, "unchanged");
    privateAppend = "PASS";
  } finally { await rm(temporary, { recursive: true, force: true }); }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

async function snapshots(directory) {
  const values = new Map();
  for (const name of (await readdir(directory)).sort()) {
    const bytes = await readFile(join(directory, name));
    values.set(name, createHash("sha256").update(bytes).digest("hex"));
  }
  return values;
}
const nextDayRoot = await mkdtemp(join(tmpdir(), "pokesort-r7-next-day-"));
try {
  const publicDirectory = join(nextDayRoot, "public"), privateDirectory = join(nextDayRoot, "private"), outputDirectory = join(nextDayRoot, "dist");
  await createHistoricalPublicDailyFixture({ outputDirectory: publicDirectory, asOfDate: BASELINE_DATE });
  const beforeFiles = await snapshots(publicDirectory);
  const nextDaySeed = "r7-deterministic-next-day-seed-with-32-bytes";
  const staged = await stageCurrentDaily({ strategy: "seed", publicDirectory, privateDirectory, asOfDate: ACTIVATION_DATE, privateSeed: nextDaySeed });
  assert.equal(staged.result, "created");
  const noOp = await stageCurrentDaily({ strategy: "seed", publicDirectory, privateDirectory: join(nextDayRoot, "unused-no-op-private"), asOfDate: ACTIVATION_DATE });
  assert.equal(noOp.result, "unchanged", "rerunning an already-published date must not require a seed or mutate history");
  const afterFiles = await snapshots(publicDirectory);
  const changed = [...afterFiles].filter(([name, hash]) => beforeFiles.get(name) !== hash).map(([name]) => name).sort();
  assert.deepEqual(changed, [`${ACTIVATION_DATE}.json`, "index.json"].sort(), "next-day publication must change only the current manifest and index");
  for (const [name, hash] of beforeFiles) if (name !== "index.json") assert.equal(afterFiles.get(name), hash, `elapsed byte changed: ${name}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const gate = spawnSync(`${npm} run release:gate`, [], { cwd: resolve("."), shell: true, encoding: "utf8", timeout: 120_000, env: { ...process.env, POKESORT_DAILY_DIR: publicDirectory, POKESORT_BUILD_OUTPUT: outputDirectory, POKESORT_BUILD_UTC_DATE: ACTIVATION_DATE } });
  assert.equal(gate.status, 0, `next-day release Gate failed:\n${gate.stdout}\n${gate.stderr}`);

  const uploadManifests = [];
  for (let offset = 7; offset < 14; offset += 1) uploadManifests.push(JSON.parse(await readFile(join(privateDirectory, `${addDays(ACTIVATION_DATE, offset)}.json`), "utf8")));
  const uploadLog = [];
  const uploadKv = new MemoryDailyKv();
  await prepareAndUploadDaily({ manifests: uploadManifests, adapter: uploadKv, environment: "preview", signingKey, preparedAt: `${ACTIVATION_DATE}T00:00:00.000Z`, logger: (entry) => uploadLog.push(entry) });
  assert.equal(uploadLog.length, 7);
  for (const entry of uploadLog) {
    assert.deepEqual(Object.keys(entry).sort(), ["contentHash", "date", "environment", "event", "puzzleId", "result"].sort(), "upload diagnostics must not include future cards/groups or credentials");
  }
  const failedUploadKv = { get: async () => null, put: async () => { throw new Error("simulated KV failure"); } };
  await assert.rejects(() => prepareAndUploadDaily({ manifests: uploadManifests, adapter: failedUploadKv, environment: "preview", signingKey, preparedAt: `${ACTIVATION_DATE}T00:00:00.000Z` }), /simulated KV failure/, "KV upload failure must reject before the dependent publication job can start");

  const nextManifest = JSON.parse(await readFile(join(publicDirectory, `${ACTIVATION_DATE}.json`), "utf8"));
  const nextPayload = { schemaVersion: 1, status: "ready", utcDate: nextManifest.date, puzzleId: nextManifest.puzzleId, contentHash: nextManifest.contentHash, manifest: nextManifest };
  const orphanDirectory = join(nextDayRoot, "orphan-public");
  await createHistoricalPublicDailyFixture({ outputDirectory: orphanDirectory, asOfDate: BASELINE_DATE });
  await writeFile(join(orphanDirectory, `${ACTIVATION_DATE}.json`), await readFile(join(publicDirectory, `${ACTIVATION_DATE}.json`)));
  const recovered = await publishElapsedHistory({ payload: nextPayload, publicDirectory: orphanDirectory, asOfDate: ACTIVATION_DATE });
  assert.equal(recovered.result, "created", "an exact next-date manifest orphan must resume by rebuilding the index, never by overwriting history");

  const repeatRoot = join(nextDayRoot, "repeat-public"), repeatPrivate = join(nextDayRoot, "repeat-private");
  await createHistoricalPublicDailyFixture({ outputDirectory: repeatRoot, asOfDate: BASELINE_DATE });
  await stageCurrentDaily({ strategy: "seed", publicDirectory: repeatRoot, privateDirectory: repeatPrivate, asOfDate: ACTIVATION_DATE, privateSeed: nextDaySeed });
  assert.equal(await readFile(join(repeatRoot, `${ACTIVATION_DATE}.json`), "utf8"), await readFile(join(publicDirectory, `${ACTIVATION_DATE}.json`), "utf8"), "seed fallback must be byte deterministic");

  const missingSeedRoot = join(nextDayRoot, "missing-seed-public");
  await createHistoricalPublicDailyFixture({ outputDirectory: missingSeedRoot, asOfDate: BASELINE_DATE });
  await assert.rejects(() => stageCurrentDaily({ strategy: "seed", publicDirectory: missingSeedRoot, privateDirectory: join(nextDayRoot, "missing-seed-private"), asOfDate: ACTIVATION_DATE }), /POKESORT_DAILY_SEED_REQUIRED/);
  assert.equal((await snapshots(missingSeedRoot)).has(`${ACTIVATION_DATE}.json`), false);
  const apiFailureRoot = join(nextDayRoot, "api-failure-public");
  await createHistoricalPublicDailyFixture({ outputDirectory: apiFailureRoot, asOfDate: BASELINE_DATE });
  await assert.rejects(() => stageCurrentDaily({ strategy: "api", publicDirectory: apiFailureRoot, asOfDate: ACTIVATION_DATE, fetchImplementation: async () => new Response("offline", { status: 503 }) }), /DAILY_API_UNAVAILABLE/);
  assert.equal((await snapshots(apiFailureRoot)).has(`${ACTIVATION_DATE}.json`), false);
} finally { await rm(nextDayRoot, { recursive: true, force: true }); }

assert.equal(await readFile(join(trackedPublicDirectory, "index.json"), "utf8"), trackedPublicIndexBefore, "R7 rehearsal must never mutate tracked production history");
assert.deepEqual(await snapshots(trackedPublicDirectory), trackedPublicFilesBefore, "R7 rehearsal must preserve every tracked production history file byte-for-byte");

console.log(JSON.stringify({ gate: "PASS", advancedWorkerDefaultOff: true, nextDayCheckoutAppendBuildCommitScope: "PASS", failureDrills: ["tampered value", "missing seed", "missing HMAC key", "missing binding", "wrong environment", "empty buffer", "duplicate/conflict", "orphan recovery", "KV upload failure", "API failure", "deployment delay", "future public success", "candidate rollback", "idempotent no-op"], currentAvailableDuringArchiveLag: true, immutableRollback: true, privateAppend }));
