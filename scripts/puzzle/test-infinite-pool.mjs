import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildInfinitePool } from "./build-infinite-pool.mjs";
import { validateInfinitePool } from "./validate-infinite-pool.mjs";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "pokesort-qb4-infinite-"));
assert(resolve(temporaryDirectory).startsWith(resolve(tmpdir())), "Temporary Infinite test directory escaped OS temp");

try {
  const first = await buildInfinitePool({ outputDirectory: temporaryDirectory });
  assert.deepEqual(first.writes, { created: 22, unchanged: 0, replaced: 0 });
  const second = await buildInfinitePool({ outputDirectory: temporaryDirectory });
  assert.deepEqual(second.writes, { created: 0, unchanged: 22, replaced: 0 });
  assert.deepEqual(second.outputs.map(({ contents }) => contents), first.outputs.map(({ contents }) => contents), "Infinite rerun must be byte-stable");
  const audit = await validateInfinitePool({ poolDirectory: temporaryDirectory });
  assert.equal(audit.poolSize, 1_000);
  assert.equal(audit.distinctBoards, 1_000);
  assert.equal(audit.distinctExactGroups, 4_000);
  assert.equal(audit.first500SequenceUnique, 500);
  assert.equal(audit.noRepeatSequenceRounds, 1_000);
  assert.equal(audit.solverProofsRecomputed, 1_000);
  assert.equal(audit.diversity.advertisedFamilyCoverage, 8);
  assert.ok(audit.diversity.maximumFamilyShare <= 0.4);
  assert.ok(audit.diversity.speciesCoverage >= 820);
  assert.ok(audit.diversity.maximumBoardsPerSpecies <= 50);
  assert.deepEqual(Object.keys(audit.familyExposure).sort(), ["baby", "color", "dual_type", "evolution_stage", "generation", "legendary", "mythical", "type"].sort());

  const shardPath = join(temporaryDirectory, "shard-000.json");
  const original = await readFile(shardPath, "utf8");
  const tampered = JSON.parse(original);
  tampered.puzzles[0].cards[0].name += " tampered";
  await writeFile(shardPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
  await assert.rejects(validateInfinitePool({ poolDirectory: temporaryDirectory, resolveSolverProof: false }), /content hash mismatch/);
  await assert.rejects(buildInfinitePool({ outputDirectory: temporaryDirectory }), /IMMUTABLE_POOL_MISMATCH/);

  console.log(JSON.stringify({ ...audit, byteStableRerun: true, tamperDetected: true, immutableOverwriteBlocked: true, firstBuildMilliseconds: first.timing.milliseconds }, null, 2));
  console.log("QB4 Infinite pool passed uniqueness, Daily exclusion, sequence, immutability, and solver validation.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
