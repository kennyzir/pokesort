import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { canonicalJson, createDailyEnvelope, dailyKey, inspectDailyEnvelope, sha256Hex } from "../../functions/_lib/daily-contract.js";
import { handleDailyRequest } from "../../functions/_lib/daily-handler.js";
import { CloudflareDailyKv, KV_IMMUTABILITY_MODEL, MemoryDailyKv, prepareAndUploadDaily, putImmutable, validateManifestForUpload } from "./daily-kv-upload.mjs";

const signingKey = "r4-test-only-envelope-signing-key-32-bytes";
const productionSigningKey = "r4-production-only-test-signing-key-32-bytes";
const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
async function manifestFor(date) {
  const manifest = JSON.parse(await readFile(new URL("../../data/puzzles/public-daily/2026-08-24.json", import.meta.url), "utf8"));
  manifest.date = date;
  manifest.publishAtUtc = `${date}T00:00:00Z`;
  manifest.quality = { accepted: true };
  delete manifest.puzzleId; delete manifest.contentHash;
  manifest.contentHash = await sha256Hex(manifest);
  manifest.puzzleId = `daily-${date}-${manifest.contentHash.slice(0, 16)}`;
  return manifest;
}
async function fullyRehashManifest(manifest) {
  const copy = structuredClone(manifest);
  delete copy.puzzleId; delete copy.contentHash;
  copy.contentHash = await sha256Hex(copy);
  copy.puzzleId = `daily-${copy.date}-${copy.contentHash.slice(0, 16)}`;
  return copy;
}
async function fullyRehashEnvelopeWithoutKey(envelope) {
  const copy = structuredClone(envelope);
  const authenticationTag = copy.authenticationTag;
  delete copy.authenticationTag; delete copy.envelopeHash;
  copy.envelopeHash = await sha256Hex(copy);
  copy.authenticationTag = authenticationTag;
  return copy;
}
const request = (path = "/api/daily/current", init = {}) => new Request(`https://example.test${path}`, init);
const environment = (kv, name = "preview", key = signingKey) => ({ DAILY_MANIFESTS: kv, DAILY_ENVIRONMENT: name, DAILY_ENVELOPE_HMAC_KEY: key });
const kv = new MemoryDailyKv();
const first = await manifestFor("2030-01-01"), second = await manifestFor("2030-01-02"), preparedAt = "2029-12-20T00:00:00.000Z";
for (const manifest of [first, second]) await putImmutable(kv, dailyKey(manifest.date), canonicalJson(await createDailyEnvelope(manifest, { environment: "preview", preparedAt, signingKey })));
assert.match(KV_IMMUTABILITY_MODEL, /single-writer/);
assert.match(KV_IMMUTABILITY_MODEL, /does not provide atomic compare-and-swap/);

const before = await handleDailyRequest({ request: request(), env: environment(kv), now: "2030-01-01T23:59:59.999Z" });
const after = await handleDailyRequest({ request: request(), env: environment(kv), now: "2030-01-02T00:00:00.000Z" });
assert.equal(before.status, 200); assert.equal(after.status, 200);
const beforeBody = await before.json(), afterBody = await after.json();
assert.notEqual(beforeBody.puzzleId, afterBody.puzzleId);
assert.deepEqual({ schemaVersion: afterBody.schemaVersion, utcDate: afterBody.utcDate, contentHash: afterBody.contentHash, cachePolicy: afterBody.cachePolicy }, { schemaVersion: 1, utcDate: second.date, contentHash: second.contentHash, cachePolicy: "server-utc-current-no-store" });
assert.equal(after.headers.get("cache-control"), "no-store");
assert.equal(after.headers.get("cloudflare-cdn-cache-control"), "no-store");

