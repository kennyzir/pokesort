import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import refreshWorker, { triggerPagesDeploy } from "../../cloudflare/daily-refresh-worker/worker.js";
import { prepareCloudflareBuildHistory } from "./cloudflare-build-history.mjs";
import { preparePrivateDailyBuffer } from "./prepare-private-daily-buffer.mjs";

const root = await mkdtemp(join(tmpdir(), "pokesort-cloudflare-automation-test-"));
try {
  const sourceDirectory = join(root, "source"), currentHistory = join(root, "current-history"), seedPrivate = join(root, "seed-private");
  await cp(resolve("data/puzzles/public-daily"), sourceDirectory, { recursive: true });
  const beforeIndex = await readFile(join(sourceDirectory, "index.json"), "utf8");
  const prepared = await prepareCloudflareBuildHistory({
    sourceDirectory,
    outputDirectory: currentHistory,
    asOfDate: "2026-08-24",
    activationDate: "2026-08-25",
  });
  assert.deepEqual(prepared.fetchedApiDates, []);
  assert.equal(await readFile(join(sourceDirectory, "index.json"), "utf8"), beforeIndex, "tracked source history must remain byte-stable");

  await preparePrivateDailyBuffer({
    elapsedDirectory: sourceDirectory,
    outputDirectory: seedPrivate,
    asOfDate: "2026-08-24",
    readyDays: 30,
    privateSeed: "cloudflare-automation-test-seed-with-at-least-32-characters",
    write: true,
  });
  const apiManifest = JSON.parse(await readFile(join(seedPrivate, "2026-08-25.json"), "utf8"));
  const apiPayload = { schemaVersion: 1, status: "ready", utcDate: apiManifest.date, puzzleId: apiManifest.puzzleId, contentHash: apiManifest.contentHash, manifest: apiManifest };
  const apiHistory = join(root, "api-history");
  const transitioned = await prepareCloudflareBuildHistory({
    sourceDirectory: currentHistory,
    outputDirectory: apiHistory,
    asOfDate: "2026-08-25",
    activationDate: "2026-08-25",
    apiBaseUrl: "https://example.test/api/daily",
    fetchImplementation: async (url) => url.endsWith("/2026-08-25") ? Response.json(apiPayload) : new Response("not found", { status: 404 }),
  });
  assert.deepEqual(transitioned.fetchedApiDates, ["2026-08-25"]);
  await assert.rejects(() => prepareCloudflareBuildHistory({
    sourceDirectory: currentHistory,
    outputDirectory: join(root, "failed-api-history"),
    asOfDate: "2026-08-25",
    activationDate: "2026-08-25",
    fetchImplementation: async () => new Response("offline", { status: 503 }),
  }), /CLOUDFLARE_DAILY_API_UNAVAILABLE:2026-08-25:503/);

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
  console.log(JSON.stringify({ gate: "PASS", trackedHistoryMutation: false, activationApiDates: 1, cronFailClosed: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
