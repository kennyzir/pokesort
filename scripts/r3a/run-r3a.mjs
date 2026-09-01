import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pokesort-r3a-gate-"));
const temporaryDist = join(temporaryRoot, "dist");
const childTemporaryDirectory = join(temporaryRoot, "tmp");
const sidecarFixtureRoot = join(temporaryRoot, "sidecar-fixture");
await mkdir(childTemporaryDirectory, { recursive: true });
const environment = {
  ...process.env,
  POKESORT_BUILD_UTC_DATE: "2026-08-25",
  POKESORT_EDGE_DAILY: "1",
  POKESORT_BUILD_OUTPUT: temporaryDist,
  POKESORT_R3A_DIST: temporaryDist,
  POKESORT_TEST_UTC_DATE: "2026-08-25",
  TEMP: childTemporaryDirectory,
  TMP: childTemporaryDirectory,
  TMPDIR: childTemporaryDirectory,
};
const execFileAsync = promisify(execFile);

function run(script, cwd = repositoryRoot) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(repositoryRoot, script)], {
      cwd,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? accept()
      : reject(new Error(`${script} exited with ${code ?? `signal ${signal}`}`)));
  });
}

async function materializeCommittedPuzzleData() {
  const { stdout: listing } = await execFileAsync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "data/puzzles/infinite", "data/puzzles/infinite-overlaps"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const files = listing.split(/\r?\n/).filter((file) => /data\/puzzles\/infinite(?:-overlaps)?\/(?:index|shard-\d+)\.json$/.test(file));
  if (files.length !== 42) throw new Error(`Expected 42 committed Infinite data files, found ${files.length}`);
  for (const file of files) {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${file}`], { cwd: repositoryRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 });
    const destination = join(sidecarFixtureRoot, ...file.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, stdout);
  }
}

let failure;
try {
  await run("scripts/build.mjs");
  await materializeCommittedPuzzleData();
  await run("scripts/puzzle/test-infinite-overlap-sidecars.mjs", sidecarFixtureRoot);
  await run("scripts/r3a/test-r3a-static.mjs");
  await run("scripts/r3a/test-r3a-runtime.mjs");
} catch (error) {
  failure = error;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

let temporaryOutputExists = true;
try { await access(temporaryRoot); } catch { temporaryOutputExists = false; }
if (failure) throw failure;
if (temporaryOutputExists) throw new Error("R3A temporary output cleanup failed");
console.log(JSON.stringify({ gate: "PASS", fixedDate: environment.POKESORT_BUILD_UTC_DATE, committedSidecarSnapshot: true, temporaryOutputCleaned: true }));