for (const primed of [false, true]) {
  if (primed) await handleDailyRequest({ request: request(), env: environment(kv), now: "2030-01-01T12:00:00.000Z" });
  const tomorrow = await handleDailyRequest({ request: request("/api/daily/2030-01-02"), env: environment(kv), requestedDate: "2030-01-02", now: "2030-01-01T12:00:00.000Z" });
  assert.equal(tomorrow.status, 404); assert.equal(tomorrow.headers.get("cache-control"), "no-store");
}
const staleClient = await handleDailyRequest({ request: request("/api/daily/current?date=2030-01-01", { headers: { "x-client-date": "2030-01-01" } }), env: environment(kv), now: "2030-01-02T12:00:00.000Z" });
assert.equal((await staleClient.json()).utcDate, "2030-01-02");
assert.equal((await handleDailyRequest({ request: request(), env: environment(kv), requestedDate: "2030-02-30", now: "2030-03-01T00:00:00.000Z" })).status, 404);
const elapsed = await handleDailyRequest({ request: request(), env: environment(kv), requestedDate: first.date, now: "2030-01-02T00:00:00.000Z" });
assert.match(elapsed.headers.get("cache-control"), /immutable/);

assert.equal((await handleDailyRequest({ request: request(), env: environment(new MemoryDailyKv()), now: "2030-01-01T00:00:00.000Z" })).status, 503);
const oldOnly = new MemoryDailyKv({ [dailyKey(first.date)]: await kv.get(dailyKey(first.date)) });
assert.equal((await handleDailyRequest({ request: request(), env: environment(oldOnly), now: "2030-01-02T00:00:00.000Z" })).status, 503, "a missing active key must never fall back to yesterday");
assert.equal((await handleDailyRequest({ request: request(), env: environment({ get: async () => { throw new Error("offline"); } }), now: "2030-01-01T00:00:00.000Z" })).status, 503);
const oversize = new MemoryDailyKv({ [dailyKey(first.date)]: "x".repeat(256_001) });
assert.equal((await handleDailyRequest({ request: request(), env: environment(oversize), now: "2030-01-01T00:00:00.000Z" })).status, 503);
const tampered = new MemoryDailyKv({ [dailyKey(first.date)]: (await kv.get(dailyKey(first.date))).replace('"name":"', '"name":"Tampered ') });
assert.equal((await handleDailyRequest({ request: request(), env: environment(tampered), now: "2030-01-01T00:00:00.000Z" })).status, 503);
const semanticForgery = structuredClone(first);
semanticForgery.groups[0].label = "Fabricated category";
const rehashedManifest = await fullyRehashManifest(semanticForgery);
await assert.rejects(() => validateManifestForUpload(rehashedManifest), /LABEL_MISMATCH/);
const signedEnvelope = JSON.parse(await kv.get(dailyKey(first.date)));
signedEnvelope.manifest = rehashedManifest;
signedEnvelope.puzzleId = rehashedManifest.puzzleId;
signedEnvelope.contentHash = rehashedManifest.contentHash;
const fullyRehashedForgery = await fullyRehashEnvelopeWithoutKey(signedEnvelope);
assert.equal((await inspectDailyEnvelope(fullyRehashedForgery, { expectedDate: first.date, environment: "preview", signingKey })).valid, false);
const forgedKv = new MemoryDailyKv({ [dailyKey(first.date)]: canonicalJson(fullyRehashedForgery) });
assert.equal((await handleDailyRequest({ request: request(), env: environment(forgedKv), now: "2030-01-01T00:00:00.000Z" })).status, 503, "an unkeyed full-chain rehash must fail closed");
assert.equal((await handleDailyRequest({ request: request(), env: environment(kv, "production"), now: "2030-01-01T00:00:00.000Z" })).status, 503);
assert.equal((await handleDailyRequest({ request: request(), env: environment(kv, "preview", "wrong-signing-key-that-is-at-least-32-bytes"), now: "2030-01-01T00:00:00.000Z" })).status, 503);
const productionKv = new MemoryDailyKv({
  [dailyKey(first.date)]: canonicalJson(await createDailyEnvelope(first, { environment: "production", preparedAt, signingKey: productionSigningKey })),
});
assert.equal((await handleDailyRequest({ request: request(), env: environment(productionKv, "production", productionSigningKey), now: "2030-01-01T00:00:00.000Z" })).status, 200);
assert.equal((await handleDailyRequest({ request: request(), env: environment(productionKv, "preview", signingKey), now: "2030-01-01T00:00:00.000Z" })).status, 503);
assert.equal((await handleDailyRequest({ request: request(), env: environment(kv, "production", productionSigningKey), now: "2030-01-01T00:00:00.000Z" })).status, 503);
assert.equal((await handleDailyRequest({ request: request(), env: {}, now: "2030-01-01T00:00:00.000Z" })).status, 503);
assert.equal((await handleDailyRequest({ request: request("/api/daily/current", { method: "POST" }), env: environment(kv), now: "2030-01-01T00:00:00.000Z" })).status, 405);

