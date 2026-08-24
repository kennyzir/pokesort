import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const temporaryRoot = await mkdtemp(join(tmpdir(), "pokesort-r1-build-gate-"));
assert(resolve(temporaryRoot).startsWith(resolve(tmpdir())), "Temporary build Gate directory escaped OS temp");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function runBuild(environment) {
  return spawnSync(`${npm} run build`, [], {
    cwd: resolve("."),
    env: { ...process.env, ...environment },
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
  });
}

async function directoryHashes(directory) {
  const entries = new Map();
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else entries.set(relative(directory, absolute).replaceAll("\\", "/"), createHash("sha256").update(await readFile(absolute)).digest("hex"));
    }
  }
  await visit(directory);
  return [...entries].sort(([left], [right]) => left.localeCompare(right));
}

try {
  const output = join(temporaryRoot, "output");
  await mkdir(output);
  const sentinel = join(output, "preexisting.txt");
  await writeFile(sentinel, "must survive a failed pre-emission Gate\n");

  const badDaily = join(temporaryRoot, "bad-daily");
  await mkdir(badDaily);
  const dailyIndex = JSON.parse(await readFile(resolve("data/puzzles/public-daily/index.json"), "utf8"));
  dailyIndex.entries[0].boardSignature = "tampered-public-board";
  await writeFile(join(badDaily, "index.json"), `${JSON.stringify(dailyIndex)}\n`);
  const dailyFailure = runBuild({ POKESORT_BUILD_OUTPUT: output, POKESORT_DAILY_DIR: badDaily });
  assert.notEqual(dailyFailure.status, 0, "npm run build must reject a tampered Daily index");
  assert.match(`${dailyFailure.stdout}\n${dailyFailure.stderr}`, /content hash mismatch/i);
  assert.equal(await readFile(sentinel, "utf8"), "must survive a failed pre-emission Gate\n", "failed Daily Gate must not delete or partially emit dist");

  const badInfinite = join(temporaryRoot, "bad-infinite");
  await mkdir(badInfinite);
  const infiniteIndex = JSON.parse(await readFile(resolve("data/puzzles/infinite/index.json"), "utf8"));
  infiniteIndex.poolSize += 1;
  await writeFile(join(badInfinite, "index.json"), `${JSON.stringify(infiniteIndex)}\n`);
  const infiniteFailure = runBuild({ POKESORT_BUILD_OUTPUT: output, POKESORT_INFINITE_DIR: badInfinite });
  assert.notEqual(infiniteFailure.status, 0, "npm run build must reject a tampered Infinite index");
  assert.match(`${infiniteFailure.stdout}\n${infiniteFailure.stderr}`, /content hash mismatch/i);
  assert.equal(await readFile(sentinel, "utf8"), "must survive a failed pre-emission Gate\n", "failed Infinite Gate must not delete or partially emit dist");

  const cleanOutput = join(temporaryRoot, "clean-output");
  const first = runBuild({ POKESORT_BUILD_OUTPUT: cleanOutput });
  assert.equal(first.status, 0, `first clean build failed:\n${first.stdout}\n${first.stderr}`);
  const firstHashes = await directoryHashes(cleanOutput);
  const second = runBuild({ POKESORT_BUILD_OUTPUT: cleanOutput });
  assert.equal(second.status, 0, `second clean build failed:\n${second.stdout}\n${second.stderr}`);
  assert.deepEqual(await directoryHashes(cleanOutput), firstHashes, "two clean canonical builds must be byte-stable");

  console.log(JSON.stringify({
    dailyTamperRejectedByNpmBuild: true,
    infiniteTamperRejectedByNpmBuild: true,
    failedGatePreservedExistingOutput: true,
    cleanBuildFiles: firstHashes.length,
    byteStableCleanBuild: true,
  }, null, 2));
  console.log("R1 production build pre-emission Gate passed.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
