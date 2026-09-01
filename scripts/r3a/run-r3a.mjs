import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "pokesort-r3a-gate-"));
const temporaryDist = join(temporaryRoot, "dist");
const environment = {
  ...process.env,
  POKESORT_BUILD_UTC_DATE: "2026-08-25",
  POKESORT_EDGE_DAILY: "1",
  POKESORT_BUILD_OUTPUT: temporaryDist,
  POKESORT_R3A_DIST: temporaryDist,
  POKESORT_TEST_UTC_DATE: "2026-08-25",
};

function run(script) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(repositoryRoot, script)], {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? accept()
      : reject(new Error(`${script} exited with ${code ?? `signal ${signal}`}`)));
  });
}

let failure;
try {
  await run("scripts/build.mjs");
  await run("scripts/puzzle/test-infinite-overlap-sidecars.mjs");
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
console.log(JSON.stringify({ gate: "PASS", fixedDate: environment.POKESORT_BUILD_UTC_DATE, temporaryOutputCleaned: true }));
