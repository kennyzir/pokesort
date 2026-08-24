import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFailureDrill } from "./generate-failure-drills.mjs";

const script = fileURLToPath(new URL("./generate-failure-drills.mjs", import.meta.url));
const fixture = fileURLToPath(new URL("../../data/pokelike/fixtures/puzzle-54.verified.v1.json", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "pokesort-drills-"));
const outputDirectory = path.join(temporary, "drills");

try {
  const dryRun = spawnSync(process.execPath, [script, "--fixture", fixture, "--output-directory", outputDirectory], { encoding: "utf8" });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.simulated, true);
  assert.equal(dryPayload.records.length, 2);
  await assert.rejects(() => readdir(outputDirectory), { code: "ENOENT" }, "dry-run must not create the drill directory");

  const written = spawnSync(process.execPath, [script, "--fixture", fixture, "--output-directory", outputDirectory, "--write"], { encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  const files = (await readdir(outputDirectory)).sort();
  assert.deepEqual(files, ["acquisition_failure.simulated.v1.json", "stale_record.simulated.v1.json"]);
  for (const file of files) validateFailureDrill(JSON.parse(await readFile(path.join(outputDirectory, file), "utf8")));

  const overwrite = spawnSync(process.execPath, [script, "--fixture", fixture, "--output-directory", outputDirectory, "--write"], { encoding: "utf8" });
  assert.notEqual(overwrite.status, 0, "deterministic evidence files must not be silently overwritten");
  console.log("Pokelike failure-drill generator passed dry-run, isolated write, validation, and no-overwrite tests.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
