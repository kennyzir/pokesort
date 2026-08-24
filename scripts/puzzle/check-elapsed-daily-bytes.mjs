import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const baselinePath = resolve(moduleDirectory, "../../data/puzzles/elapsed-daily-byte-baseline.v1.json");
const dailyDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
let checked = 0;
for (const [name, expected] of Object.entries(baseline.files)) {
  const actual = createHash("sha256").update(await readFile(resolve(dailyDirectory, name))).digest("hex");
  if (actual !== expected) throw new Error(`ELAPSED_MANIFEST_BYTE_MISMATCH: ${name}`);
  checked += 1;
}
if (checked !== baseline.fileCount) throw new Error(`Elapsed manifest baseline count mismatch: ${checked} != ${baseline.fileCount}`);
console.log(`Elapsed Daily byte Gate PASS: ${checked} manifests through ${baseline.asOfUtcDate} match immutable SHA-256 baselines.`);
