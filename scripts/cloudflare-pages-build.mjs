import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_EDGE_ACTIVATION_DATE, prepareCloudflareBuildHistory } from "./puzzle/cloudflare-build-history.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const asOfDate = process.env.POKESORT_BUILD_UTC_DATE || new Date().toISOString().slice(0, 10);
const activationDate = process.env.POKESORT_EDGE_DAILY_ACTIVATION_DATE || DEFAULT_EDGE_ACTIVATION_DATE;
const temporaryRoot = await mkdtemp(join(tmpdir(), "pokesort-cloudflare-build-"));

try {
  const history = await prepareCloudflareBuildHistory({
    sourceDirectory: resolve(root, "data/puzzles/public-daily"),
    outputDirectory: resolve(temporaryRoot, "public-daily"),
    asOfDate,
    activationDate,
    apiBaseUrl: process.env.POKESORT_DAILY_API_BASE_URL || "https://pokesort.org/api/daily",
  });
  console.log(JSON.stringify({ event: "cloudflare_pages_history_ready", ...history }));
  const child = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      POKESORT_DAILY_DIR: resolve(temporaryRoot, "public-daily"),
      POKESORT_BUILD_UTC_DATE: asOfDate,
      POKESORT_EDGE_DAILY: "1",
      POKESORT_EDGE_DAILY_ACTIVATION_DATE: activationDate,
    },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
