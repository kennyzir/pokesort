import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preparePrivateDailyBuffer } from "./prepare-private-daily-buffer.mjs";
import { DEFAULT_PUBLIC_DAILY_DIRECTORY, validatePublicDailyHistory } from "./public-daily-history.mjs";
import { publishElapsedHistory } from "./publish-elapsed-history.mjs";

const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

export async function stageCurrentDaily({
  strategy,
  publicDirectory = DEFAULT_PUBLIC_DAILY_DIRECTORY,
  privateDirectory,
  asOfDate = new Date().toISOString().slice(0, 10),
  privateSeed,
  apiUrl = "https://pokesort.org/api/daily/current",
  fetchImplementation = fetch,
} = {}) {
  if (!["seed", "api"].includes(strategy)) throw new Error("STAGE_STRATEGY_REQUIRED");
  const history = await validatePublicDailyHistory({ directory: publicDirectory, asOfDate, verifySolver: true });
  if (history.newestDate === asOfDate) return { result: "unchanged", date: asOfDate, historyDates: history.dates.length, privateDirectory: null };
  const yesterday = addDays(asOfDate, -1);
  if (history.newestDate !== yesterday) throw new Error(`PUBLIC_HISTORY_NOT_READY:expected=${yesterday}:received=${history.newestDate}`);
  let payload;
  if (strategy === "api") {
    const response = await fetchImplementation(apiUrl, { headers: { accept: "application/json", "cache-control": "no-cache" } });
    if (!response.ok) throw new Error(`DAILY_API_UNAVAILABLE:${response.status}`);
    payload = await response.json();
  } else {
    if (!privateDirectory) throw new Error("PRIVATE_TEMP_DIRECTORY_REQUIRED");
    if (typeof privateSeed !== "string" || privateSeed.length < 32) throw new Error("POKESORT_DAILY_SEED_REQUIRED");
    await preparePrivateDailyBuffer({
      elapsedDirectory: publicDirectory,
      outputDirectory: privateDirectory,
      asOfDate: yesterday,
      readyDays: 37,
      privateSeed,
      write: true,
    });
    const manifest = JSON.parse(await readFile(resolve(privateDirectory, `${asOfDate}.json`), "utf8"));
    payload = { schemaVersion: 1, status: "ready", utcDate: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, manifest };
  }
  const published = await publishElapsedHistory({ payload, publicDirectory, asOfDate, write: true });
  return { result: published.result, ...published.manifest, historyDates: published.historyDates, privateDirectory: strategy === "seed" ? privateDirectory : null };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--strategy") options.strategy = argv[++index];
    else if (value === "--public-dir") options.publicDirectory = resolve(argv[++index]);
    else if (value === "--private-dir") options.privateDirectory = resolve(argv[++index]);
    else if (value === "--as-of") options.asOfDate = argv[++index];
    else if (value === "--api-url") options.apiUrl = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await stageCurrentDaily({ ...options, privateSeed: process.env.POKESORT_DAILY_SEED });
  console.log(JSON.stringify({ gate: "PASS", result: result.result, date: result.date, puzzleId: result.puzzleId, contentHash: result.contentHash, historyDates: result.historyDates }));
}
