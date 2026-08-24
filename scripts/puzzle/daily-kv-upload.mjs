import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, createDailyEnvelope, dailyKey, isUtcDate, MINIMUM_PRELOAD_DAYS } from "../../functions/_lib/daily-contract.js";
import { loadCategoryModel } from "./category-model.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";

export const KV_IMMUTABILITY_MODEL = "single-writer read-before-write guard; Cloudflare KV does not provide atomic compare-and-swap";

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export class MemoryDailyKv {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  async get(key) { return this.values.has(key) ? this.values.get(key) : null; }
  async put(key, value) { this.values.set(key, value); }
}

export class CloudflareDailyKv {
  constructor({ accountId, namespaceId, apiToken, fetchImplementation = fetch }) {
    if (!accountId || !namespaceId || !apiToken) throw new Error("CLOUDFLARE_ADMIN_CONFIGURATION_REQUIRED");
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}/values/`;
    this.apiToken = apiToken;
    this.fetchImplementation = fetchImplementation;
  }
  async request(key, method, body) {
    const response = await this.fetchImplementation(`${this.baseUrl}${encodeURIComponent(key)}`, {
      method,
      headers: { authorization: `Bearer ${this.apiToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body,
    });
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok) throw new Error(`CLOUDFLARE_KV_${method}_FAILED:${response.status}`);
    return method === "GET" ? response.text() : undefined;
  }
  async get(key) { return this.request(key, "GET"); }
  async put(key, value) { await this.request(key, "PUT", value); }
}

export async function putImmutable(adapter, key, value) {
  const existing = await adapter.get(key);
  if (existing !== null && existing !== undefined) {
    if (existing !== value) throw new Error(`IMMUTABLE_KEY_CONFLICT:${key}`);
    return "unchanged";
  }
  await adapter.put(key, value);
  const observed = await adapter.get(key);
  if (observed !== value) throw new Error(`KV_WRITE_VERIFICATION_FAILED:${key}`);
  return "created";
}

export async function validateManifestForUpload(manifest) {
  verifyCanonicalHash(manifest, { label: `Daily upload ${manifest?.date}`, excludedKeys: ["contentHash", "puzzleId"] });
  const model = await loadCategoryModel();
  verifyPuzzleSemantics(manifest, { model, ruleEvidence: buildCanonicalRuleEvidence(model), context: `Daily upload ${manifest.date}` });
  if (manifest.quality?.accepted !== true) throw new Error(`QUALITY_NOT_ACCEPTED:${manifest.date}`);
  if (/(?:sourceSeed|productionSeed|calendarSeed|privateSeed|"seed"\s*:)/i.test(JSON.stringify(manifest))) throw new Error(`PRIVATE_DERIVATION_MATERIAL:${manifest.date}`);
  return true;
}

