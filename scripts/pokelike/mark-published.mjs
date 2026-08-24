import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { compareSamples, normalizeSample } from "./capture-official.mjs";
import { inspectManifest } from "./verify-manifest.mjs";

function requireSafeManifest(manifest, expectedStatus, at) {
  const inspection = inspectManifest(manifest, { now: at });
  if (manifest?.status !== expectedStatus
    || !inspection.valid
    || !inspection.publishable
    || inspection.freshness !== "CURRENT"
    || inspection.solutionCount !== 1) {
    const codes = inspection.issues.map(({ code }) => code).join(", ") || "unsafe publication state";
    throw new Error(`${expectedStatus} manifest is not safe to serve at ${at.toISOString()}: ${codes}`);
  }
  return inspection;
}

function requireTransitionSequence(record, expectedStatus) {
  const expected = expectedStatus === "PUBLISHED"
    ? ["PENDING", "EXTRACTED", "VERIFIED", "PUBLISHED"]
    : ["PENDING", "EXTRACTED", "VERIFIED"];
  const actual = Array.isArray(record.transitions) ? record.transitions.map(({ state }) => state) : [];
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${expectedStatus} shadow transitions must be exactly ${expected.join(" -> ")}.`);
  let prior = -Infinity;
  for (const transition of record.transitions) {
    const instant = Date.parse(transition.at);
    if (!Number.isFinite(instant) || instant < prior) throw new Error(`${expectedStatus} shadow transitions must contain ordered ISO instants.`);
    prior = instant;
  }
  if (expectedStatus === "PUBLISHED") {
    const evidence = record.transitions.at(-1)?.evidence;
    if (typeof record.publicationEvidence !== "string" || record.publicationEvidence.trim() === "" || evidence !== record.publicationEvidence) {
      throw new Error("PUBLISHED shadow record must retain matching explicit publication evidence.");
    }
  }
}

export function validateVerifiedShadowRecord(record) {
  const expectedStatus = record?.status;
  if (!record || record.ok !== true || !["VERIFIED", "PUBLISHED"].includes(expectedStatus) || record.manifest?.status !== expectedStatus) {
    throw new Error("Only evidence-backed VERIFIED or PUBLISHED shadow records are valid.");
  }
  if (record.timezone !== record.manifest.timezone) throw new Error("Verified shadow record timezone must match its manifest evidence.");
  if (record.verification?.officialSolutionCount !== 1
    || record.verification?.localSolutionCount !== 1
    || record.verification?.permutationsChecked !== 720) {
    throw new Error("Verified shadow counters must record official=1, local=1, and permutationsChecked=720.");
  }
  requireTransitionSequence(record, expectedStatus);
  if (!Array.isArray(record.samples) || record.samples.length < 2) throw new Error("Verified shadow record must retain at least two official samples.");
  const consistencySha256 = compareSamples(record.samples);
  if (record.consistencySha256 !== consistencySha256) throw new Error("Verified shadow consistency hash does not match its samples.");
  const verifiedAt = new Date(record.manifest.verifiedAt);
  if (!Number.isFinite(verifiedAt.valueOf())) throw new Error("Verified shadow record has an invalid verifiedAt instant.");
  requireSafeManifest(record.manifest, expectedStatus, verifiedAt);
  const reconstructed = normalizeSample(record.samples[0], record.manifest.timezone, verifiedAt);
  const expectedManifest = { ...reconstructed, status: expectedStatus };
  if (!isDeepStrictEqual(record.manifest, expectedManifest)) throw new Error("Verified shadow manifest does not exactly reconstruct from retained first-party samples.");
  return { manifest: record.manifest, verifiedAt, consistencySha256 };
}

export function markPublished(record, publicationEvidence, at = new Date()) {
  if (!(at instanceof Date) || !Number.isFinite(at.valueOf())) throw new Error("Publication time must be a valid Date.");
  if (!record || record.status !== "VERIFIED") {
    throw new Error("Only a VERIFIED shadow record can be marked PUBLISHED.");
  }
  if (typeof publicationEvidence !== "string" || publicationEvidence.trim() === "") {
    throw new Error("Explicit publication evidence is required.");
  }
  validateVerifiedShadowRecord(record);
  requireSafeManifest(record.manifest, "VERIFIED", at);
  const published = {
    ...structuredClone(record),
    status: "PUBLISHED",
    publicationEvidence: publicationEvidence.trim(),
    transitions: [...record.transitions, { state: "PUBLISHED", at: at.toISOString(), evidence: publicationEvidence.trim() }],
    manifest: { ...record.manifest, status: "PUBLISHED" },
  };
  requireSafeManifest(published.manifest, "PUBLISHED", at);
  return published;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--input") options.input = argv[++index];
    else if (argv[index] === "--output") options.output = argv[++index];
    else if (argv[index] === "--evidence") options.evidence = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.input || !options.output || !options.evidence) throw new Error("Usage: --input <verified.json> --output <published.json> --evidence <reference>");
  if (path.resolve(options.input) === path.resolve(options.output)) throw new Error("Publication output must be a new file; the verified shadow evidence is immutable.");
  return options;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const record = JSON.parse(await readFile(options.input, "utf8"));
    const published = markPublished(record, options.evidence);
    await writeFile(options.output, `${JSON.stringify(published, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${options.output}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
