import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import refreshWorker, { triggerPagesDeploy } from "../../cloudflare/daily-refresh-worker/worker.js";
import { prepareCloudflareBuildHistory } from "./cloudflare-build-history.mjs";
import { preparePrivateDailyBuffer } from "./prepare-private-daily-buffer.mjs";
import { publicHistoryIndex } from "./public-daily-history.mjs";

const BASELINE_DATE = "2026-08-24";
const ACTIVATION_DATE = "2026-08-25";

async function createHistoricalFixture({ sourceDirectory, outputDirectory, asOfDate }) {
  const sourceIndex = JSON.parse(await readFile(join(sourceDirectory, "index.json"), "utf8"));
  const entries = sourceIndex.entries.filter((entry) => entry.date <= asOfDate);
  assert.ok(entries.length > 0, "Historical fixture must contain entries");
  assert.equal(entries.at(-1)?.date, asOfDate, `Historical fixture must end at ${asOfDate}`);
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of entries) await copyFile(join(sourceDirectory, entry.file), join(outputDirectory, entry.file));
  const fixtureIndex = publicHistoryIndex(entries);
  await writeFile(join(outputDirectory, "index.json"), `${JSON.stringify(fixtureIndex, null, 2)}\n`, "utf8");
}

const root = await mkdtemp(join(tmpdir(), "pokesort-cloudflare-automation-test-"));
try {
  const sourceDirectory = join(root, "source"), currentHistory = join(root, "current-history"), seedPrivate = join(root, "seed-private");
  const trackedSourceDirectory = resolve("data/puzzles/public-daily");
  const trackedIndexBefore = await readFile(join(trackedSourceDirectory, "index.json"), "utf8");
  const trackedIndex = JSON.parse(trackedIndexBefore);
  assert.ok(trackedIndex.entries.some((entry) => entry.date > BASELINE_DATE), "Tracked public history may grow beyond the fixed historical fixture baseline");
  const trackedActivationBefore = await readFile(join(trackedSourceDirectory, `${ACTIVATION_DATE}.json`), "utf8");
  await createHistoricalFixture({
    sourceDirectory: trackedSourceDirectory,
    outputDirectory: sourceDirectory,
    asOfDate: BASELINE_DATE,
  });
  const beforeIndex = await readFile(join(sourceDirectory, "index.json"), "utf8");
  const fixtureIndex = JSON.parse(beforeIndex);
  assert.equal(fixtureIndex.entries.at(-1)?.date, BASELINE_DATE, `Historical fixture newestDate must be ${BASELINE_DATE}`);
  await assert.rejects(() => readFile(join(sourceDirectory, `${ACTIVATION_DATE}.json`), "utf8"), /ENOENT/, `Historical fixture must not contain ${ACTIVATION_DATE}.json`);
  const prepared = await prepareCloudflareBuildHistory({
    sourceDirectory,
    outputDirectory: currentHistory,
    asOfDate: BASELINE_DATE,
    activationDate: ACTIVATION_DATE,
  });
  assert.deepEqual(prepared.fetchedApiDates, []);
  assert.equal(prepared.sourceNewestDate, BASELINE_DATE);
  assert.equal(prepared.finalNewestDate, BASELINE_DATE);
  assert.equal(await readFile(join(sourceDirectory, "index.json"), "utf8"), beforeIndex, "tracked source history must remain byte-stable");

  await preparePrivateDailyBuffer({
    elapsedDirectory: sourceDirectory,
    outputDirectory: seedPrivate,
    asOfDate: BASELINE_DATE,
    readyDays: 30,
    privateSeed: "cloudflare-automation-test-seed-with-at-least-32-characters",
    write: true,
  });
  const apiManifest = JSON.parse(await readFile(join(seedPrivate, `${ACTIVATION_DATE}.json`), "utf8"));
  const apiPayload = { schemaVersion: 1, status: "ready", utcDate: apiManifest.date, puzzleId: apiManifest.puzzleId, contentHash: apiManifest.contentHash, manifest: apiManifest };
  const apiHistory = join(root, "api-history");
  const transitioned = await prepareCloudflareBuildHistory({
    sourceDirectory: currentHistory,
    outputDirectory: apiHistory,
    asOfDate: ACTIVATION_DATE,
    activationDate: ACTIVATION_DATE,
    apiBaseUrl: "https://example.test/api/daily",
    fetchImplementation: async (url) => url.endsWith(`/${ACTIVATION_DATE}`) ? Response.json(apiPayload) : new Response("not found", { status: 404 }),
  });
  assert.deepEqual(transitioned.fetchedApiDates, [ACTIVATION_DATE]);
  assert.equal(transitioned.sourceNewestDate, BASELINE_DATE);
  assert.equal(transitioned.finalNewestDate, ACTIVATION_DATE);
  await assert.rejects(() => prepareCloudflareBuildHistory({
    sourceDirectory: currentHistory,
    outputDirectory: join(root, "failed-api-history"),
    asOfDate: ACTIVATION_DATE,
    activationDate: ACTIVATION_DATE,
    fetchImplementation: async () => new Response("offline", { status: 503 }),
  }), { message: `CLOUDFLARE_DAILY_API_UNAVAILABLE:${ACTIVATION_DATE}:503` });

  await assert.rejects(() => triggerPagesDeploy({}, { fetchImplementation: async () => new Response(null, { status: 200 }) }), /PAGES_DEPLOY_HOOK_URL_REQUIRED/);
  const hookEnvironment = (value) => Object.fromEntries([["PAGES_DEPLOY_HOOK_URL", value]]);
  let captured;
  const triggered = await triggerPagesDeploy(hookEnvironment("https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/test"), {
    scheduledTime: 1_777_777,
    fetchImplementation: async (url, init) => { captured = { url, init }; return new Response(null, { status: 200 }); },
  });
  assert.equal(triggered.gate, "PASS");
  assert.equal(captured.init.method, "POST");
  assert.equal(JSON.parse(captured.init.body).scheduledTime, 1_777_777);
  await assert.rejects(() => triggerPagesDeploy(hookEnvironment("https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/test"), { fetchImplementation: async () => new Response(null, { status: 503 }) }), /PAGES_DEPLOY_HOOK_FAILED:503/);
  assert.equal((await refreshWorker.fetch()).status, 404);
  assert.equal(await readFile(join(trackedSourceDirectory, "index.json"), "utf8"), trackedIndexBefore, "Tracked production index must not be modified");
  assert.equal(await readFile(join(trackedSourceDirectory, `${ACTIVATION_DATE}.json`), "utf8"), trackedActivationBefore, "Tracked production activation manifest must not be modified");
  console.log(JSON.stringify({ gate: "PASS", fixtureNewestDate: BASELINE_DATE, trackedHistoryCanAdvance: true, trackedHistoryMutation: false, activationApiDates: 1, api503FailClosed: true, deployHookFailClosed: true, cronFailClosed: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
