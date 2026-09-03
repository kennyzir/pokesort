import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCategoryModel } from "./category-model.mjs";
import { buildRuleUniverse, canonicalMemberSignature } from "./rule-universe.mjs";
import { enumerateInducedQuartets } from "./solver.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";
import { buildInfiniteOverlapSidecars, INFINITE_OVERLAP_SOURCE_VERSION } from "./build-infinite-overlap-sidecars.mjs";

const sourceDirectory = resolve("data/puzzles/infinite");
const committedDirectory = resolve("data/puzzles/infinite-overlaps");

async function snapshot(directory) {
  const files = (await readdir(directory)).filter((name) => name === "index.json" || /^shard-\d+\.json$/.test(name)).sort();
  return new Map(await Promise.all(files.map(async (name) => [name, await readFile(resolve(directory, name))])));
}

const sourceBefore = await snapshot(sourceDirectory);
const firstOutput = await mkdtemp(join(tmpdir(), "pokesort-r3a-overlap-a-"));
const secondOutput = await mkdtemp(join(tmpdir(), "pokesort-r3a-overlap-b-"));
await buildInfiniteOverlapSidecars({ sourceDirectory, outputDirectory: firstOutput });
await buildInfiniteOverlapSidecars({ sourceDirectory, outputDirectory: secondOutput });
const [first, second, committed, sourceAfter] = await Promise.all([
  snapshot(firstOutput), snapshot(secondOutput), snapshot(committedDirectory), snapshot(sourceDirectory),
]);
assert.deepEqual([...first.keys()], [...second.keys()]);
assert.deepEqual([...first.keys()], [...committed.keys()]);
for (const name of first.keys()) {
  assert.deepEqual(first.get(name), second.get(name), `non-deterministic sidecar ${name}`);
  assert.deepEqual(first.get(name), committed.get(name), `committed sidecar is stale: ${name}`);
}
for (const name of sourceBefore.keys()) assert.deepEqual(sourceBefore.get(name), sourceAfter.get(name), `source pool changed: ${name}`);

const model = await loadCategoryModel();
const universe = buildRuleUniverse(model);
const sourceIndex = JSON.parse(sourceBefore.get("index.json").toString("utf8"));
const sidecarIndex = JSON.parse(first.get("index.json").toString("utf8"));
const { contentHash: indexHash, ...indexBase } = sidecarIndex;
assert.equal(sha256(indexBase), indexHash);
assert.equal(sidecarIndex.schemaVersion, 1);
assert.equal(sidecarIndex.sourcePoolGeneratorVersion, INFINITE_OVERLAP_SOURCE_VERSION);
assert.equal(sidecarIndex.sourcePoolContentHash, sourceIndex.contentHash);
assert.equal(sidecarIndex.puzzleCount, 1_000);
assert.equal(sidecarIndex.shards.length, sourceIndex.shards.length);

let checked = 0;
const seenPuzzleIds = new Set();
for (const sourceEntry of sourceIndex.shards) {
  const sourceShard = JSON.parse(sourceBefore.get(sourceEntry.file).toString("utf8"));
  const sidecarEntry = sidecarIndex.shards.find(({ sourceShard: name }) => name === sourceEntry.file);
  assert.ok(sidecarEntry);
  const sidecarShard = JSON.parse(first.get(sidecarEntry.file).toString("utf8"));
  const { contentHash, ...base } = sidecarShard;
  assert.equal(sha256(base), contentHash);
  assert.equal(contentHash, sidecarEntry.contentHash);
  assert.equal(sidecarShard.sourceShard, sourceEntry.file);
  assert.equal(sidecarShard.puzzles.length, sourceShard.puzzles.length);
  for (let index = 0; index < sourceShard.puzzles.length; index += 1) {
    const puzzle = sourceShard.puzzles[index];
    const sidecar = sidecarShard.puzzles[index];
    assert.equal(sidecar.puzzleId, puzzle.puzzleId);
    assert.equal(sidecar.sourceContentHash, puzzle.contentHash);
    assert.equal(seenPuzzleIds.has(sidecar.puzzleId), false);
    seenPuzzleIds.add(sidecar.puzzleId);
    const boardIds = new Set(puzzle.cards.map(({ id }) => id));
    const intended = new Set(puzzle.groups.map(({ memberSignature }) => memberSignature));
    const fresh = [...new Set(enumerateInducedQuartets([...boardIds], universe)
      .map(({ memberIds }) => canonicalMemberSignature(memberIds))
      .filter((signature) => !intended.has(signature)))]
      .sort((left, right) => left.localeCompare(right));
    assert.deepEqual(sidecar.validOverlapMemberSignatures, fresh);
    assert.equal(new Set(sidecar.validOverlapMemberSignatures).size, sidecar.validOverlapMemberSignatures.length);
    for (const signature of sidecar.validOverlapMemberSignatures) {
      const ids = signature.split("-").map(Number);
      assert.equal(ids.length, 4);
      assert.equal(new Set(ids).size, 4);
      assert.equal(signature, canonicalMemberSignature(ids));
      assert.ok(ids.every((id) => boardIds.has(id)));
      assert.equal(intended.has(signature), false);
    }
    checked += 1;
  }
}
assert.equal(checked, 1_000);
assert.equal(seenPuzzleIds.size, 1_000);
assert.equal(canonicalJson(sidecarIndex).includes("Pokemon"), false);
console.log(JSON.stringify({ gate: "PASS", puzzles: checked, shards: sidecarIndex.shards.length, deterministic: true, sourcePoolByteIdentical: true }));
