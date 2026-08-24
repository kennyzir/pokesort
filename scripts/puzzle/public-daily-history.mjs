import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCategoryModel } from "./category-model.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { sha256 } from "./stable.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const DEFAULT_PUBLIC_DAILY_DIRECTORY = resolve(root, "data/puzzles/public-daily");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function validDate(value) {
  return ISO_DATE.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function addDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function publicHistoryIndex(entries) {
  const base = {
    schemaVersion: 1,
    publicationPolicy: { timezone: "UTC", containsElapsedOnly: true, immutable: true },
    entries: entries.map(({ date, file, puzzleId, contentHash, boardContentHash, boardSignature, publishAtUtc }) => ({
      date, file, puzzleId, contentHash, boardContentHash, boardSignature, publishAtUtc,
    })),
  };
  return { ...base, contentHash: sha256(base) };
}

export async function validatePublicDailyHistory({
  directory = DEFAULT_PUBLIC_DAILY_DIRECTORY,
  asOfDate = new Date().toISOString().slice(0, 10),
  verifySolver = true,
  allowUnindexedFiles = false,
} = {}) {
  assert(validDate(asOfDate), `Invalid public-history as-of date: ${asOfDate}`);
  const index = JSON.parse(await readFile(resolve(directory, "index.json"), "utf8"));
  const { contentHash, ...indexBase } = index;
  assert(index.schemaVersion === 1, "Unexpected public Daily history schema");
  assert(sha256(indexBase) === contentHash, "Public Daily history index content hash mismatch");
  assert(index.publicationPolicy?.timezone === "UTC" && index.publicationPolicy?.containsElapsedOnly === true && index.publicationPolicy?.immutable === true, "Public Daily history must be immutable elapsed UTC data");
  assert(Array.isArray(index.entries) && index.entries.length > 0, "Public Daily history must contain at least one elapsed manifest");
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const indexedNames = index.entries.map(({ file }) => file);
  const indexedNameSet = new Set(indexedNames);
  const unindexedFiles = names.filter((name) => !indexedNameSet.has(name));
  assert(indexedNames.every((name) => names.includes(name)), "Public Daily history index references a missing manifest");
  if (!allowUnindexedFiles) assert(unindexedFiles.length === 0 && names.length === index.entries.length, "Public Daily history file/index count mismatch");
  const model = await loadCategoryModel();
  const ruleEvidence = buildCanonicalRuleEvidence(model);
  const manifests = [];
  const puzzleIds = new Set(), contentHashes = new Set(), boardSignatures = new Set();
  for (const [position, entry] of index.entries.entries()) {
    assert(validDate(entry.date) && entry.date <= asOfDate, `Future or invalid public Daily date: ${entry.date}`);
    assert(entry.file === `${entry.date}.json` && indexedNames[position] === entry.file, `Public Daily history gap or filename mismatch: ${entry.date}`);
    if (position > 0) assert(addDay(index.entries[position - 1].date) === entry.date, `Public Daily history is not contiguous at ${entry.date}`);
    const manifest = JSON.parse(await readFile(resolve(directory, entry.file), "utf8"));
    for (const field of ["seed", "sourceSeed", "productionSeed"]) assert(!manifest[field], `Public Daily history contains ${field}: ${entry.date}`);
    verifyCanonicalHash(manifest, { label: `Public Daily ${entry.date}`, excludedKeys: ["contentHash", "puzzleId"] });
    const solved = verifyPuzzleSemantics(manifest, { model, ruleEvidence, context: `Public Daily ${entry.date}`, verifyCompletePartition: verifySolver });
    assert(manifest.date === entry.date && Date.parse(manifest.publishAtUtc) === Date.parse(`${entry.date}T00:00:00.000Z`), `Public Daily manifest date mismatch: ${entry.date}`);
    for (const key of ["puzzleId", "contentHash", "boardContentHash", "boardSignature", "publishAtUtc"]) assert(manifest[key] === entry[key], `Public Daily index mismatch for ${entry.date}: ${key}`);
    if (verifySolver) assert(solved.partitionSignature === manifest.solver.partitionSignature && manifest.solver.solutionCount === 1, `Public Daily solver proof mismatch: ${entry.date}`);
    assert(!puzzleIds.has(manifest.puzzleId), `Public Daily history reuses puzzleId: ${manifest.puzzleId}`);
    assert(!contentHashes.has(manifest.contentHash), `Public Daily history reuses contentHash: ${manifest.contentHash}`);
    assert(!boardSignatures.has(manifest.boardSignature), `Public Daily history reuses board content: ${manifest.boardSignature}`);
    puzzleIds.add(manifest.puzzleId); contentHashes.add(manifest.contentHash); boardSignatures.add(manifest.boardSignature);
    manifests.push(manifest);
  }
  return { directory, index, manifests, dates: manifests.map(({ date }) => date), oldestDate: manifests[0].date, newestDate: manifests.at(-1).date, unindexedFiles };
}
