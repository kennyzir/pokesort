import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTimezone } from "./capture-official.mjs";
import { validateVerifiedShadowRecord } from "./mark-published.mjs";
import { readReadinessRecords, summarizeReadiness } from "./monitor-readiness.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = argv[++index];
    else if (arg === "--existing-receipt") options.existingReceipt = argv[++index];
    else if (arg === "--timezone") options.timezone = argv[++index];
    else if (arg === "--expected-local-date") options.expectedLocalDate = argv[++index];
    else if (arg === "--receipt") options.receipt = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if ((!options.existingReceipt && (!options.input || !options.receipt))
    || (options.existingReceipt && (options.input || options.receipt))
    || !options.timezone || !options.expectedLocalDate) {
    throw new Error("Usage: (--input <verified.json> --receipt <new.json> | --existing-receipt <json>) --timezone <IANA> --expected-local-date <YYYY-MM-DD>");
  }
  assertTimezone(options.timezone);
  if (!ISO_DATE.test(options.expectedLocalDate)
    || new Date(`${options.expectedLocalDate}T00:00:00Z`).toISOString().slice(0, 10) !== options.expectedLocalDate) {
    throw new Error("--expected-local-date must be a real YYYY-MM-DD date.");
  }
  return options;
}

function expectedEvidenceDirectory(timezone, localDate) {
  return path.resolve("data", "pokelike", "shadow", timezone.replaceAll("/", "__"), localDate);
}

export async function validateNewShadowEvidence({ input, timezone, expectedLocalDate, now = new Date() }) {
  const resolvedInput = path.resolve(input);
  if (path.dirname(resolvedInput) !== expectedEvidenceDirectory(timezone, expectedLocalDate)
    || !path.basename(resolvedInput).endsWith(".verified.json")) {
    throw new Error(`Evidence path must be a .verified.json file in the ${timezone} ${expectedLocalDate} directory.`);
  }

  const record = JSON.parse(await readFile(resolvedInput, "utf8"));
  const validated = validateVerifiedShadowRecord(record);
  if (record.status !== "VERIFIED" || record.manifest.status !== "VERIFIED") {
    throw new Error("The daily collector may retain VERIFIED evidence only.");
  }
  if (record.timezone !== timezone || validated.manifest.timezone !== timezone) {
    throw new Error(`Evidence timezone must be ${timezone}.`);
  }
  if (validated.manifest.localDate !== expectedLocalDate) {
    throw new Error(`Evidence local date ${validated.manifest.localDate} does not match scheduled date ${expectedLocalDate}.`);
  }
  if (record.samples.length !== 2) throw new Error("Scheduled evidence must retain exactly two consistent official samples.");
  if (validated.verifiedAt > now || now - validated.verifiedAt > 26 * 3_600_000) {
    throw new Error("Scheduled evidence is future-dated or older than the 26-hour freshness limit.");
  }
  return { record, validated, resolvedInput };
}

