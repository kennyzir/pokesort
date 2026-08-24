import { DAILY_API_SCHEMA_VERSION, MAXIMUM_ENVELOPE_BYTES, dailyKey, inspectDailyEnvelope, inspectDailyManifest, isUtcDate, sha256Hex, utcDateFromNow } from "./daily-contract.js";

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers },
});
const unavailable = (utcDate, reason = "unavailable") => json(
  { schemaVersion: DAILY_API_SCHEMA_VERSION, status: "unavailable", utcDate, reason },
  503,
  { "cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" },
);
const notFound = (utcDate) => json(
  { schemaVersion: DAILY_API_SCHEMA_VERSION, status: "not_found", utcDate },
  404,
  { "cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" },
);

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export async function rebindDailyManifestDate(manifest, targetDate) {
  if (!isUtcDate(targetDate)) throw new Error("INVALID_REBOUND_DATE");
  const { puzzleId: _puzzleId, contentHash: _contentHash, ...sourceBase } = manifest;
  const base = { ...sourceBase, date: targetDate, publishAtUtc: `${targetDate}T00:00:00Z` };
  const contentHash = await sha256Hex(base);
  const rebound = { ...base, puzzleId: `daily-${targetDate}-${contentHash.slice(0, 16)}`, contentHash };
  const inspection = await inspectDailyManifest(rebound, targetDate);
  if (!inspection.valid) throw new Error(`INVALID_REBOUND_MANIFEST:${inspection.issues.join(",")}`);
  return rebound;
}

export async function handleDailyRequest({ request, env, requestedDate = null, now = new Date() }) {
  if (request?.method && request.method !== "GET" && request.method !== "HEAD") return json({ status: "method_not_allowed" }, 405, { allow: "GET, HEAD", "cache-control": "no-store" });
  const authoritativeDate = utcDateFromNow(now);
  if (requestedDate !== null && !isUtcDate(requestedDate)) return notFound(authoritativeDate);
  const targetDate = requestedDate ?? authoritativeDate;
  if (targetDate > authoritativeDate) return notFound(authoritativeDate);
  const activationDate = env?.POKESORT_EDGE_DAILY_ACTIVATION_DATE;
  if (activationDate !== undefined && !isUtcDate(activationDate)) return unavailable(authoritativeDate, "configuration_unavailable");
  if (activationDate && authoritativeDate < activationDate) return notFound(authoritativeDate);
  const storageLeadDays = env?.DAILY_STORAGE_LEAD_DAYS === undefined ? 0 : Number(env.DAILY_STORAGE_LEAD_DAYS);
  if (!env?.DAILY_MANIFESTS
    || !["preview", "production"].includes(env.DAILY_ENVIRONMENT)
    || typeof env.DAILY_ENVELOPE_HMAC_KEY !== "string"
    || new TextEncoder().encode(env.DAILY_ENVELOPE_HMAC_KEY).byteLength < 32
    || !Number.isSafeInteger(storageLeadDays)
    || storageLeadDays < 0
    || storageLeadDays > 30) {
    return unavailable(authoritativeDate, "configuration_unavailable");
  }
  const storageDate = addDays(targetDate, storageLeadDays);
  let raw;
  try { raw = await env.DAILY_MANIFESTS.get(dailyKey(storageDate)); }
  catch { return unavailable(authoritativeDate, "storage_unavailable"); }
  if (raw === null || raw === undefined) return targetDate === authoritativeDate ? unavailable(authoritativeDate) : notFound(authoritativeDate);
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAXIMUM_ENVELOPE_BYTES) return unavailable(authoritativeDate, "invalid_manifest");
  let envelope;
  try { envelope = JSON.parse(raw); }
  catch { return unavailable(authoritativeDate, "invalid_manifest"); }
  const inspection = await inspectDailyEnvelope(envelope, {
    expectedDate: storageDate,
    environment: env.DAILY_ENVIRONMENT,
    signingKey: env.DAILY_ENVELOPE_HMAC_KEY,
  });
  if (!inspection.valid) return unavailable(authoritativeDate, "invalid_manifest");
  let manifest;
  try { manifest = storageLeadDays === 0 ? envelope.manifest : await rebindDailyManifestDate(envelope.manifest, targetDate); }
  catch { return unavailable(authoritativeDate, "invalid_manifest"); }
  const isCurrent = targetDate === authoritativeDate;
  const headers = isCurrent
    ? { "cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store" }
    : { "cache-control": "public, max-age=31536000, immutable", "cloudflare-cdn-cache-control": "public, max-age=31536000, immutable" };
  const body = JSON.stringify({
    schemaVersion: DAILY_API_SCHEMA_VERSION,
    status: "ready",
    utcDate: targetDate,
    puzzleId: manifest.puzzleId,
    contentHash: manifest.contentHash,
    cachePolicy: isCurrent ? "server-utc-current-no-store" : "immutable-elapsed",
    manifest,
  });
  return new Response(request?.method === "HEAD" ? null : body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers } });
}
