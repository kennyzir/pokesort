import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertTimezone, localDateAt } from "./capture-official.mjs";
import { validateVerifiedShadowRecord } from "./mark-published.mjs";
import { validateFailureDrill } from "./generate-failure-drills.mjs";

const GOOD = new Set(["VERIFIED", "PUBLISHED"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const recordStatus = (record) => record?.status ?? record?.manifest?.status ?? "UNKNOWN";
function consecutiveRunEndingAt(dates, expectedLatestLocalDate) {
  const available = new Set(dates);
  const cursor = new Date(`${expectedLatestLocalDate}T00:00:00Z`);
  let run = 0;
  while (available.has(cursor.toISOString().slice(0, 10))) {
    run += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return run;
}

export function summarizeReadiness(records, {
  now = new Date(),
  timezone = "Asia/Shanghai",
  expectedLatestLocalDate = localDateAt(now, timezone),
  maxEvidenceAgeHours = 26,
  drillRecords = [],
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new TypeError("now must be a valid Date");
  assertTimezone(timezone);
  if (!ISO_DATE.test(expectedLatestLocalDate) || new Date(`${expectedLatestLocalDate}T00:00:00Z`).toISOString().slice(0, 10) !== expectedLatestLocalDate) throw new TypeError("expectedLatestLocalDate must be a real YYYY-MM-DD date");
  if (!Number.isFinite(maxEvidenceAgeHours) || maxEvidenceAgeHours <= 0) throw new TypeError("maxEvidenceAgeHours must be positive");

  const statuses = {}, validGood = [], invalidGoodRecords = [];
  const validAcquisitionFailures = [], validStaleFailures = [], invalidFailureRecords = [];
  for (const [index, record] of records.entries()) {
    const status = recordStatus(record);
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (GOOD.has(status)) {
      try {
        const evidence = validateVerifiedShadowRecord(record);
        if (evidence.manifest.timezone !== timezone) throw new Error(`record timezone ${evidence.manifest.timezone} does not match monitored timezone ${timezone}`);
        validGood.push({ index, localDate: evidence.manifest.localDate, verifiedAt: evidence.verifiedAt });
      } catch (error) {
        invalidGoodRecords.push({ index, status, reason: error.message });
      }
    }
  }

  const drillStatusCounts = {};
  for (const [index, record] of drillRecords.entries()) {
    const scenario = record?.scenario ?? "UNKNOWN";
    drillStatusCounts[scenario] = (drillStatusCounts[scenario] ?? 0) + 1;
    try {
      const validated = validateFailureDrill(record);
      if (validated.scenario === "acquisition_failure") validAcquisitionFailures.push(index);
      else if (validated.scenario === "stale_record") validStaleFailures.push(index);
    } catch (error) {
      invalidFailureRecords.push({ index, scenario, reason: error.message });
    }
  }

  const dateCounts = {};
  for (const record of validGood) dateCounts[record.localDate] = (dateCounts[record.localDate] ?? 0) + 1;
  const duplicateGoodDates = Object.entries(dateCounts).filter(([, count]) => count > 1).map(([date, count]) => ({ date, count }));
  const goodDates = Object.keys(dateCounts);
  const consecutiveVerifiedDays = consecutiveRunEndingAt(goodDates, expectedLatestLocalDate);
  const latest = [...validGood].sort((left, right) => right.verifiedAt - left.verifiedAt)[0]?.verifiedAt ?? null;
  const latestEvidenceAgeHours = latest ? Math.round(((now - latest) / 3_600_000) * 100) / 100 : null;
  const freshnessPass = latestEvidenceAgeHours !== null && latestEvidenceAgeHours >= 0 && latestEvidenceAgeHours <= maxEvidenceAgeHours;
  const endsOnExpectedDate = goodDates.includes(expectedLatestLocalDate);
  const failureDrills = {
    acquisitionFailureObserved: validAcquisitionFailures.length > 0,
    staleFailureObserved: validStaleFailures.length > 0,
    validAcquisitionFailureRecords: validAcquisitionFailures.length,
    validStaleFailureRecords: validStaleFailures.length,
  };
  const localGatePass = consecutiveVerifiedDays >= 7 && endsOnExpectedDate && freshnessPass
    && failureDrills.acquisitionFailureObserved && failureDrills.staleFailureObserved
    && invalidGoodRecords.length === 0 && invalidFailureRecords.length === 0;

  return {
    schemaVersion: 2,
    evaluatedAt: now.toISOString(),
    timezone,
    expectedLatestLocalDate,
    maxEvidenceAgeHours,
    recordCount: records.length,
    statusCounts: Object.fromEntries(Object.entries(statuses).sort()),
    drillRecordCount: drillRecords.length,
    drillStatusCounts: Object.fromEntries(Object.entries(drillStatusCounts).sort()),
    validEvidenceBackedGoodRecords: validGood.length,
    invalidGoodRecords,
    duplicateGoodDates,
    latestEvidenceAt: latest?.toISOString() ?? null,
    latestEvidenceAgeHours,
    freshnessPass,
    endsOnExpectedDate,
    consecutiveVerifiedDays,
    requiredConsecutiveVerifiedDays: 7,
    failureDrills,
    invalidFailureRecords,
    taskCompletionSignals: { hintProgression: "pokelike_today_hint_open", answerCompletion: "pokelike_today_answer_reveal", officialHandoff: "pokelike_today_official_click" },
    externalEvidence: { ga4ObservedEvents: "UNVERIFIED", gscQueryByPage: "UNVERIFIED", fieldPerformance: "UNVERIFIED" },
    localGate: localGatePass ? "PASS" : "BLOCKED",
  };
}

async function jsonFiles(directory) {
  const files = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) files.push(...await jsonFiles(path));
      else if (entry.name.endsWith(".json")) files.push(path);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return files.sort();
}

export async function readReadinessRecords(directory) {
  return Promise.all((await jsonFiles(resolve(directory))).map(async (path) => JSON.parse(await readFile(path, "utf8"))));
}

function parseCli(argv) {
  const options = { directory: "data/pokelike/shadow", drillDirectory: "data/pokelike/drills", timezone: "Asia/Shanghai", expectedLatestLocalDate: null, maxEvidenceAgeHours: 26 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--directory") options.directory = argv[++index];
    else if (arg === "--drill-directory") options.drillDirectory = argv[++index];
    else if (arg === "--timezone") options.timezone = argv[++index];
    else if (arg === "--expected-local-date") options.expectedLatestLocalDate = argv[++index];
    else if (arg === "--max-age-hours") options.maxEvidenceAgeHours = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCli(process.argv.slice(2));
  const now = new Date();
  assertTimezone(options.timezone);
  const records = await readReadinessRecords(options.directory);
  const drillRecords = await readReadinessRecords(options.drillDirectory);
  process.stdout.write(`${JSON.stringify(summarizeReadiness(records, {
    now,
    timezone: options.timezone,
    expectedLatestLocalDate: options.expectedLatestLocalDate ?? localDateAt(now, options.timezone),
    maxEvidenceAgeHours: options.maxEvidenceAgeHours,
    drillRecords,
  }), null, 2)}\n`);
}
