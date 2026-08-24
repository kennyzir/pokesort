import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectManifest } from "./verify-manifest.mjs";

const RECORD_KIND = "pokelike-readiness-drill";
const SCENARIOS = new Set(["acquisition_failure", "stale_record"]);
const EXACT_KEYS = ["schemaVersion", "recordKind", "simulated", "scenario", "createdAt", "inputManifest", "trigger", "expectedStatus", "observedStatus", "evidenceSha256"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

export function computeDrillSha256(record) {
  const core = structuredClone(record);
  delete core.evidenceSha256;
  return sha256(JSON.stringify(core));
}

function recordFor(inputManifest, scenario) {
  const common = {
    schemaVersion: 1,
    recordKind: RECORD_KIND,
    simulated: true,
    scenario,
    createdAt: inputManifest.verifiedAt,
    inputManifest: structuredClone(inputManifest),
  };
  const record = scenario === "acquisition_failure" ? {
    ...common,
    trigger: {
      kind: "controlled_offline_fixture",
      code: "SIMULATED_NETWORK_UNAVAILABLE",
      message: "Simulated acquisition failure; no network request was attempted.",
    },
    expectedStatus: "BLOCKED",
    observedStatus: "BLOCKED",
  } : {
    ...common,
    trigger: {
      kind: "controlled_clock_advance",
      evaluatedAt: new Date(new Date(inputManifest.verifiedAt).valueOf() + 48 * 3_600_000).toISOString(),
    },
    expectedStatus: "STALE",
    observedStatus: "STALE",
  };
  record.evidenceSha256 = computeDrillSha256(record);
  return record;
}

export function createFailureDrillRecords(inputManifest) {
  const inspection = inspectManifest(inputManifest, { now: new Date(inputManifest.verifiedAt) });
  if (inputManifest?.status !== "VERIFIED" || !inspection.valid || inspection.solutionCount !== 1) {
    throw new Error("Drill input must be a current, valid, unique VERIFIED fixture.");
  }
  return [...SCENARIOS].map((scenario) => recordFor(inputManifest, scenario));
}

export function validateFailureDrill(record) {
  if (!exactKeys(record, EXACT_KEYS)) throw new Error("Drill record has missing or unknown top-level properties.");
  if (record.schemaVersion !== 1 || record.recordKind !== RECORD_KIND || record.simulated !== true || !SCENARIOS.has(record.scenario)) {
    throw new Error("Drill identity or scenario is invalid.");
  }
  if (record.evidenceSha256 !== computeDrillSha256(record)) throw new Error("Drill evidence hash mismatch.");
  if (record.inputManifest?.status !== "VERIFIED") throw new Error("Drill input must remain a VERIFIED fixture.");
  const createdAt = new Date(record.createdAt);
  if (!Number.isFinite(createdAt.valueOf()) || createdAt.toISOString() !== record.createdAt) throw new Error("Drill createdAt must be canonical ISO time.");
  const inputInspection = inspectManifest(record.inputManifest, { now: createdAt });
  if (!inputInspection.valid || inputInspection.solutionCount !== 1) throw new Error("Drill input manifest failed verification.");

  if (record.scenario === "acquisition_failure") {
    if (!exactKeys(record.trigger, ["kind", "code", "message"])
      || record.trigger.kind !== "controlled_offline_fixture"
      || record.trigger.code !== "SIMULATED_NETWORK_UNAVAILABLE"
      || record.trigger.message !== "Simulated acquisition failure; no network request was attempted."
      || record.expectedStatus !== "BLOCKED" || record.observedStatus !== "BLOCKED") {
      throw new Error("Acquisition-failure drill contract mismatch.");
    }
  } else {
    if (!exactKeys(record.trigger, ["kind", "evaluatedAt"]) || record.trigger.kind !== "controlled_clock_advance"
      || record.expectedStatus !== "STALE" || record.observedStatus !== "STALE") {
      throw new Error("Stale drill contract mismatch.");
    }
    const evaluatedAt = new Date(record.trigger.evaluatedAt);
    if (!Number.isFinite(evaluatedAt.valueOf()) || evaluatedAt.toISOString() !== record.trigger.evaluatedAt) throw new Error("Stale drill evaluatedAt must be canonical ISO time.");
    const staleInspection = inspectManifest(record.inputManifest, { now: evaluatedAt });
    if (staleInspection.freshness !== "STALE" || staleInspection.solutionCount !== 1
      || !staleInspection.issues.some(({ code }) => code === "STALE_MANIFEST")) {
      throw new Error("Controlled clock advance did not produce a stale manifest.");
    }
  }
  return { scenario: record.scenario, simulated: true };
}

function parseArgs(argv) {
  const options = {
    fixture: path.resolve("data", "pokelike", "fixtures", "puzzle-54.verified.v1.json"),
    outputDirectory: path.resolve("data", "pokelike", "drills"),
    write: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") options.write = true;
    else if (arg === "--fixture") options.fixture = path.resolve(argv[++index]);
    else if (arg === "--output-directory") options.outputDirectory = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(options.fixture, "utf8"));
  const records = createFailureDrillRecords(fixture);
  for (const record of records) validateFailureDrill(record);
  if (!options.write) {
    process.stdout.write(`${JSON.stringify({ simulated: true, records }, null, 2)}\n`);
    return;
  }
  await mkdir(options.outputDirectory, { recursive: true });
  const destinations = records.map((record) => path.join(options.outputDirectory, `${record.scenario}.simulated.v1.json`));
  for (const destination of destinations) {
    try {
      await access(destination);
      throw new Error(`Refusing to overwrite existing drill evidence: ${destination}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const [index, record] of records.entries()) {
    const destination = destinations[index];
    await writeFile(destination, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${destination}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