const preloadKv = new MemoryDailyKv(), logs = [];
const preloaded = await Promise.all(Array.from({ length: 8 }, (_, index) => manifestFor(addDays("2030-01-01", index + 7))));
const receipt = await prepareAndUploadDaily({ manifests: preloaded, adapter: preloadKv, environment: "preview", signingKey, preparedAt: "2030-01-01T00:00:00.000Z", logger: (entry) => logs.push(entry) });
assert.equal(receipt.count, 8); assert.equal(preloadKv.values.size, 8); assert.equal(logs.some((entry) => JSON.stringify(entry).includes("manifest")), false);
assert.equal(receipt.immutabilityModel, KV_IMMUTABILITY_MODEL);
assert.equal(logs.some((entry) => JSON.stringify(entry).includes(signingKey)), false);
const rejectedBatchKv = new MemoryDailyKv();
const invalidBatch = structuredClone(preloaded);
invalidBatch[1].groups[0].label = "Fabricated category";
invalidBatch[1] = await fullyRehashManifest(invalidBatch[1]);
await assert.rejects(() => prepareAndUploadDaily({ manifests: invalidBatch, adapter: rejectedBatchKv, environment: "preview", signingKey, preparedAt: "2030-01-01T00:00:00.000Z" }), /LABEL_MISMATCH/);
assert.equal(rejectedBatchKv.values.size, 0, "the full batch must pass R1 before the first write");
await assert.rejects(() => prepareAndUploadDaily({ manifests: preloaded, adapter: new MemoryDailyKv(), environment: "preview", signingKey, preparedAt: "2030-01-01T00:00:00.001Z" }), /PRELOAD_WINDOW_TOO_SHORT/);
await assert.rejects(() => prepareAndUploadDaily({ manifests: preloaded, adapter: new MemoryDailyKv(), environment: "preview", signingKey: "short", preparedAt: "2030-01-01T00:00:00.000Z" }), /ENVELOPE_SIGNING_KEY_REQUIRED/);
await assert.rejects(() => prepareAndUploadDaily({ manifests: preloaded, adapter: new MemoryDailyKv(), environment: "preview", signingKey, preparedAt: "2030-01-01T00:00:00.000Z", minimumPreloadDays: 0 }), /MINIMUM_PRELOAD_POLICY_VIOLATION/);
await assert.rejects(() => prepareAndUploadDaily({ manifests: preloaded.slice(0, 1), adapter: new MemoryDailyKv(), environment: "preview", signingKey, preparedAt: "2030-01-01T00:00:00.000Z", minimumCount: 1 }), /MINIMUM_BUFFER_POLICY_VIOLATION/);
await assert.rejects(() => putImmutable(preloadKv, dailyKey(preloaded[0].date), "different"), /IMMUTABLE_KEY_CONFLICT/);
const backdatedCli = spawnSync(process.execPath, ["scripts/puzzle/daily-kv-upload.mjs", "--environment", "preview", "--manifest", "not-read.json", "--prepared-at", "2000-01-01T00:00:00.000Z", "--write"], { cwd: process.cwd(), encoding: "utf8" });
assert.notEqual(backdatedCli.status, 0);
assert.match(`${backdatedCli.stdout}${backdatedCli.stderr}`, /CLI_PREPARED_AT_OUTSIDE_TOLERANCE/);

assert.throws(() => new CloudflareDailyKv({}), /CLOUDFLARE_ADMIN_CONFIGURATION_REQUIRED/);
assert.equal("list" in CloudflareDailyKv.prototype, false, "the admin adapter must not expose namespace listing");
const rejectedRemote = new CloudflareDailyKv({ accountId: "account", namespaceId: "namespace", apiToken: "test-token", fetchImplementation: async () => new Response("sensitive body", { status: 500 }) });
await assert.rejects(() => rejectedRemote.get(dailyKey("2030-01-08")), (error) => !error.message.includes("test-token") && !error.message.includes("sensitive body"));
console.log("Daily edge API contract PASS: authenticated R1 upload, UTC boundary, future guards, fail-closed delivery, isolated namespaces, and seven-day preload.");
