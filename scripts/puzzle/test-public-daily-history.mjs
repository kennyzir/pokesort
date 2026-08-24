import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_PUBLIC_DAILY_DIRECTORY, validatePublicDailyHistory } from "./public-daily-history.mjs";
import { publicHistoryIndex } from "./public-daily-history.mjs";

const asOfDate = new Date().toISOString().slice(0, 10);
const clean = await validatePublicDailyHistory({ asOfDate });
assert(clean.newestDate <= asOfDate);
assert(clean.dates.length >= 31);
const temporary = await mkdtemp(resolve(tmpdir(), "pokesort-public-history-"));
try {
  await cp(DEFAULT_PUBLIC_DAILY_DIRECTORY, temporary, { recursive: true });
  const indexPath = resolve(temporary, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  const future = new Date(`${asOfDate}T00:00:00.000Z`); future.setUTCDate(future.getUTCDate() + 1);
  index.entries[0].date = future.toISOString().slice(0, 10);
  await writeFile(indexPath, `${JSON.stringify(publicHistoryIndex(index.entries), null, 2)}\n`);
  await assert.rejects(() => validatePublicDailyHistory({ directory: temporary, asOfDate, verifySolver: false }), /Future or invalid public Daily date/);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Public Daily history Gate passed for ${clean.dates.length} immutable elapsed manifests with future-date rejection.`);
