import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCategoryModel } from "./category-model.mjs";
import { publicHistoryIndex, validatePublicDailyHistory, DEFAULT_PUBLIC_DAILY_DIRECTORY } from "./public-daily-history.mjs";
import { buildCanonicalRuleEvidence, verifyCanonicalHash, verifyPuzzleSemantics } from "./semantic-verifier.mjs";

const addDays = (value, days) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const safeFields = ({ date, puzzleId, contentHash }) => ({ date, puzzleId, contentHash });

export async function validateElapsedApiPayload(payload, { asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  if (payload?.schemaVersion !== 1 || payload?.status !== "ready" || payload?.utcDate !== payload?.manifest?.date) throw new Error("DAILY_API_PAYLOAD_INVALID");
  const manifest = payload.manifest;
  if (manifest.date > asOfDate) throw new Error(`FUTURE_MANIFEST_REJECTED:${manifest.date}`);
  if (payload.puzzleId !== manifest.puzzleId || payload.contentHash !== manifest.contentHash) throw new Error("DAILY_API_MANIFEST_MISMATCH");
  if (/(?:sourceSeed|productionSeed|calendarSeed|privateSeed|"seed"\s*:)/i.test(JSON.stringify(manifest))) throw new Error(`PRIVATE_DERIVATION_MATERIAL:${manifest.date}`);
  verifyCanonicalHash(manifest, { label: `elapsed API ${manifest.date}`, excludedKeys: ["contentHash", "puzzleId"] });
  const model = await loadCategoryModel();
  verifyPuzzleSemantics(manifest, { model, ruleEvidence: buildCanonicalRuleEvidence(model), context: `elapsed API ${manifest.date}` });
  if (manifest.quality?.accepted !== true) throw new Error(`QUALITY_NOT_ACCEPTED:${manifest.date}`);
  return manifest;
}

export async function publishElapsedHistory({
  payload,
  publicDirectory = DEFAULT_PUBLIC_DAILY_DIRECTORY,
  asOfDate = new Date().toISOString().slice(0, 10),
  write = true,
  logger = () => {},
}) {
  const manifest = await validateElapsedApiPayload(payload, { asOfDate });
  const history = await validatePublicDailyHistory({ directory: publicDirectory, asOfDate, verifySolver: true });
  const existing = history.index.entries.find(({ date }) => date === manifest.date);
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  if (existing) {
    if (existing.puzzleId !== manifest.puzzleId || existing.contentHash !== manifest.contentHash || await readFile(resolve(publicDirectory, existing.file), "utf8") !== bytes) throw new Error(`IMMUTABLE_HISTORY_CONFLICT:${manifest.date}`);
    logger({ event: "publish_elapsed_history", ...safeFields(manifest), result: "unchanged" });
    return { result: "unchanged", manifest: safeFields(manifest), historyDates: history.dates.length };
  }
  const expectedDate = addDays(history.newestDate, 1);
  if (manifest.date !== expectedDate) throw new Error(`PUBLIC_HISTORY_GAP:expected=${expectedDate}:received=${manifest.date}`);
  const entry = { date: manifest.date, file: `${manifest.date}.json`, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, boardContentHash: manifest.boardContentHash, boardSignature: manifest.boardSignature, publishAtUtc: manifest.publishAtUtc };
  if (!write) return { result: "would_create", manifest: safeFields(manifest), historyDates: history.dates.length + 1 };
  await mkdir(publicDirectory, { recursive: true });
  const manifestPath = resolve(publicDirectory, entry.file);
  try { await writeFile(manifestPath, bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST" || await readFile(manifestPath, "utf8") !== bytes) throw new Error(`IMMUTABLE_HISTORY_CONFLICT:${manifest.date}`);
  }
  const nextIndex = publicHistoryIndex([...history.index.entries, entry]);
  const temporaryIndex = resolve(publicDirectory, `index.json.${process.pid}.tmp`);
  await writeFile(temporaryIndex, `${JSON.stringify(nextIndex, null, 2)}\n`, { flag: "wx" });
  await rename(temporaryIndex, resolve(publicDirectory, "index.json"));
  const validated = await validatePublicDailyHistory({ directory: publicDirectory, asOfDate, verifySolver: true });
  logger({ event: "publish_elapsed_history", ...safeFields(manifest), result: "created" });
  return { result: "created", manifest: safeFields(manifest), historyDates: validated.dates.length };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--api-url") options.apiUrl = argv[++index];
    else if (value === "--input") options.input = resolve(argv[++index]);
    else if (value === "--manifest") options.manifest = resolve(argv[++index]);
    else if (value === "--public-dir") options.publicDirectory = resolve(argv[++index]);
    else if (value === "--as-of") options.asOfDate = argv[++index];
    else if (value === "--dry-run") options.write = false;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const apiUrl = options.apiUrl || process.env.POKESORT_DAILY_API_URL || "https://pokesort.org/api/daily/current";
  let payload;
  if (options.input && options.manifest) throw new Error("Choose only one of --input or --manifest");
  if (options.manifest) {
    const manifest = JSON.parse(await readFile(options.manifest, "utf8"));
    payload = { schemaVersion: 1, status: "ready", utcDate: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, manifest };
  } else if (options.input) payload = JSON.parse(await readFile(options.input, "utf8"));
  else {
    const response = await fetch(apiUrl, { headers: { accept: "application/json", "cache-control": "no-cache" } });
    if (!response.ok) throw new Error(`DAILY_API_UNAVAILABLE:${response.status}`);
    payload = await response.json();
  }
  const result = await publishElapsedHistory({ ...options, payload, logger: (entry) => console.log(JSON.stringify(entry)) });
  console.log(JSON.stringify({ gate: "PASS", result: result.result, ...result.manifest, historyDates: result.historyDates }));
}
