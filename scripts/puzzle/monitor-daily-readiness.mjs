import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dailyKey, inspectDailyEnvelope, MINIMUM_PRELOAD_DAYS } from "../../functions/_lib/daily-contract.js";
import { CloudflareDailyKv } from "./daily-kv-upload.mjs";

const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const dayDifference = (later, earlier) => Math.floor((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86_400_000);

export async function assessDailyReadiness({
  apiBaseUrl,
  kv,
  environment,
  signingKey,
  publicDirectory = resolve("data/puzzles/public-daily"),
  now = new Date(),
  fetchImplementation = fetch,
  minimumBufferDays = MINIMUM_PRELOAD_DAYS,
}) {
  const utcDate = new Date(now).toISOString().slice(0, 10);
  const currentResponse = await fetchImplementation(`${apiBaseUrl.replace(/\/$/, "")}/current`, { headers: { "cache-control": "no-cache", accept: "application/json" } });
  if (!currentResponse.ok) throw new Error(`CURRENT_API_UNAVAILABLE:${currentResponse.status}`);
  const current = await currentResponse.json();
  if (current.status !== "ready" || current.utcDate !== utcDate || current.puzzleId !== current.manifest?.puzzleId || current.contentHash !== current.manifest?.contentHash) throw new Error("CURRENT_API_INVALID");
  const tomorrow = addDays(utcDate, 1);
  const futureResponse = await fetchImplementation(`${apiBaseUrl.replace(/\/$/, "")}/${tomorrow}`, { headers: { "cache-control": "no-cache", accept: "application/json" } });
  if (futureResponse.status !== 404) throw new Error(`FUTURE_PUBLIC_RESPONSE_SUCCEEDED:${futureResponse.status}`);
  const bufferDates = [];
  for (let offset = 1; offset <= minimumBufferDays; offset += 1) {
    const date = addDays(utcDate, offset);
    let raw;
    try { raw = await kv.get(dailyKey(date)); }
    catch { throw new Error("PRIVATE_BUFFER_STORAGE_UNAVAILABLE"); }
    if (!raw) throw new Error(`PRIVATE_BUFFER_DATE_MISSING:${date}`);
    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { throw new Error(`PRIVATE_BUFFER_DATE_INVALID:${date}`); }
    const inspected = await inspectDailyEnvelope(envelope, { expectedDate: date, environment, signingKey });
    if (!inspected.valid) throw new Error(`PRIVATE_BUFFER_DATE_INVALID:${date}:${inspected.issues.join(",")}`);
    bufferDates.push(date);
  }
  const index = JSON.parse(await readFile(resolve(publicDirectory, "index.json"), "utf8"));
  const newestArchiveDate = index.entries.at(-1)?.date;
  const archiveLagDays = newestArchiveDate ? dayDifference(utcDate, newestArchiveDate) : Number.POSITIVE_INFINITY;
  if (archiveLagDays > 1) throw new Error(`STATIC_ARCHIVE_LAG:${archiveLagDays}`);
  return {
    gate: "PASS",
    utcDate,
    activePuzzleId: current.puzzleId,
    activeContentHash: current.contentHash,
    bufferCount: bufferDates.length,
    oldestPrivateDate: bufferDates[0],
    newestPrivateDate: bufferDates.at(-1),
    validationStatus: "PASS",
    newestArchiveDate,
    archiveLagDays,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = process.env.POKESORT_DAILY_ENVIRONMENT || "production";
  const prefix = environment === "production" ? "POKESORT_PRODUCTION" : "POKESORT_PREVIEW";
  const kv = new CloudflareDailyKv({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, namespaceId: process.env[`${prefix}_DAILY_KV_NAMESPACE_ID`], apiToken: process.env.CLOUDFLARE_DAILY_KV_API_TOKEN });
  const result = await assessDailyReadiness({
    apiBaseUrl: process.env.POKESORT_DAILY_API_BASE_URL || "https://pokesort.org/api/daily",
    kv,
    environment,
    signingKey: process.env[`${prefix}_DAILY_ENVELOPE_HMAC_KEY`],
  });
  console.log(JSON.stringify(result));
}