export async function prepareAndUploadDaily({
  manifests,
  adapter,
  environment,
  signingKey,
  preparedAt = new Date().toISOString(),
  minimumPreloadDays = MINIMUM_PRELOAD_DAYS,
  minimumCount = MINIMUM_PRELOAD_DAYS,
  logger = () => {},
}) {
  if (!Number.isSafeInteger(minimumPreloadDays) || minimumPreloadDays < MINIMUM_PRELOAD_DAYS) throw new Error(`MINIMUM_PRELOAD_POLICY_VIOLATION:${MINIMUM_PRELOAD_DAYS}`);
  if (!Number.isSafeInteger(minimumCount) || minimumCount < MINIMUM_PRELOAD_DAYS) throw new Error(`MINIMUM_BUFFER_POLICY_VIOLATION:${MINIMUM_PRELOAD_DAYS}`);
  if (!Array.isArray(manifests) || manifests.length < minimumCount) throw new Error(`BUFFER_DEPTH_BELOW_MINIMUM:${minimumCount}`);
  if (typeof signingKey !== "string" || Buffer.byteLength(signingKey, "utf8") < 32) throw new Error("ENVELOPE_SIGNING_KEY_REQUIRED");
  const preparedTime = new Date(preparedAt).getTime();
  if (!Number.isFinite(preparedTime)) throw new Error("INVALID_PREPARED_AT");
  const preparedDate = new Date(preparedTime).toISOString().slice(0, 10);
  const minimumDate = addDays(preparedDate, minimumPreloadDays);
  const dates = manifests.map(({ date }) => date).sort();
  if (dates.some((date) => !isUtcDate(date) || new Date(`${date}T00:00:00.000Z`).getTime() - preparedTime < minimumPreloadDays * 86_400_000)) throw new Error(`PRELOAD_WINDOW_TOO_SHORT:${minimumDate}`);
  for (let index = 1; index < dates.length; index += 1) if (dates[index] !== addDays(dates[index - 1], 1)) throw new Error(`BUFFER_DATE_GAP:${dates[index - 1]}:${dates[index]}`);
  const prepared = [];
  for (const manifest of [...manifests].sort((a, b) => a.date.localeCompare(b.date))) {
    const manifestSnapshot = JSON.parse(canonicalJson(manifest));
    await validateManifestForUpload(manifestSnapshot);
    const envelope = await createDailyEnvelope(manifestSnapshot, { environment, preparedAt, signingKey });
    prepared.push({ manifest: manifestSnapshot, value: canonicalJson(envelope) });
  }
  const results = [];
  for (const { manifest, value } of prepared) {
    const result = await putImmutable(adapter, dailyKey(manifest.date), value);
    results.push({ date: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, result });
    logger({ event: "daily_kv_upload", environment, date: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, result });
  }
  return {
    schemaVersion: 1,
    environment,
    preparedAt: new Date(preparedAt).toISOString(),
    minimumPreloadDays,
    immutabilityModel: KV_IMMUTABILITY_MODEL,
    count: results.length,
    results,
  };
}

function parseArguments(argv) {
  const options = { paths: [], write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--manifest") options.paths.push(resolve(argv[++index]));
    else if (value === "--environment") options.environment = argv[++index];
    else if (value === "--prepared-at") options.preparedAt = argv[++index];
    else if (value === "--minimum-count") options.minimumCount = Number(argv[++index]);
    else if (value === "--write") options.write = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  if (!options.paths.length) throw new Error("At least one --manifest path is required; directory listing is intentionally unsupported");
  if (!["preview", "production"].includes(options.environment)) throw new Error("--environment must be preview or production");
  if (!options.write) throw new Error("Refusing external mutation without explicit --write");
  if (options.preparedAt !== undefined) {
    const suppliedPreparedAt = Date.parse(options.preparedAt);
    if (!Number.isFinite(suppliedPreparedAt) || Math.abs(Date.now() - suppliedPreparedAt) > 300_000) throw new Error("CLI_PREPARED_AT_OUTSIDE_TOLERANCE");
  }
  options.preparedAt = new Date().toISOString();
  const prefix = options.environment === "production" ? "POKESORT_PRODUCTION" : "POKESORT_PREVIEW";
  const adapter = new CloudflareDailyKv({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    namespaceId: process.env[`${prefix}_DAILY_KV_NAMESPACE_ID`],
    apiToken: process.env.CLOUDFLARE_DAILY_KV_API_TOKEN,
  });
  const manifests = await Promise.all(options.paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const receipt = await prepareAndUploadDaily({
    ...options,
    manifests,
    adapter,
    signingKey: process.env[`${prefix}_DAILY_ENVELOPE_HMAC_KEY`],
    logger: (entry) => console.log(JSON.stringify(entry)),
  });
  console.log(JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    environment: receipt.environment,
    preparedAt: receipt.preparedAt,
    minimumPreloadDays: receipt.minimumPreloadDays,
    immutabilityModel: receipt.immutabilityModel,
    count: receipt.count,
  }));
}
