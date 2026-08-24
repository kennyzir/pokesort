import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublicationLeaks } from "./check-publication-leaks.mjs";
import { loadCategoryModel } from "./category-model.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";
import { validatePublicDailyHistory } from "./public-daily-history.mjs";
import { validateInfinitePool } from "./validate-infinite-pool.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const DEFAULT_DAILY_DIRECTORY = resolve(root, "data/puzzles/public-daily");
export const DEFAULT_INFINITE_DIRECTORY = resolve(root, "data/puzzles/infinite");

async function json(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new Error(`MALFORMED_JSON: ${path}: ${error.message}`); }
}

export async function validateManifestInputDirectory(directory, { model, ruleEvidence } = {}) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "index.json").sort();
  for (const name of names) {
    const manifest = await json(resolve(directory, name));
    verifyCanonicalHash(manifest, { label: resolve(directory, name), excludedKeys: ["contentHash", "puzzleId"] });
    verifyPuzzleSemantics(manifest, { model, ruleEvidence, context: resolve(directory, name) });
  }
  return names.length;
}

export async function runProductionDataGate({
  repoRoot = root,
  dailyDirectory = process.env.POKESORT_DAILY_DIR ? resolve(process.env.POKESORT_DAILY_DIR) : DEFAULT_DAILY_DIRECTORY,
  infiniteDirectory = process.env.POKESORT_INFINITE_DIR ? resolve(process.env.POKESORT_INFINITE_DIR) : DEFAULT_INFINITE_DIRECTORY,
  extraManifestDirectories = (process.env.POKESORT_PRIVATE_MANIFEST_DIRS ?? "").split(/[;,]/).map((value) => value.trim()).filter(Boolean).map(resolve),
  asOfDate = new Date().toISOString().slice(0, 10),
} = {}) {
  const leakAudit = checkPublicationLeaks({ repoRoot, asOfDate });
  if (leakAudit.leaks.length) throw new Error(`PUBLICATION_LEAK_GATE: ${leakAudit.leaks.map((finding) => `${finding.path} ${finding.kind}`).join("; ")}`);
  const daily = await validatePublicDailyHistory({ directory: dailyDirectory, asOfDate });
  const infinite = await validateInfinitePool({ poolDirectory: infiniteDirectory, dailyDirectory });
  const model = await loadCategoryModel();
  const ruleEvidence = buildCanonicalRuleEvidence(model);
  const extraInputs = [];
  for (const directory of extraManifestDirectories) {
    extraInputs.push({ directory, manifests: await validateManifestInputDirectory(directory, { model, ruleEvidence }) });
  }
  return { asOfDate, dailyDirectory, infiniteDirectory, daily, infinite, extraInputs, leakAudit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runProductionDataGate();
  console.log(JSON.stringify({
    gate: "PASS",
    asOfDate: result.asOfDate,
    daily: result.daily.dates.length,
    infinite: result.infinite.poolSize,
    extraManifestDirectories: result.extraInputs,
    publicationCandidatesChecked: result.leakAudit.checkedPathCount,
  }, null, 2));
}
