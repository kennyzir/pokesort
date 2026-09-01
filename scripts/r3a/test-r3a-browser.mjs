import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const dist = resolve("dist"), evidenceDirectory = await mkdtemp(join(tmpdir(), "pokesort-r3a-browser-"));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const previewOrigin = (process.env.POKESORT_TEST_ORIGIN || "").replace(/\/$/, "");
const fixedRuntimeDate = "2026-08-25";
const testUtcDate = process.env.POKESORT_TEST_UTC_DATE || fixedRuntimeDate;
assert.match(testUtcDate, /^\d{4}-\d{2}-\d{2}$/);
const server = previewOrigin ? null : createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = resolve(dist, `.${pathname}`);
    if (file !== dist && !file.startsWith(`${dist}${sep}`)) throw new Error("outside dist");
    const body = await readFile(file); response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); response.end(body);
  } catch { response.writeHead(404, { "content-type": "text/plain" }); response.end("Not found"); }
});
if (server) await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const origin = previewOrigin || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
const forbiddenKeys = new Set(["puzzle_id", "pokemon_id", "pokemon_name", "selected_ids", "group_name", "rule_name", "rule_family", "answer", "content_hash", "member_signature", "URL", "query_string", "raw_error", "stack", "local_storage", "email", "user_id", "fingerprint"]);
const allowedKeys = new Set(["game_mode", "elapsed_ms", "load_ms", "mistakes", "groups_solved", "guess_match_count", "hint_level", "outcome", "share_method", "round_number", "error_stage"]);

function record(route, viewport, action, expected, actual) { results.push({ route, viewport, action, expected, actual, result: "PASS" }); }
function canonicalize(value) { return Array.isArray(value) ? value.map(canonicalize) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value; }
function sha256(value) { return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }
function withHash(value) { const { contentHash, ...base } = value; return { ...base, contentHash: sha256(base) }; }
function combinations(values) {
  const output = [];
  for (let a = 0; a < values.length - 3; a++) for (let b = a + 1; b < values.length - 2; b++) for (let c = b + 1; c < values.length - 1; c++) for (let d = c + 1; d < values.length; d++) output.push([values[a], values[b], values[c], values[d]]);
  return output;
}
const signature = (ids) => [...ids].sort((left, right) => left - right).join("-");

