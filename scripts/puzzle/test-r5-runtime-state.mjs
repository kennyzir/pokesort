import assert from "node:assert/strict";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";

const dist = new URL("../../dist/", import.meta.url);
const priorManifest = JSON.parse(await readFile(new URL("../../data/puzzles/private/daily/2026-08-25.json", import.meta.url), "utf8"));
const currentManifest = JSON.parse(await readFile(new URL("../../data/puzzles/private/daily/2026-08-26.json", import.meta.url), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const api = { mode: "ready", manifest: currentManifest, requests: 0, aborted: 0, pending: [] };
const responseBody = (manifest) => ({ schemaVersion: 1, status: "ready", utcDate: manifest.date, puzzleId: manifest.puzzleId, contentHash: manifest.contentHash, cachePolicy: "server-utc-current-no-store", manifest });
const cardsFor = (manifest, solvedLabels = []) => manifest.groups.filter((group) => !solvedLabels.includes(group.label)).flatMap((group) => group.members.map(({ name, id }) => ({ name, id })));
const stateFor = (manifest, overrides = {}) => ({
  mode: "daily",
  puzzleId: manifest.puzzleId,
  contentHash: manifest.contentHash,
  cards: cardsFor(manifest),
  solved: [],
  mistakes: 0,
  revealed: false,
  gameOver: false,
  completionRecorded: false,
  ...overrides,
});

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/api/daily/current") {
    api.requests += 1;
    request.once("aborted", () => { api.aborted += 1; });
    if (api.mode === "failure") { response.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify({ schemaVersion: 1, status: "unavailable", utcDate: api.manifest.date })); return; }
    if (api.mode === "deferred") {
      await new Promise((resolve) => api.pending.push({ request, response, resolve }));
      return;
    }
    const body = responseBody(api.manifest);
    if (api.mode === "tampered") body.contentHash = "0".repeat(64);
    if (api.mode === "manifest_tampered") { body.manifest = structuredClone(body.manifest); body.manifest.cards[0].name += " tampered"; }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); return;
  }
  let relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (relative.endsWith("/")) relative += "index.html";
  let file = new URL(relative, dist), statusCode = 200;
  try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = new URL("404.html", dist); statusCode = 404; }
  let body = await readFile(file);
  if (file.pathname.endsWith("/index.html") && url.pathname === "/") {
    let html = body.toString("utf8");
    if (url.searchParams.get("edge") === "1") html = html.replace("</head>", '<meta name="pokesort-edge-daily" content="enabled"></head>');
    if (url.searchParams.get("stale") === "1") {
      html = html.replace(/(<script id="pokesort-puzzle-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_match, start, json, end) => {
        const payload = JSON.parse(json), stale = new Date(`${payload.date}T00:00:00.000Z`);
        stale.setUTCDate(stale.getUTCDate() - 1);
        payload.date = stale.toISOString().slice(0, 10);
        return `${start}${JSON.stringify(payload)}${end}`;
      });
    }
    body = Buffer.from(html);
  }
  const extension = file.pathname.slice(file.pathname.lastIndexOf("."));
  response.writeHead(statusCode, { "content-type": types[extension] || "application/octet-stream" }); response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.POKESORT_BROWSER_CHANNEL || "chrome" });
const poll = async (predicate, label) => {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
};
const settle = (pending, manifest) => {
  pending.resolve();
  if (!pending.response.destroyed) { pending.response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); pending.response.end(JSON.stringify(responseBody(manifest))); }
};

