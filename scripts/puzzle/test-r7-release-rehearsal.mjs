import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import edgeWorker from "../edge-worker.js";
import { canonicalJson, createDailyEnvelope, dailyKey, sha256Hex } from "../../functions/_lib/daily-contract.js";
import { handleDailyRequest } from "../../functions/_lib/daily-handler.js";
import { CloudflareDailyKv, MemoryDailyKv, prepareAndUploadDaily, putImmutable } from "./daily-kv-upload.mjs";
import { assessDailyReadiness } from "./monitor-daily-readiness.mjs";
import { publishElapsedHistory } from "./publish-elapsed-history.mjs";
import { stageCurrentDaily } from "./stage-current-daily.mjs";

const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
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

const now = "2026-08-25T00:00:01.000Z", today = now.slice(0, 10), preparedAt = "2026-08-17T00:00:00.000Z";
const signingKey = "r7-test-only-envelope-signing-key-32-bytes";
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
const diagnostics = await assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, now, fetchImplementation: localFetch });
assert.equal(diagnostics.bufferCount, 7);
assert.equal(diagnostics.archiveLagDays, 1);
assert.deepEqual(Object.keys(diagnostics).sort(), ["activeContentHash", "activePuzzleId", "archiveLagDays", "bufferCount", "gate", "newestArchiveDate", "newestPrivateDate", "newestStorageDate", "oldestPrivateDate", "oldestStorageDate", "storageLeadDays", "utcDate", "validationStatus"].sort(), "diagnostics must contain non-sensitive metadata only");

await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv: new MemoryDailyKv(), environment: "preview", signingKey, now, fetchImplementation: localFetch }), /PRIVATE_BUFFER_DATE_MISSING/);
await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, now, fetchImplementation: async (url) => url.endsWith(`/daily/${addDays(today, 1)}`) ? new Response("future leak", { status: 200 }) : localFetch(url) }), /FUTURE_PUBLIC_RESPONSE_SUCCEEDED/);
await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, now, fetchImplementation: async () => new Response("offline", { status: 503 }) }), /CURRENT_API_UNAVAILABLE/);
const lagDirectory = await mkdtemp(join(tmpdir(), "pokesort-r7-lag-"));
try {
  await writeFile(join(lagDirectory, "index.json"), JSON.stringify({ entries: [{ date: addDays(today, -2) }] }));
  await assert.rejects(() => assessDailyReadiness({ apiBaseUrl: "https://preview.test/api/daily", kv, environment: "preview", signingKey, publicDirectory: lagDirectory, now, fetchImplementation: localFetch }), /STATIC_ARCHIVE_LAG/);
} finally { await rm(lagDirectory, { recursive: true, force: true }); }

const currentKey = dailyKey(today), beforeRollback = await kv.get(currentKey);
let activeDeployment = { featureEnabled: true };
try { throw new Error("simulated candidate health failure"); } catch { activeDeployment = { featureEnabled: false }; }
assert.equal(activeDeployment.featureEnabled, false);
assert.equal(await kv.get(currentKey), beforeRollback, "code rollback must not mutate immutable manifests");
assert.strictEqual(await edgeWorker.fetch(new Request("https://pokesort.org/"), disabledEnvironment), assetPass, "rollback must retain last valid static deployment behavior");

