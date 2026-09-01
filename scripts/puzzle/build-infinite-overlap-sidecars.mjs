import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCategoryModel } from "./category-model.mjs";
import { buildRuleUniverse, canonicalMemberSignature } from "./rule-universe.mjs";
import { enumerateInducedQuartets } from "./solver.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";

export const INFINITE_OVERLAP_SCHEMA_VERSION = 1;
export const INFINITE_OVERLAP_SOURCE_VERSION = "qb4-infinite-pool-v2";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultSourceDirectory = resolve(moduleDirectory, "../../data/puzzles/infinite");
const defaultOutputDirectory = resolve(moduleDirectory, "../../data/puzzles/infinite-overlaps");

const bytes = (value) => `${canonicalJson(value, 2)}\n`;

function withoutContentHash(value) {
  const { contentHash, ...base } = value;
  return { contentHash, base };
}

function assertHash(value, label) {
  const { contentHash, base } = withoutContentHash(value);
  if (!/^[a-f0-9]{64}$/.test(contentHash || "") || sha256(base) !== contentHash) {
    throw new Error(`INFINITE_OVERLAP_SOURCE_HASH_MISMATCH: ${label}`);
  }
}

export function overlapSignaturesForPuzzle(puzzle, ruleUniverse) {
  const boardIds = puzzle.cards?.map(({ id }) => id) ?? [];
  if (boardIds.length !== 16 || new Set(boardIds).size !== 16 || boardIds.some((id) => !Number.isSafeInteger(id))) {
    throw new Error(`INFINITE_OVERLAP_INVALID_BOARD: ${puzzle.puzzleId || "unknown"}`);
  }
  const intended = new Set((puzzle.groups ?? []).map(({ memberSignature }) => memberSignature));
  if (intended.size !== 4 || [...intended].some((signature) => !/^\d+(?:-\d+){3}$/.test(signature))) {
    throw new Error(`INFINITE_OVERLAP_INVALID_GROUPS: ${puzzle.puzzleId || "unknown"}`);
  }
  return [...new Set(enumerateInducedQuartets(boardIds, ruleUniverse)
    .map(({ memberIds }) => canonicalMemberSignature(memberIds))
    .filter((signature) => !intended.has(signature)))]
    .sort((left, right) => left.localeCompare(right));
}

export async function buildInfiniteOverlapSidecars({
  sourceDirectory = defaultSourceDirectory,
  outputDirectory = defaultOutputDirectory,
} = {}) {
  const sourceIndex = JSON.parse(await readFile(resolve(sourceDirectory, "index.json"), "utf8"));
  assertHash(sourceIndex, "index.json");
  if (sourceIndex.poolGeneratorVersion !== INFINITE_OVERLAP_SOURCE_VERSION || sourceIndex.poolSize !== 1_000 || !Array.isArray(sourceIndex.shards)) {
    throw new Error("INFINITE_OVERLAP_UNSUPPORTED_SOURCE_INDEX");
  }

  const model = await loadCategoryModel();
  const ruleUniverse = buildRuleUniverse(model);
  const shardEntries = [];
  let puzzleCount = 0;
  await mkdir(outputDirectory, { recursive: true });

  for (const sourceEntry of sourceIndex.shards) {
    const sourceShard = JSON.parse(await readFile(resolve(sourceDirectory, sourceEntry.file), "utf8"));
    assertHash(sourceShard, sourceEntry.file);
    if (sourceShard.poolGeneratorVersion !== INFINITE_OVERLAP_SOURCE_VERSION || sourceShard.puzzles?.length !== sourceEntry.count) {
      throw new Error(`INFINITE_OVERLAP_INVALID_SOURCE_SHARD: ${sourceEntry.file}`);
    }
    const puzzles = sourceShard.puzzles.map((puzzle) => {
      if (!/^infinite-[a-f0-9]{20}$/.test(puzzle.puzzleId || "") || !/^[a-f0-9]{64}$/.test(puzzle.contentHash || "")) {
        throw new Error(`INFINITE_OVERLAP_INVALID_SOURCE_IDENTITY: ${sourceEntry.file}`);
      }
      return {
        puzzleId: puzzle.puzzleId,
        sourceContentHash: puzzle.contentHash,
        validOverlapMemberSignatures: overlapSignaturesForPuzzle(puzzle, ruleUniverse),
      };
    });
    const shardBase = {
      schemaVersion: INFINITE_OVERLAP_SCHEMA_VERSION,
      sourcePoolGeneratorVersion: INFINITE_OVERLAP_SOURCE_VERSION,
      sourceShard: sourceEntry.file,
      puzzles,
    };
    const sidecarShard = { ...shardBase, contentHash: sha256(shardBase) };
    await writeFile(resolve(outputDirectory, sourceEntry.file), bytes(sidecarShard), "utf8");
    shardEntries.push({
      file: sourceEntry.file,
      sourceShard: sourceEntry.file,
      start: sourceEntry.start,
      count: sourceEntry.count,
      contentHash: sidecarShard.contentHash,
    });
    puzzleCount += puzzles.length;
  }

  const indexBase = {
    schemaVersion: INFINITE_OVERLAP_SCHEMA_VERSION,
    sourcePoolGeneratorVersion: INFINITE_OVERLAP_SOURCE_VERSION,
    sourcePoolContentHash: sourceIndex.contentHash,
    puzzleCount,
    shards: shardEntries,
  };
  const sidecarIndex = { ...indexBase, contentHash: sha256(indexBase) };
  await writeFile(resolve(outputDirectory, "index.json"), bytes(sidecarIndex), "utf8");
  return sidecarIndex;
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : resolve(process.argv[index + 1]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildInfiniteOverlapSidecars({
    sourceDirectory: option("--source", defaultSourceDirectory),
    outputDirectory: option("--output", defaultOutputDirectory),
  });
  console.log(JSON.stringify({ gate: "PASS", puzzleCount: result.puzzleCount, shards: result.shards.length, contentHash: result.contentHash }));
}