try {
  const off = await browser.newPage();
  const offErrors = []; off.on("pageerror", (error) => offErrors.push(error.message));
  await off.goto(`${origin}/`);
  await off.waitForFunction(() => ["ready", "unavailable"].includes(document.querySelector("#puzzle-grid")?.dataset.loadState));
  assert.equal(await off.locator("#puzzle-grid").getAttribute("data-load-state"), "ready", `flag-off runtime failed: ${offErrors.join("; ")} ${(await off.locator("#game-status").textContent())}`);
  assert.equal(api.requests, 0, "feature flag OFF must keep embedded Daily playable without touching the edge API");
  assert.equal(await off.locator("#puzzle-grid").getAttribute("data-load-state"), "ready");
  await off.close();

  const stale = await browser.newPage();
  await stale.goto(`${origin}/?stale=1`);
  await stale.locator("#retry-puzzle-load").waitFor();
  assert.equal(await stale.locator("#puzzle-grid").getAttribute("data-load-state"), "unavailable", "a stale embedded homepage board must fail closed instead of being relabeled Today");
  assert.equal(api.requests, 0, "stale embedded detection must not silently depend on the disabled API");
  await stale.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://raw.githubusercontent.com/**", (route) => route.abort());
  await context.addInitScript(() => {
    globalThis.__pokesortWinWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === "pokesort-wins") globalThis.__pokesortWinWrites += 1; return original.call(this, key, value); };
  });
  const page = await context.newPage();
  await page.goto(`${origin}/?edge=1`);
  await page.locator('.poke-card').first().waitFor();
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).dateKey, currentManifest.date);

  api.mode = "deferred"; api.pending = [];
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); });
  await poll(() => api.pending.length === 1, "first delayed request");
  assert.equal(await page.locator("#puzzle-grid").getAttribute("data-load-state"), "loading");
  assert.equal(await page.locator("#puzzle-grid").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator('.poke-card').count(), 0, "the old board must be cleared as soon as a replacement request starts");
  for (const id of ["submit-selection", "shuffle-board", "deselect-all", "reveal-board", "hint-button", "new-infinite"]) assert(await page.locator(`#${id}`).isDisabled(), `${id} must be disabled while loading`);
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); });
  await poll(() => api.pending.length === 2, "replacement delayed request");
  settle(api.pending[1], priorManifest);
  await page.locator('.poke-card').first().waitFor();
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).dateKey, priorManifest.date, "last request must win a reordered race");
  settle(api.pending[0], currentManifest);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).dateKey, priorManifest.date, "aborted stale response must not render");
  assert(api.aborted >= 1, "superseded fetch must be aborted");

  await page.evaluate(() => {
    const originalFetch = globalThis.fetch;
    const pending = [];
    globalThis.__pokesortIgnoredAbort = { originalFetch, pending };
    globalThis.fetch = (input, init = {}) => String(input).includes("/api/daily/current")
      ? new Promise((resolve) => pending.push({ resolve, signal: init.signal }))
      : originalFetch(input, init);
  });
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); void globalThis.__pokesortRuntime.reload(); });
  await page.waitForFunction(() => globalThis.__pokesortIgnoredAbort.pending.length === 2);
  assert.equal(await page.evaluate(() => globalThis.__pokesortIgnoredAbort.pending[0].signal.aborted), true, "the first injected request must be aborted");
  await page.evaluate((body) => globalThis.__pokesortIgnoredAbort.pending[1].resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })), responseBody(priorManifest));
  await page.waitForFunction((date) => globalThis.__pokesortRuntime.state().loadState === "ready" && globalThis.__pokesortRuntime.state().dateKey === date, priorManifest.date);
  await page.evaluate((body) => globalThis.__pokesortIgnoredAbort.pending[0].resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })), responseBody(currentManifest));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).dateKey, priorManifest.date, "a transport that resolves after abort must still lose to the monotonic request token");
  await page.evaluate(() => { globalThis.fetch = globalThis.__pokesortIgnoredAbort.originalFetch; delete globalThis.__pokesortIgnoredAbort; });

  api.mode = "failure";
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); });
  await page.locator("#retry-puzzle-load").waitFor();
  assert.equal(await page.locator("#puzzle-grid").getAttribute("data-load-state"), "unavailable");
  assert.equal(await page.locator("#puzzle-grid").getAttribute("aria-busy"), "false");
  assert(await page.locator("#submit-selection").isDisabled());
  assert.equal(await page.evaluate(() => document.activeElement?.id), "retry-puzzle-load", "failure recovery must put keyboard focus on Retry");
  const unavailableSnapshot = await page.evaluate(() => ({ state: globalThis.__pokesortRuntime.state(), storage: JSON.stringify(localStorage) }));
  await page.evaluate(() => {
    for (const id of ["submit-selection", "shuffle-board", "deselect-all", "reveal-board", "hint-button", "new-infinite"]) document.querySelector(`#${id}`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("#puzzle-grid")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.deepEqual(await page.evaluate(() => ({ state: globalThis.__pokesortRuntime.state(), storage: JSON.stringify(localStorage) })), unavailableSnapshot, "click and keyboard events must be inert while the puzzle is unavailable");
  api.mode = "ready"; api.manifest = currentManifest;
  await page.locator("#retry-puzzle-load").click();
  await page.locator('.poke-card').first().waitFor();
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).dateKey, currentManifest.date, "retry must recover to the server-authoritative UTC date");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("poke-card")), true, "successful keyboard retry must return focus to the playable board");

  await page.evaluate(({ manifest, stored }) => localStorage.setItem(`pokesort-daily-${manifest.date}`, JSON.stringify(stored)), { manifest: currentManifest, stored: stateFor(currentManifest, { contentHash: "f".repeat(64), cards: [], solved: ["tampered"], mistakes: 3 }) });
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).solved.length, 0, "contentHash-incompatible storage must be discarded");
  assert.equal(await page.locator('.poke-card').count(), 16);

  const corruptStates = [
    stateFor(currentManifest, { revealed: true }),
    stateFor(currentManifest, { gameOver: true }),
    stateFor(currentManifest, { completionRecorded: true }),
    stateFor(currentManifest, { mistakes: 4, gameOver: false }),
    stateFor(currentManifest, { revealed: "true" }),
  ];
  const winsBeforeCorruptRecovery = await page.evaluate(() => localStorage.getItem("pokesort-wins"));
  for (const stored of corruptStates) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `pokesort-daily-${currentManifest.date}`, value: stored });
    await page.evaluate(() => globalThis.__pokesortRuntime.reload());
    const restored = await page.evaluate(() => globalThis.__pokesortRuntime.state());
    assert.deepEqual({ cards: restored.cards, solved: restored.solved.length, mistakes: restored.mistakes, revealed: restored.revealed, gameOver: restored.gameOver, completionRecorded: restored.completionRecorded }, { cards: 16, solved: 0, mistakes: 0, revealed: false, gameOver: false, completionRecorded: false }, "an inconsistent terminal-state claim must be discarded as one unit");
    assert.equal(await page.evaluate(() => localStorage.getItem("pokesort-wins")), winsBeforeCorruptRecovery, "discarding corrupt progress must not mutate streak history");
  }

  const groupLabels = currentManifest.groups.map((group) => group.label);
  const legalActive = stateFor(currentManifest, { cards: cardsFor(currentManifest, [groupLabels[0]]), solved: [groupLabels[0]], mistakes: 2 });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `pokesort-daily-${currentManifest.date}`, value: legalActive });
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());
  assert.deepEqual(await page.evaluate(() => { const state = globalThis.__pokesortRuntime.state(); return { cards: state.cards, solved: state.solved, mistakes: state.mistakes, gameOver: state.gameOver }; }), { cards: 12, solved: [groupLabels[0]], mistakes: 2, gameOver: false }, "a legitimate active state must restore without losing progress");

  const legalFailed = stateFor(currentManifest, { mistakes: 4, gameOver: true });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `pokesort-daily-${currentManifest.date}`, value: legalFailed });
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());
  assert.deepEqual(await page.evaluate(() => { const state = globalThis.__pokesortRuntime.state(); return { cards: state.cards, mistakes: state.mistakes, gameOver: state.gameOver }; }), { cards: 16, mistakes: 4, gameOver: true }, "a legitimate four-mistake terminal state must remain terminal");

  const legalReveal = stateFor(currentManifest, { cards: [], solved: groupLabels, revealed: true, gameOver: true });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `pokesort-daily-${currentManifest.date}`, value: legalReveal });
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());
  assert.deepEqual(await page.evaluate(() => { const state = globalThis.__pokesortRuntime.state(); return { cards: state.cards, solved: state.solved.length, revealed: state.revealed, completionRecorded: state.completionRecorded }; }), { cards: 0, solved: 4, revealed: true, completionRecorded: false }, "a legitimate reveal terminal state must restore without becoming a win");

  await page.evaluate((key) => localStorage.removeItem(key), `pokesort-daily-${currentManifest.date}`);
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());

  for (const group of currentManifest.groups) {
    for (const { name } of group.members) await page.locator('.poke-card', { hasText: name }).click();
    await page.locator("#submit-selection").click();
  }
  assert.equal(await page.evaluate(() => globalThis.__pokesortWinWrites), 1, "a completed Daily must write its win once");
  await page.evaluate(async () => { await globalThis.__pokesortRuntime.reload(); await globalThis.__pokesortRuntime.reload(); });
  assert.equal(await page.evaluate(() => globalThis.__pokesortWinWrites), 1, "duplicate/retry loads must not double-count a win");

  const crashBeforeFinish = stateFor(currentManifest, { cards: [], solved: groupLabels, gameOver: true, completionRecorded: false });
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `pokesort-daily-${currentManifest.date}`, value: crashBeforeFinish });
  await page.evaluate(() => globalThis.__pokesortRuntime.reload());
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).completionRecorded, true, "a solve saved immediately before completion side effects must finish recovery");
  assert.equal(await page.evaluate(() => globalThis.__pokesortWinWrites), 1, "crash recovery must not rewrite an already-present Daily win");

  api.mode = "manifest_tampered";
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); });
  await page.locator("#retry-puzzle-load").waitFor();
  assert.equal(await page.locator("#puzzle-grid").getAttribute("data-load-state"), "unavailable", "client-safe integrity must reject a tampered API envelope");

  api.mode = "ready";
  await page.goto(`${origin}/infinite/`);
  await page.locator('.poke-card').first().waitFor();
  const startRound = (await page.evaluate(() => globalThis.__pokesortRuntime.state())).round;
  await page.evaluate(() => { void globalThis.__pokesortRuntime.newInfinite(); void globalThis.__pokesortRuntime.newInfinite(); void globalThis.__pokesortRuntime.newInfinite(); });
  await page.waitForFunction((expected) => globalThis.__pokesortRuntime.state().loadState === "ready" && globalThis.__pokesortRuntime.state().round === expected, startRound + 3);
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).round, startRound + 3, "rapid Infinite requests must render only the last monotonic round");
  await page.evaluate(() => {
    const originalFetch = globalThis.fetch;
    globalThis.__pokesortInfiniteFetch = originalFetch;
    globalThis.fetch = (input, init) => String(input).includes("/assets/infinite/") ? Promise.resolve(new Response("unavailable", { status: 503 })) : originalFetch(input, init);
  });
  await page.evaluate(() => { void globalThis.__pokesortRuntime.reload(); });
  await page.locator("#retry-puzzle-load").waitFor();
  const unavailableRound = (await page.evaluate(() => globalThis.__pokesortRuntime.state())).round;
  await page.evaluate(() => {
    document.querySelector("#new-infinite")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.querySelector("#puzzle-grid")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).round, unavailableRound, "New Infinite and keyboard submission must be inert while Infinite is unavailable");
  await page.evaluate(() => { globalThis.fetch = globalThis.__pokesortInfiniteFetch; delete globalThis.__pokesortInfiniteFetch; });
  await page.locator("#retry-puzzle-load").click();
  await page.waitForFunction(() => globalThis.__pokesortRuntime.state().loadState === "ready");
  assert.equal((await page.evaluate(() => globalThis.__pokesortRuntime.state())).round, unavailableRound, "retry must recover the same Infinite round instead of skipping a board");
  console.log(JSON.stringify({ gate: "PASS", featureFlagOffApiRequests: 0, edgeRequests: api.requests, abortedRequests: api.aborted, states: ["idle", "loading", "ready", "unavailable"], utcBoundary: `${priorManifest.date}->${currentManifest.date}`, winWrites: 1 }, null, 2));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