async function installCapture(context, utcDate = testUtcDate, analyticsMode = "capture") {
  const fixedNow = Date.parse(`${utcDate}T12:00:00.000Z`);
  context.__r3aPageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => context.__r3aPageErrors.push(error.message)));
  await context.addInitScript(({ fixedNowValue, analyticsModeValue }) => {
    const NativeDate = globalThis.Date;
    class FixedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNowValue])); }
      static now() { return fixedNowValue; }
    }
    globalThis.Date = FixedDate;
    globalThis.__pokesortEvents = [];
    const analytics = analyticsModeValue === "missing" ? undefined : analyticsModeValue === "throwing" ? () => { throw new Error("analytics unavailable"); }
      : (...args) => { if (args[0] === "event") globalThis.__pokesortEvents.push({ name: args[1], parameters: args[2] }); };
    Object.defineProperty(globalThis, "gtag", { configurable: true, get: () => analytics, set: () => {} });
  }, { fixedNowValue: fixedNow, analyticsModeValue: analyticsMode });
  await context.route("https://www.googletagmanager.com/**", (route) => route.abort());
  await context.route("https://www.google-analytics.com/**", (route) => route.abort());
  await context.route("https://raw.githubusercontent.com/**", (route) => route.abort());
}
async function waitReady(page) { await page.waitForFunction(() => globalThis.__pokesortRuntime?.state().loadState === "ready", null, { timeout: 15_000 }); }
async function waitUnavailable(page) { await page.waitForFunction(() => globalThis.__pokesortRuntime?.state().loadState === "unavailable", null, { timeout: 15_000 }); }
async function state(page) { return page.evaluate(() => globalThis.__pokesortRuntime.state()); }
async function events(page) {
  return page.evaluate(() => {
    const captured = [...(globalThis.__pokesortEvents || [])];
    for (const entry of globalThis.dataLayer || []) {
      const values = Array.from(entry || []);
      if (values[0] === "event") captured.push({ name: values[1], parameters: values[2] });
    }
    return captured;
  });
}
async function payload(page) { return page.evaluate(() => JSON.parse(document.querySelector("#pokesort-puzzle-data").textContent)); }
async function clickIds(page, ids) { for (const id of ids) await page.locator(`[data-id="${id}"]`).click(); }
async function submitIds(page, ids) { await clickIds(page, ids); await page.locator("#submit-selection").click(); }
async function assertEventPrivacy(page) {
  for (const event of await events(page)) for (const key of Object.keys(event.parameters || {})) { assert.ok(allowedKeys.has(key), `unknown analytics parameter ${key}`); assert.equal(forbiddenKeys.has(key), false); }
}
function assertNoPageErrors(context) { assert.deepEqual(context.__r3aPageErrors, []); }

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.grantPermissions(["clipboard-read", "clipboard-write"], { origin }); await installCapture(desktop);
  await desktop.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await desktop.newPage(); let apiRequests = 0; page.on("request", (request) => { if (request.url().endsWith("/api/daily/current")) apiRequests += 1; });
  await page.goto(`${origin}/`); await waitReady(page);
  assert.equal(apiRequests, 0); assert.equal((await state(page)).gameMode, "daily");
  assert.ok((await events(page)).some(({ name, parameters }) => name === "pokesort_board_ready" && parameters.outcome === "embedded"));
  record("/", "1440x900", "embedded board ready", "ready with zero current API requests", `ready; requests=${apiRequests}`);
  const dailyPayload = await payload(page), intended = new Set(dailyPayload.groups.map(({ memberSignature }) => memberSignature));
  const initial = await state(page); await page.locator(`[data-id="${initial.cardIds[0]}"]`).click(); await page.locator("#deselect-all").click();
  assert.equal((await events(page)).filter(({ name }) => name === "pokesort_game_start").length, 1);
  const overlapSignature = initial.validOverlaps.find((value) => !intended.has(value)); assert.ok(overlapSignature);
  await submitIds(page, overlapSignature.split("-").map(Number));
  let current = await state(page); assert.equal(current.mistakes, 0); assert.deepEqual(current.selected, []); assert.equal(current.history.at(-1).outcome, "valid_overlap"); assert.match(await page.locator("#game-status").innerText(), /No mistake charged/);
  assert.equal((await events(page)).filter(({ name }) => name === "pokesort_valid_overlap").length, 1);
  record("/", "1440x900", "submit authoritative valid overlap", "no mistake, cleared selection, history and one event", `mistakes=${current.mistakes}; history=${current.history.at(-1).outcome}`);
  const allValid = new Set([...initial.validOverlaps, ...intended]), invalid = combinations(initial.cardIds).find((ids) => !allValid.has(signature(ids))); assert.ok(invalid);
  await submitIds(page, invalid); current = await state(page); assert.equal(current.mistakes, 1); assert.equal(current.history.at(-1).outcome, "invalid");
  record("/", "1440x900", "submit invalid guess", "mistakes increases exactly once", `mistakes=${current.mistakes}`);
  const hintTexts = [];
  for (let level = 1; level <= 3; level++) { await page.locator("#hint-button").click(); hintTexts.push(await page.locator("#game-status").innerText()); }
  const hintEventsBefore = (await events(page)).filter(({ name }) => name === "pokesort_hint_open").length; await page.locator("#hint-button").click();
  assert.equal((await events(page)).filter(({ name }) => name === "pokesort_hint_open").length, hintEventsBefore); assert.match(await page.locator("#game-status").innerText(), /Maximum hint reached/);
  const firstTwo = [...dailyPayload.groups[0].mons].sort((left, right) => left[1] - right[1]).slice(0, 2).map(([name]) => name);
  assert.ok(firstTwo.every((name) => hintTexts[2].includes(name))); assert.ok(dailyPayload.groups[0].mons.slice(2).some(([name]) => !hintTexts[2].includes(name)));
  record("/", "1440x900", "open hint levels 1-3 and repeat level 3", "progressive copy, only two names, no repeated event", hintTexts.join(" | "));
  await page.reload(); await waitReady(page); current = await state(page); assert.equal(current.history.length, 2); assert.equal(Math.max(...Object.values(current.hintLevels)), 3);
  record("/", "1440x900", "refresh", "history and per-group hint levels restored", `history=${current.history.length}; hint=${Math.max(...Object.values(current.hintLevels))}`);
  await submitIds(page, dailyPayload.groups[0].mons.map(([, id]) => id)); assert.equal((await state(page)).solved.length, 1);
  await page.locator("#hint-button").click(); assert.equal(Object.values((await state(page)).hintLevels).filter((level) => level === 1).length, 1);
  for (const group of dailyPayload.groups.slice(1)) await submitIds(page, group.mons.map(([, id]) => id));
  current = await state(page); assert.equal(current.solved.length, 4); assert.equal(current.gameOver, true); assert.equal((await events(page)).filter(({ name, parameters }) => name === "pokesort_game_complete" && parameters.outcome === "solved").length, 1);
  assert.equal((await events(page)).filter(({ name }) => name === "pokesort_group_solved").length, 4);
  assert.equal((await events(page)).filter(({ name, parameters }) => name === "pokesort_guess_submit" && parameters.outcome === "correct").length, 4);
  record("/", "1440x900", "solve four intended groups", "correct history, group events and one solved completion", `groups=${current.solved.length}; completion=${current.analyticsCompletionSent}`);
  await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: undefined })); await page.locator("#share-result").click();
  await page.waitForFunction(() => [...(globalThis.dataLayer || [])].some((entry) => { const values = Array.from(entry || []); return values[0] === "event" && values[1] === "pokesort_share" && values[2]?.share_method === "clipboard"; }));
  let shareCount = (await events(page)).filter(({ name }) => name === "pokesort_share").length;
  await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.resolve() })); await page.locator("#share-result").click();
  await page.waitForFunction(() => {
    const captured = [...(globalThis.__pokesortEvents || [])];
    for (const entry of globalThis.dataLayer || []) { const values = Array.from(entry || []); if (values[0] === "event") captured.push({ name: values[1], parameters: values[2] }); }
    return captured.some(({ name, parameters }) => name === "pokesort_share" && parameters?.share_method === "native");
  });
  assert.ok((await events(page)).some(({ name, parameters }) => name === "pokesort_share" && parameters.share_method === "native"));
  shareCount = (await events(page)).filter(({ name }) => name === "pokesort_share").length;
  await page.evaluate(() => Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.reject(new DOMException("cancel", "AbortError")) })); await page.locator("#share-result").click();
  await page.waitForTimeout(50); assert.equal((await events(page)).filter(({ name }) => name === "pokesort_share").length, shareCount);
  record("/", "1440x900", "clipboard and native share success, then native cancellation", "both success methods recorded; cancellation no event", `share_events=${shareCount}`);
  await assertEventPrivacy(page); await page.screenshot({ path: join(evidenceDirectory, "desktop-daily.png"), fullPage: true });
  await page.reload(); await waitReady(page); assert.equal((await events(page)).filter(({ name }) => name === "pokesort_game_complete").length, 0);

  const failureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(failureContext); const failurePage = await failureContext.newPage();
  await failurePage.goto(`${origin}/`); await waitReady(failurePage); const failurePayload = await payload(failurePage), failureState = await state(failurePage);
  const failureIntended = new Set(failurePayload.groups.map(({ memberSignature }) => memberSignature)); const repeatedOverlap = failureState.validOverlaps.find((value) => !failureIntended.has(value));
  const repeatedInvalid = combinations(failureState.cardIds).find((ids) => !new Set([...failureState.validOverlaps, ...failureIntended]).has(signature(ids)));
  for (let count = 0; count < 21; count++) await submitIds(failurePage, repeatedOverlap.split("-").map(Number));
  assert.equal((await state(failurePage)).history.length, 20); assert.equal((await state(failurePage)).mistakes, 0); assert.equal((await state(failurePage)).history.at(-1).repeated, true);
  assert.match(await failurePage.locator("#guess-history-list li:first-child strong").innerText(), /Repeated guess/);
  for (let count = 0; count < 3; count++) await submitIds(failurePage, repeatedInvalid); assert.equal((await state(failurePage)).gameOver, false); assert.equal((await state(failurePage)).mistakes, 3);
  await submitIds(failurePage, repeatedInvalid); assert.equal((await state(failurePage)).gameOver, true); assert.equal((await state(failurePage)).mistakes, 4);
  assert.equal((await events(failurePage)).filter(({ name }) => name === "pokesort_game_complete").length, 0);
  record("/", "1440x900", "history cap, repeated detection and four invalid guesses", "20 newest items; repeated marked; fourth ends play without game_complete", "history=20; mistakes=4; completion_events=0"); assertNoPageErrors(failureContext); await failureContext.close();

  const migrationContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(migrationContext); const migrationPage = await migrationContext.newPage();
  await migrationPage.goto(`${origin}/`); await waitReady(migrationPage); const migrationPayload = await payload(migrationPage), migrationState = await state(migrationPage);
  await migrationPage.evaluate(({ puzzle, runtime }) => {
    localStorage.removeItem(`pokesort:game:v2:daily:${runtime.puzzleId}`);
    localStorage.setItem(`pokesort-daily-${runtime.dateKey}`, JSON.stringify({ mode: "daily", puzzleId: runtime.puzzleId, contentHash: runtime.contentHash, cards: puzzle.cards, solved: [], mistakes: 2, revealed: false, gameOver: false, completionRecorded: false }));
  }, { puzzle: migrationPayload, runtime: migrationState });
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).mistakes, 2);
  await migrationPage.evaluate((runtime) => { localStorage.removeItem(`pokesort-daily-${runtime.dateKey}`); localStorage.setItem(`pokesort:game:v2:daily:${runtime.puzzleId}`, "{bad json"); }, await state(migrationPage));
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).mistakes, 0);
  const migrationReady = await state(migrationPage), migrationOverlap = migrationReady.validOverlaps.find((value) => !new Set(migrationPayload.groups.map(({ memberSignature }) => memberSignature)).has(value)); await submitIds(migrationPage, migrationOverlap.split("-").map(Number));
  await migrationPage.evaluate((runtime) => { const key = `pokesort:game:v2:daily:${runtime.puzzleId}`, stored = JSON.parse(localStorage.getItem(key)); stored.history.push({ selectedIds: [999999, 1, 2, 3], outcome: "invalid", guessMatchCount: 0 }); localStorage.setItem(key, JSON.stringify(stored)); }, await state(migrationPage));
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).history.length, 1);
  await migrationPage.evaluate(({ runtime, groupSignature }) => {
    const key = `pokesort:game:v2:daily:${runtime.puzzleId}`, stored = JSON.parse(localStorage.getItem(key));
    stored.history = "malformed"; stored.hintLevels = { [groupSignature]: 2 }; localStorage.setItem(key, JSON.stringify(stored));
  }, { runtime: await state(migrationPage), groupSignature: migrationPayload.groups[0].memberSignature });
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).history.length, 0); assert.equal(Object.values((await state(migrationPage)).hintLevels)[0], 2);
  const partialState = await state(migrationPage); await submitIds(migrationPage, partialState.validOverlaps.find((value) => !new Set(migrationPayload.groups.map(({ memberSignature }) => memberSignature)).has(value)).split("-").map(Number));
  await migrationPage.evaluate((runtime) => { const key = `pokesort:game:v2:daily:${runtime.puzzleId}`, stored = JSON.parse(localStorage.getItem(key)); stored.hintLevels = []; localStorage.setItem(key, JSON.stringify(stored)); }, await state(migrationPage));
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).history.length, 1); assert.deepEqual((await state(migrationPage)).hintLevels, {});
  await migrationPage.evaluate((runtime) => { const key = `pokesort:game:v2:daily:${runtime.puzzleId}`, stored = JSON.parse(localStorage.getItem(key)); stored.cards = stored.cards.slice(1); localStorage.setItem(key, JSON.stringify(stored)); }, await state(migrationPage));
  await migrationPage.reload(); await waitReady(migrationPage); assert.equal((await state(migrationPage)).mistakes, 0); assert.equal((await state(migrationPage)).history.length, 0);
  record("/", "1440x900", "Daily migration and layered corrupt-state recovery", "legacy migration; bad JSON/core reset; malformed history/hints reset locally; off-board IDs rejected", "legacy_mistakes=2; core_reset=0; partial_fields_preserved"); assertNoPageErrors(migrationContext); await migrationContext.close();

  const storageContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await storageContext.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) Object.defineProperty(Storage.prototype, method, { configurable: true, value: () => { throw new DOMException("blocked", "SecurityError"); } });
  });
  await installCapture(storageContext); const storagePage = await storageContext.newPage(); await storagePage.goto(`${origin}/`); await waitReady(storagePage);
  const storageReady = await state(storagePage); await clickIds(storagePage, [storageReady.cardIds[0]]); assert.equal((await state(storagePage)).selected.length, 1);
  record("/", "1440x900", "LocalStorage unavailable", "board remains playable", "ready=true; selected=1"); assertNoPageErrors(storageContext); await storageContext.close();

  for (const analyticsMode of ["missing", "throwing"]) {
    const analyticsContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(analyticsContext, testUtcDate, analyticsMode);
    const analyticsPage = await analyticsContext.newPage(); await analyticsPage.goto(`${origin}/`); await waitReady(analyticsPage); const analyticsState = await state(analyticsPage);
    await clickIds(analyticsPage, [analyticsState.cardIds[0]]); assert.equal((await state(analyticsPage)).selected.length, 1);
    record("/", "1440x900", `gtag ${analyticsMode}`, "Analytics availability cannot block play", "ready=true; selected=1"); assertNoPageErrors(analyticsContext); await analyticsContext.close();
  }

  const revealContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(revealContext); const revealPage = await revealContext.newPage(); await revealPage.goto(`${origin}/`); await waitReady(revealPage);
  await revealPage.locator("#hint-button").click(); await revealPage.locator("#reveal-board").click(); const revealState = await state(revealPage); assert.equal(revealState.revealed, true); assert.equal(Object.values(revealState.hintLevels)[0], 1);
  assert.equal((await events(revealPage)).filter(({ name }) => name === "pokesort_reveal").length, 1); assert.equal((await events(revealPage)).filter(({ name }) => name === "pokesort_game_complete").length, 0);
  record("/", "1440x900", "Reveal after hint", "Reveal remains independent and does not send game_complete", "revealed=true; hint_preserved=1; completion_events=0"); assertNoPageErrors(revealContext); await revealContext.close();

  const archivePage = await desktop.newPage(); let archiveApi = 0; archivePage.on("request", (request) => { if (request.url().endsWith("/api/daily/current")) archiveApi += 1; });
  await archivePage.goto(`${origin}/daily/2026-08-25/`); await waitReady(archivePage); const archivePayload = await payload(archivePage), archiveState = await state(archivePage);
  const archiveIntended = new Set(archivePayload.groups.map(({ memberSignature }) => memberSignature)); const archiveOverlap = archiveState.validOverlaps.find((value) => !archiveIntended.has(value)); assert.ok(archiveOverlap);
  await submitIds(archivePage, archiveOverlap.split("-").map(Number)); assert.equal((await state(archivePage)).mistakes, 0); assert.equal(archiveApi, 0);
  assert.ok((await archivePage.evaluate(() => Object.keys(localStorage))).some((key) => key.startsWith("pokesort:game:v2:archive:")));
  record("/daily/2026-08-25/", "1440x900", "archive valid overlap and storage", "no current API, no penalty, archive-isolated key", `requests=${archiveApi}; mistakes=0`);
  const archiveRuntime = await state(archivePage);
  await archivePage.evaluate(({ puzzle, runtime }) => {
    localStorage.removeItem(`pokesort:game:v2:archive:${runtime.puzzleId}`);
    localStorage.setItem(`pokesort-daily-${runtime.dateKey}`, JSON.stringify({ mode: "daily", puzzleId: runtime.puzzleId, contentHash: runtime.contentHash, cards: puzzle.cards, solved: [], mistakes: 3, revealed: false, gameOver: false, completionRecorded: false }));
  }, { puzzle: archivePayload, runtime: archiveRuntime });
  await archivePage.reload(); await waitReady(archivePage); assert.equal((await state(archivePage)).mistakes, 0);
  record("/daily/2026-08-25/", "1440x900", "legacy Daily isolation", "Archive ignores old Daily key", "mistakes=0");
  await archivePage.screenshot({ path: join(evidenceDirectory, "desktop-archive.png"), fullPage: true }); await assertEventPrivacy(archivePage); assertNoPageErrors(desktop);

  const infinitePage = await desktop.newPage(); await infinitePage.goto(`${origin}/infinite/`); await waitReady(infinitePage); const infiniteStart = await state(infinitePage); assert.ok(infiniteStart.validOverlaps.length > 0);
  await submitIds(infinitePage, infiniteStart.validOverlaps[0].split("-").map(Number)); assert.equal((await state(infinitePage)).mistakes, 0); assert.equal((await state(infinitePage)).history.at(-1).outcome, "valid_overlap");
  const previousPuzzle = (await state(infinitePage)).puzzleId; await infinitePage.locator("#new-infinite").click(); await infinitePage.waitForFunction((id) => globalThis.__pokesortRuntime.state().loadState === "ready" && globalThis.__pokesortRuntime.state().puzzleId !== id, previousPuzzle);
  assert.equal((await events(infinitePage)).filter(({ name }) => name === "pokesort_new_infinite").length, 1); assert.equal((await state(infinitePage)).history.length, 0);
  const nextReady = await state(infinitePage), nextPuzzle = nextReady.puzzleId; await submitIds(infinitePage, nextReady.validOverlaps[0].split("-").map(Number)); assert.equal((await state(infinitePage)).history.length, 1);
  const infiniteKeys = await infinitePage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("pokesort:game:v2:infinite:"))); assert.ok(infiniteKeys.some((key) => key.endsWith(previousPuzzle))); assert.ok(infiniteKeys.some((key) => key.endsWith(nextPuzzle)));
  record("/infinite/", "1440x900", "sidecar overlap and New Infinite", "no penalty, one user event, and puzzleId-isolated state", `mistakes=0; new_events=1; isolated_keys=${infiniteKeys.length}`);
  const infiniteMigration = await state(infinitePage), infiniteCards = await infinitePage.locator(".poke-card").evaluateAll((buttons) => buttons.map((button) => ({ id: Number(button.dataset.id), name: button.querySelector("span").textContent })));
  await infinitePage.evaluate(({ runtime, cards }) => {
    localStorage.removeItem(`pokesort:game:v2:infinite:${runtime.puzzleId}`);
    localStorage.setItem(`pokesort-infinite-${runtime.round}`, JSON.stringify({ mode: "infinite", puzzleId: runtime.puzzleId, contentHash: runtime.contentHash, cards, solved: [], mistakes: 2, revealed: false, gameOver: false, completionRecorded: false }));
  }, { runtime: infiniteMigration, cards: infiniteCards });
  await infinitePage.reload(); await waitReady(infinitePage); assert.equal((await state(infinitePage)).mistakes, 2);
  record("/infinite/", "1440x900", "legal legacy Infinite migration", "matching old round state restores safely", "mistakes=2");
  await infinitePage.screenshot({ path: join(evidenceDirectory, "desktop-infinite.png"), fullPage: true }); await assertEventPrivacy(infinitePage); assertNoPageErrors(desktop);

  const homeHtml = await readFile(resolve(dist, "index.html"), "utf8");
  const previousUtcDate = new Date(`${testUtcDate}T00:00:00.000Z`); previousUtcDate.setUTCDate(previousUtcDate.getUTCDate() - 1); const staleDate = previousUtcDate.toISOString().slice(0, 10);
  for (const scenario of ["missing", "stale", "payload-hash"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(context); const scenarioPage = await context.newPage(); let requests = 0;
    let body = homeHtml;
    if (scenario === "missing") body = body.replace(/<script id="pokesort-puzzle-data"[\s\S]*?<\/script>/, "");
    if (scenario === "payload-hash") body = body.replace(/"payloadHash":"[a-f0-9]{64}"/, `"payloadHash":"${"0".repeat(64)}"`);
    if (scenario === "stale") body = body.replace(`"date":"${testUtcDate}"`, `"date":"${staleDate}"`);
    await scenarioPage.route(`**/__r3a__/${scenario}/`, (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
    await scenarioPage.route("**/api/daily/current", (route) => { requests += 1; return route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); });
    await scenarioPage.goto(`${origin}/__r3a__/${scenario}/`); await waitUnavailable(scenarioPage); assert.equal(requests, 1); assert.equal((await state(scenarioPage)).cards, 0);
    record("/", "1440x900", `${scenario} embedded fallback`, "request API once then fail closed", `requests=${requests}; state=unavailable`); assertNoPageErrors(context); await context.close();
  }
  const staleApiContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(staleApiContext); const staleApiPage = await staleApiContext.newPage();
  const missingHtml = homeHtml.replace(/<script id="pokesort-puzzle-data"[\s\S]*?<\/script>/, "");
  await staleApiPage.route("**/__r3a__/api-stale/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: missingHtml }));
  await staleApiPage.route("**/api/daily/current", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, status: "ready", utcDate: staleDate, manifest: {} }) }));
  await staleApiPage.goto(`${origin}/__r3a__/api-stale/`); await waitUnavailable(staleApiPage); assert.equal((await state(staleApiPage)).cards, 0);
  record("/", "1440x900", "API returns yesterday", "fail closed and show no stale board", "state=unavailable; cards=0"); assertNoPageErrors(staleApiContext); await staleApiContext.close();

  const fixedManifest = JSON.parse(await readFile(resolve("data/puzzles/public-daily", `${fixedRuntimeDate}.json`), "utf8"));
  const currentApiContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(currentApiContext, fixedRuntimeDate); const currentApiPage = await currentApiContext.newPage(); let currentApiRequests = 0;
  await currentApiPage.route("**/__r3a__/api-current/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: missingHtml }));
  await currentApiPage.route("**/api/daily/current", (route) => { currentApiRequests += 1; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, status: "ready", utcDate: fixedRuntimeDate, puzzleId: fixedManifest.puzzleId, contentHash: fixedManifest.contentHash, manifest: fixedManifest }) }); });
  await currentApiPage.goto(`${origin}/__r3a__/api-current/`); await waitReady(currentApiPage); assert.equal(currentApiRequests, 1);
  assert.ok((await events(currentApiPage)).some(({ name, parameters }) => name === "pokesort_board_ready" && parameters.outcome === "api" && Number.isSafeInteger(parameters.load_ms)));
  record("/", "1440x900", "missing embedded with current valid API", "one API request and board_ready outcome=api", `requests=${currentApiRequests}; state=ready`); assertNoPageErrors(currentApiContext); await currentApiContext.close();

  const archiveHtml = await readFile(resolve(dist, "daily", fixedRuntimeDate, "index.html"), "utf8");
  const brokenArchiveHtml = archiveHtml.replace(/"payloadHash":"[a-f0-9]{64}"/, `"payloadHash":"${"0".repeat(64)}"`);
  const brokenArchiveContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(brokenArchiveContext, fixedRuntimeDate); const brokenArchivePage = await brokenArchiveContext.newPage(); let brokenArchiveApiRequests = 0;
  await brokenArchivePage.route(`**/daily/${fixedRuntimeDate}/`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: brokenArchiveHtml }));
  brokenArchivePage.on("request", (request) => { if (request.url().endsWith("/api/daily/current")) brokenArchiveApiRequests += 1; });
  await brokenArchivePage.goto(`${origin}/daily/${fixedRuntimeDate}/`); await waitUnavailable(brokenArchivePage); assert.equal(brokenArchiveApiRequests, 0);
  record(`/daily/${fixedRuntimeDate}/`, "1440x900", "damaged archive embedded payload", "fail closed without current API", `requests=${brokenArchiveApiRequests}; state=unavailable`); assertNoPageErrors(brokenArchiveContext); await brokenArchiveContext.close();

  const sourceIndex = JSON.parse(await readFile(resolve(dist, "assets/infinite/index.json"), "utf8")); const overlapIndex = JSON.parse(await readFile(resolve(dist, "assets/infinite-overlaps/index.json"), "utf8"));
  const poolIndex = (sourceIndex.sequence.offset + 0 * sourceIndex.sequence.step) % sourceIndex.poolSize, sourceEntry = sourceIndex.shards.find((entry) => poolIndex >= entry.start && poolIndex < entry.start + entry.count);
  const overlapEntry = overlapIndex.shards.find(({ sourceShard }) => sourceShard === sourceEntry.file), originalOverlapShard = JSON.parse(await readFile(resolve(dist, `assets/infinite-overlaps/${overlapEntry.file}`), "utf8"));
  for (const scenario of ["missing", "hash", "puzzle-id", "source-content-hash"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await installCapture(context); const scenarioPage = await context.newPage();
    if (scenario === "missing") await scenarioPage.route(`**/assets/infinite-overlaps/${overlapEntry.file}`, (route) => route.fulfill({ status: 404, body: "{}" }));
    if (scenario === "hash") await scenarioPage.route("**/assets/infinite-overlaps/index.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...overlapIndex, contentHash: "0".repeat(64) }) }));
    if (scenario === "puzzle-id" || scenario === "source-content-hash") {
      const mutatedShard = structuredClone(originalOverlapShard);
      if (scenario === "puzzle-id") mutatedShard.puzzles[poolIndex - sourceEntry.start].puzzleId = "infinite-wrong";
      else mutatedShard.puzzles[poolIndex - sourceEntry.start].sourceContentHash = "0".repeat(64);
      const hashedShard = withHash(mutatedShard);
      const mutatedIndex = structuredClone(overlapIndex); mutatedIndex.shards.find(({ file }) => file === overlapEntry.file).contentHash = hashedShard.contentHash; const hashedIndex = withHash(mutatedIndex);
      await scenarioPage.route("**/assets/infinite-overlaps/index.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hashedIndex) }));
      await scenarioPage.route(`**/assets/infinite-overlaps/${overlapEntry.file}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hashedShard) }));
    }
    await scenarioPage.goto(`${origin}/infinite/`); await waitUnavailable(scenarioPage); const loadErrors = (await events(scenarioPage)).filter(({ name }) => name === "pokesort_load_error");
    assert.equal(loadErrors.at(-1).parameters.error_stage, "infinite_overlap_contract"); assert.equal((await state(scenarioPage)).cards, 0); assert.doesNotMatch(await scenarioPage.locator("#game-status").innerText(), /http|Error|stack/i);
    record("/infinite/", "1440x900", `${scenario} overlap contract`, "fail closed with safe infinite_overlap_contract event", `state=unavailable; stage=${loadErrors.at(-1).parameters.error_stage}`); assertNoPageErrors(context); await context.close();
  }

  assertNoPageErrors(desktop); await desktop.tracing.stop({ path: join(evidenceDirectory, "desktop-trace.zip") }); await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } }); await installCapture(mobile); await mobile.tracing.start({ screenshots: true, snapshots: true }); const mobilePage = await mobile.newPage();
  for (const route of ["/", "/infinite/", "/daily/2026-08-25/", "/archive/", "/how-to-play/", "/pokelike-pokesort/today/"]) {
    await mobilePage.goto(`${origin}${route}`); if (["/", "/infinite/", "/daily/2026-08-25/"].includes(route)) await waitReady(mobilePage);
    const dimensions = await mobilePage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth })); assert.ok(dimensions.scrollWidth <= dimensions.innerWidth);
    if (route === "/pokelike-pokesort/today/") { assert.equal(await mobilePage.locator('meta[name="robots"]').getAttribute("content"), "noindex,follow"); assert.match(await mobilePage.locator("main").innerText(), /PUBLICATION HELD/); }
    record(route, "390x844", "responsive route check", "no horizontal overflow", `${dimensions.scrollWidth}<=${dimensions.innerWidth}`);
  }
  await mobilePage.goto(`${origin}/`); await waitReady(mobilePage); await mobilePage.screenshot({ path: join(evidenceDirectory, "mobile-daily.png"), fullPage: true });
  await mobilePage.goto(`${origin}/pokelike-pokesort/today/`); await mobilePage.screenshot({ path: join(evidenceDirectory, "mobile-today.png"), fullPage: true });
  assertNoPageErrors(mobile); await mobile.tracing.stop({ path: join(evidenceDirectory, "mobile-trace.zip") }); await mobile.close();

  console.log(JSON.stringify({ gate: "PASS", cases: results.length, results, analyticsPrivacy: { allowedKeys: [...allowedKeys].sort(), forbiddenDataFound: false }, evidenceDirectory }, null, 2));
} finally {
  await browser.close(); if (server) await new Promise((accept) => server.close(accept));
}