export async function createReadinessReceipt({ input, timezone, expectedLocalDate, receipt, now = new Date() }) {
  const { record, validated, resolvedInput } = await validateNewShadowEvidence({ input, timezone, expectedLocalDate, now });
  const [records, drillRecords] = await Promise.all([
    readReadinessRecords("data/pokelike/shadow"),
    readReadinessRecords("data/pokelike/drills"),
  ]);
  const readiness = summarizeReadiness(records, {
    now,
    timezone,
    expectedLatestLocalDate: expectedLocalDate,
    maxEvidenceAgeHours: 26,
    drillRecords,
  });
  if (readiness.invalidGoodRecords.length !== 0
    || readiness.invalidFailureRecords.length !== 0
    || !readiness.endsOnExpectedDate
    || !readiness.freshnessPass
    || !readiness.failureDrills.acquisitionFailureObserved
    || !readiness.failureDrills.staleFailureObserved) {
    throw new Error("Readiness monitor rejected the newly retained evidence or its audit prerequisites.");
  }

  const receiptRecord = {
    schemaVersion: 1,
    kind: "pokelike-shadow-readiness-receipt",
    captureEvidencePath: path.relative(path.resolve(), resolvedInput).replaceAll("\\", "/"),
    captureStatus: record.status,
    captureLocalDate: validated.manifest.localDate,
    captureTimezone: validated.manifest.timezone,
    contentSha256: validated.manifest.provenance.contentSha256,
    readiness,
    publicationAction: "NONE",
  };
  const resolvedReceipt = path.resolve(receipt);
  const expectedReceipt = path.resolve("data", "pokelike", "readiness", timezone.replaceAll("/", "__"), `${expectedLocalDate}.json`);
  if (resolvedReceipt !== expectedReceipt) throw new Error("Readiness receipt path does not match the scheduled timezone/date.");
  await mkdir(path.dirname(resolvedReceipt), { recursive: true });
  await writeFile(resolvedReceipt, `${JSON.stringify(receiptRecord, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return receiptRecord;
}

export async function validateExistingReadinessReceipt({ existingReceipt, timezone, expectedLocalDate }) {
  const resolvedReceipt = path.resolve(existingReceipt);
  const expectedReceipt = path.resolve("data", "pokelike", "readiness", timezone.replaceAll("/", "__"), `${expectedLocalDate}.json`);
  if (resolvedReceipt !== expectedReceipt) throw new Error("Existing readiness receipt path does not match the scheduled timezone/date.");
  const receipt = JSON.parse(await readFile(resolvedReceipt, "utf8"));
  if (receipt?.schemaVersion !== 1
    || receipt.kind !== "pokelike-shadow-readiness-receipt"
    || receipt.captureStatus !== "VERIFIED"
    || receipt.captureLocalDate !== expectedLocalDate
    || receipt.captureTimezone !== timezone
    || receipt.publicationAction !== "NONE"
    || !/^[a-f0-9]{64}$/.test(receipt.contentSha256 ?? "")) {
    throw new Error("Existing readiness receipt has an invalid identity or publication state.");
  }
  const readiness = receipt.readiness;
  if (readiness?.timezone !== timezone
    || readiness.expectedLatestLocalDate !== expectedLocalDate
    || !readiness.endsOnExpectedDate
    || !readiness.freshnessPass
    || !["BLOCKED", "PASS"].includes(readiness.localGate)
    || readiness.invalidGoodRecords?.length !== 0
    || readiness.invalidFailureRecords?.length !== 0
    || !readiness.failureDrills?.acquisitionFailureObserved
    || !readiness.failureDrills?.staleFailureObserved) {
    throw new Error("Existing readiness receipt does not contain an accepted monitor result.");
  }
  const evidencePath = path.resolve(receipt.captureEvidencePath ?? "");
  const evaluatedAt = new Date(readiness.evaluatedAt);
  if (!Number.isFinite(evaluatedAt.valueOf())) throw new Error("Existing readiness receipt has an invalid evaluation instant.");
  const { validated } = await validateNewShadowEvidence({
    input: evidencePath,
    timezone,
    expectedLocalDate,
    now: evaluatedAt,
  });
  if (validated.manifest.provenance.contentSha256 !== receipt.contentSha256) {
    throw new Error("Existing readiness receipt content hash does not match its evidence.");
  }
  return receipt;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.existingReceipt) {
      const receipt = await validateExistingReadinessReceipt(options);
      process.stdout.write(`${JSON.stringify({ localDate: receipt.captureLocalDate, existingReceipt: "VALID", publicationAction: receipt.publicationAction })}\n`);
      return;
    }
    const receipt = await createReadinessReceipt({ ...options, now: new Date() });
    process.stdout.write(`${JSON.stringify({
      captureStatus: receipt.captureStatus,
      localDate: receipt.captureLocalDate,
      consecutiveVerifiedDays: receipt.readiness.consecutiveVerifiedDays,
      localGate: receipt.readiness.localGate,
      publicationAction: receipt.publicationAction,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