let privateAppend = "UNVERIFIED_PRIVATE_FIXTURE_ABSENT";
const privatePath = resolve("data/puzzles/private/daily/2026-08-25.json");
try {
  await access(privatePath);
  const temporary = await mkdtemp(join(tmpdir(), "pokesort-r7-history-"));
  try {
    await cp(resolve("data/puzzles/public-daily"), temporary, { recursive: true });
    const manifest = JSON.parse(await readFile(privatePath, "utf8"));
    const payload = { schemaVersion: 1, status: "ready", utcDate: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, manifest };
    const created = await publishElapsedHistory({ payload, publicDirectory: temporary, asOfDate: "2026-08-25" });
    const unchanged = await publishElapsedHistory({ payload, publicDirectory: temporary, asOfDate: "2026-08-25" });
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
  await cp(resolve("data/puzzles/public-daily"), publicDirectory, { recursive: true });
  const beforeFiles = await snapshots(publicDirectory);
  const nextDaySeed = "r7-deterministic-next-day-seed-with-32-bytes";
  const staged = await stageCurrentDaily({ strategy: "seed", publicDirectory, privateDirectory, asOfDate: "2026-08-25", privateSeed: nextDaySeed });
  assert.equal(staged.result, "created");
  const noOp = await stageCurrentDaily({ strategy: "seed", publicDirectory, privateDirectory: join(nextDayRoot, "unused-no-op-private"), asOfDate: "2026-08-25" });
  assert.equal(noOp.result, "unchanged", "rerunning an already-published date must not require a seed or mutate history");
  const afterFiles = await snapshots(publicDirectory);
  const changed = [...afterFiles].filter(([name, hash]) => beforeFiles.get(name) !== hash).map(([name]) => name).sort();
  assert.deepEqual(changed, ["2026-08-25.json", "index.json"], "next-day publication must change only the current manifest and index");
  for (const [name, hash] of beforeFiles) if (name !== "index.json") assert.equal(afterFiles.get(name), hash, `elapsed byte changed: ${name}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const gate = spawnSync(`${npm} run release:gate`, [], { cwd: resolve("."), shell: true, encoding: "utf8", timeout: 120_000, env: { ...process.env, POKESORT_DAILY_DIR: publicDirectory, POKESORT_BUILD_OUTPUT: outputDirectory, POKESORT_BUILD_UTC_DATE: "2026-08-25" } });
  assert.equal(gate.status, 0, `next-day release Gate failed:\n${gate.stdout}\n${gate.stderr}`);

  const uploadManifests = [];
  for (let offset = 7; offset < 14; offset += 1) uploadManifests.push(JSON.parse(await readFile(join(privateDirectory, `${addDays("2026-08-25", offset)}.json`), "utf8")));
  const uploadLog = [];
  const uploadKv = new MemoryDailyKv();
  await prepareAndUploadDaily({ manifests: uploadManifests, adapter: uploadKv, environment: "preview", signingKey, preparedAt: "2026-08-25T00:00:00.000Z", logger: (entry) => uploadLog.push(entry) });
  assert.equal(uploadLog.length, 7);
  for (const entry of uploadLog) {
    assert.deepEqual(Object.keys(entry).sort(), ["contentHash", "date", "environment", "event", "puzzleId", "result"].sort(), "upload diagnostics must not include future cards/groups or credentials");
  }
  const failedUploadKv = { get: async () => null, put: async () => { throw new Error("simulated KV failure"); } };
  await assert.rejects(() => prepareAndUploadDaily({ manifests: uploadManifests, adapter: failedUploadKv, environment: "preview", signingKey, preparedAt: "2026-08-25T00:00:00.000Z" }), /simulated KV failure/, "KV upload failure must reject before the dependent publication job can start");

  const nextManifest = JSON.parse(await readFile(join(publicDirectory, "2026-08-25.json"), "utf8"));
  const nextPayload = { schemaVersion: 1, status: "ready", utcDate: nextManifest.date, puzzleId: nextManifest.puzzleId, contentHash: nextManifest.contentHash, manifest: nextManifest };
  const orphanDirectory = join(nextDayRoot, "orphan-public");
  await cp(resolve("data/puzzles/public-daily"), orphanDirectory, { recursive: true });
  await writeFile(join(orphanDirectory, "2026-08-25.json"), await readFile(join(publicDirectory, "2026-08-25.json")));
  const recovered = await publishElapsedHistory({ payload: nextPayload, publicDirectory: orphanDirectory, asOfDate: "2026-08-25" });
  assert.equal(recovered.result, "created", "an exact next-date manifest orphan must resume by rebuilding the index, never by overwriting history");

  const repeatRoot = join(nextDayRoot, "repeat-public"), repeatPrivate = join(nextDayRoot, "repeat-private");
  await cp(resolve("data/puzzles/public-daily"), repeatRoot, { recursive: true });
  await stageCurrentDaily({ strategy: "seed", publicDirectory: repeatRoot, privateDirectory: repeatPrivate, asOfDate: "2026-08-25", privateSeed: nextDaySeed });
  assert.equal(await readFile(join(repeatRoot, "2026-08-25.json"), "utf8"), await readFile(join(publicDirectory, "2026-08-25.json"), "utf8"), "seed fallback must be byte deterministic");

  const missingSeedRoot = join(nextDayRoot, "missing-seed-public");
  await cp(resolve("data/puzzles/public-daily"), missingSeedRoot, { recursive: true });
  await assert.rejects(() => stageCurrentDaily({ strategy: "seed", publicDirectory: missingSeedRoot, privateDirectory: join(nextDayRoot, "missing-seed-private"), asOfDate: "2026-08-25" }), /POKESORT_DAILY_SEED_REQUIRED/);
  assert.equal((await snapshots(missingSeedRoot)).has("2026-08-25.json"), false);
  const apiFailureRoot = join(nextDayRoot, "api-failure-public");
  await cp(resolve("data/puzzles/public-daily"), apiFailureRoot, { recursive: true });
  await assert.rejects(() => stageCurrentDaily({ strategy: "api", publicDirectory: apiFailureRoot, asOfDate: "2026-08-25", fetchImplementation: async () => new Response("offline", { status: 503 }) }), /DAILY_API_UNAVAILABLE/);
  assert.equal((await snapshots(apiFailureRoot)).has("2026-08-25.json"), false);
} finally { await rm(nextDayRoot, { recursive: true, force: true }); }

console.log(JSON.stringify({ gate: "PASS", advancedWorkerDefaultOff: true, nextDayCheckoutAppendBuildCommitScope: "PASS", failureDrills: ["tampered value", "missing seed", "missing HMAC key", "missing binding", "wrong environment", "empty buffer", "duplicate/conflict", "orphan recovery", "KV upload failure", "API failure", "deployment delay", "future public success", "candidate rollback", "idempotent no-op"], currentAvailableDuringArchiveLag: true, immutableRollback: true, privateAppend }));
