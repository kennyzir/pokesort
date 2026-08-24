import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicHistoryIndex, validatePublicDailyHistory } from "./public-daily-history.mjs";
import { sha256 } from "./stable.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const sourceDirectory = resolve(root, "data/puzzles/daily");
const outputDirectory = resolve(root, "data/puzzles/public-daily");
const asOfDate = process.env.POKESORT_PUBLICATION_DATE || new Date().toISOString().slice(0, 10);
const sourceIndex = JSON.parse(await readFile(resolve(sourceDirectory, "index.json"), "utf8"));
const entries = sourceIndex.entries.filter(({ date }) => date <= asOfDate);
if (!entries.length) throw new Error(`No elapsed Daily manifests through ${asOfDate}`);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const publicEntries = [];
for (const entry of entries) {
  const manifest = JSON.parse(await readFile(resolve(sourceDirectory, entry.file), "utf8"));
  delete manifest.sourceSeed;
  const board = {
    schemaVersion: manifest.puzzleSchemaVersion,
    generatorVersion: manifest.generatorVersion,
    factsSchemaVersion: manifest.factsSchemaVersion,
    datasetId: manifest.datasetId,
    categoryModelId: manifest.categoryModelId,
    boardSignature: manifest.boardSignature,
    cards: manifest.cards,
    groups: manifest.groups,
    solver: manifest.solver,
    difficulty: manifest.difficulty,
    generationAudit: { acceptedOnAttempt: manifest.generationAudit.acceptedOnAttempt },
  };
  manifest.boardContentHash = sha256(board);
  const { puzzleId: _oldPuzzleId, contentHash: _oldContentHash, ...base } = manifest;
  manifest.contentHash = sha256(base);
  manifest.puzzleId = `daily-${manifest.date}-${manifest.contentHash.slice(0, 16)}`;
  await writeFile(resolve(outputDirectory, entry.file), `${JSON.stringify(manifest, null, 2)}\n`);
  publicEntries.push({ ...entry, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, boardContentHash: manifest.boardContentHash });
}
await writeFile(resolve(outputDirectory, "index.json"), `${JSON.stringify(publicHistoryIndex(publicEntries), null, 2)}\n`);
const result = await validatePublicDailyHistory({ directory: outputDirectory, asOfDate });
console.log(JSON.stringify({ gate: "PASS", outputDirectory, elapsedManifests: result.dates.length, oldestDate: result.oldestDate, newestDate: result.newestDate }, null, 2));
