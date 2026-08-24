import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ARCHIVE_HISTORY_DAYS, GROUPS } from "../assets/puzzle-data.js";

const root = new URL("../", import.meta.url);
const dist = process.env.POKESORT_BUILD_OUTPUT ? pathToFileURL(`${resolve(process.env.POKESORT_BUILD_OUTPUT)}${sep}`) : new URL("../dist/", import.meta.url);
const { default: edgeWorker, ARCHIVE_NEWEST_DATE, ARCHIVE_OLDEST_DATE } = await import(new URL("_worker.js", dist));
const readRoot = (path) => readFile(new URL(path, root), "utf8");
const readDist = (path) => readFile(new URL(path, dist), "utf8");
const count = (text, pattern) => (text.match(pattern) || []).length;
const fail = (message) => { throw new Error(`Product regression: ${message}`); };

const assetPass = new Response("asset-pass", { status: 209 });
const edgeEnv = { ASSETS: { fetch: async () => assetPass } };
const edgeFetch = (url) => edgeWorker.fetch(new Request(url), edgeEnv);
const wwwRedirect = await edgeFetch("https://www.pokesort.org/archive/?ref=test");
if (wwwRedirect.status !== 308 || wwwRedirect.headers.get("location") !== "https://pokesort.org/archive/?ref=test") fail("www host must permanently redirect to apex while preserving the path and query");
const infiniteRedirect = await edgeFetch("https://pokesort.org/?mode=infinite&utm_source=test");
if (infiniteRedirect.status !== 308 || infiniteRedirect.headers.get("location") !== "https://pokesort.org/infinite/") fail("legacy Infinite query must permanently redirect to its clean route");
const shiftDate = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const dateRedirect = await edgeFetch(`https://pokesort.org/?date=${ARCHIVE_NEWEST_DATE}`);
if (dateRedirect.status !== 308 || dateRedirect.headers.get("location") !== `https://pokesort.org/daily/${ARCHIVE_NEWEST_DATE}/`) fail("in-window date query must permanently redirect to its static route");
const oldForEdge = shiftDate(ARCHIVE_OLDEST_DATE, -1), afterBuildForEdge = shiftDate(ARCHIVE_NEWEST_DATE, 1);
const oldDateResponse = await edgeFetch(`https://pokesort.org/?date=${oldForEdge}`);
if (oldDateResponse !== assetPass) fail("out-of-window date query must remain browser-compatible instead of redirecting to a missing route");
const afterBuildResponse = await edgeFetch(`https://pokesort.org/?date=${afterBuildForEdge}`);
if (afterBuildResponse !== assetPass) fail("a request after the build window must not redirect to a static date route that was never generated");
for (const invalidDate of ["2026-07-32", "2026-08-00", "2026-02-29"]) {
  const invalidDateResponse = await edgeFetch(`https://pokesort.org/?date=${invalidDate}`);
  if (invalidDateResponse !== assetPass) fail(`invalid calendar date must pass through instead of redirecting to a missing route: ${invalidDate}`);
}
const ordinaryResponse = await edgeFetch("https://pokesort.org/categories/");
if (ordinaryResponse !== assetPass) fail("ordinary requests must pass through to Pages static assets");
const heldDailyApi = await edgeFetch("https://pokesort.org/api/daily/current");
if (heldDailyApi.status !== 404 || heldDailyApi.headers.get("cache-control") !== "no-store") fail("Daily API must remain safely disabled without the reversible activation flag");
const missingDailyBinding = await edgeWorker.fetch(new Request("https://pokesort.org/api/daily/current"), { ...edgeEnv, DAILY_API_ENABLED: "true", DAILY_ENVIRONMENT: "production" });
if (missingDailyBinding.status !== 503) fail("an enabled Daily API without its KV binding must fail closed");
const emittedWorker = await readDist("_worker.js");
if (/^import\s/m.test(emittedWorker) || !emittedWorker.includes("handleDailyRequest") || !emittedWorker.includes("DAILY_API_ENABLED")) fail("Advanced Mode worker must contain the composed Daily API contract without unresolved imports");

// Protected product baseline: routes, home depth, controls, and authored data.
const protectedRoutes = ["index.html", "archive/index.html", "how-to-play/index.html", "pokesort-alternative/index.html", "pokesort-down/index.html", "privacy/index.html"];
for (const route of protectedRoutes) await access(new URL(route, dist));
const home = await readRoot("index.html");
if (count(home, /<section\b/g) !== 3) fail("homepage must retain its three primary sections");
if (count(home, /<button\b/g) !== 9) fail("homepage must retain nine mode/game controls");
for (const id of ["puzzle-grid", "shuffle-board", "deselect-all", "submit-selection", "hint-button", "reveal-board", "share-result", "new-infinite"]) if (!home.includes(`id="${id}"`)) fail(`missing control ${id}`);
if (GROUPS.length !== 3 || GROUPS.flat().length !== 12 || GROUPS.flatMap((pack) => pack.flatMap((group) => group.mons)).length !== 48) fail("legacy authored puzzle fixtures must remain 3 packs / 12 groups / 48 Pokémon");

// Browser behavior invariants caught during Phase 3.
const game = await readRoot("assets/game.js");
for (const marker of ["pokesort-daily-", "pokesort-infinite-", "pokesort-infinite-round", "pokesort-wins"]) if (!game.includes(marker)) fail(`missing localStorage key family ${marker}`);
for (const fragment of [
  'location.assign(button.dataset.mode === "infinite" ? "/infinite/#game" : "/#game")',
  'fetchJson("/assets/infinite/index.json", { signal })',
  'document.querySelector(\'meta[name="pokesort-edge-daily"]\')?.content === "enabled"',
  'fetchJson("/api/daily/current", { signal: controller.signal, cache: "no-store" })',
  'activeLoadController?.abort()',
  'stored.mode !== mode || stored.puzzleId !== activePuzzleId || stored.contentHash !== activeContentHash',
  'loadState = next',
  'Verified puzzle data is unavailable; no fallback board was substituted.',
  'if (revealed) { $("#game-status").textContent = "Board revealed."; save(); return; }',
  'mode === "daily" && !pathDate && mistakes < 4',
  'gameOver = mistakes >= 4; selected = []; save(); render();',
  'revealed = true; gameOver = true; solved = pack.map((group) => group.name)',
  '!interactive ? " disabled" : ""',
]) if (!game.includes(fragment)) fail(`missing runtime safety invariant: ${fragment}`);

// Source and emitted game/data assets must be byte-identical.
for (const asset of ["assets/game.js", "assets/puzzle-data.js", "assets/pokelike-worksheet.js", "assets/pokelike-today.js", "assets/styles.css", "assets/logo-mark.svg", "assets/social-card.png", "manifest.webmanifest"]) {
  const source = await readFile(new URL(asset, root));
  const emitted = await readFile(new URL(asset, dist));
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  if (digest(source) !== digest(emitted)) fail(`${asset} differs between source and dist`);
}
const infiniteIndex = JSON.parse(await readRoot("data/puzzles/infinite/index.json"));
if (infiniteIndex.poolSize !== 1000 || infiniteIndex.sequence.guaranteedNoRepeatRounds !== 1000 || infiniteIndex.shards.length !== 20) fail("Infinite pool index must expose 1,000 verified no-repeat rounds in 20 shards");
for (const asset of ["index.json", ...infiniteIndex.shards.map(({ file }) => file)]) {
  const source = await readFile(new URL(`data/puzzles/infinite/${asset}`, root));
  const emitted = await readFile(new URL(`assets/infinite/${asset}`, dist));
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  if (digest(source) !== digest(emitted)) fail(`Infinite asset ${asset} differs between source and dist`);
}

// Every Archive choice must have exact data, publication policy, and navigation.
const archive = await readDist("archive/index.html");
const dates = [...archive.matchAll(/href="\/daily\/(\d{4}-\d{2}-\d{2})\//g)].map((match) => match[1]);
if (dates.length !== ARCHIVE_HISTORY_DAYS + 1 || new Set(dates).size !== dates.length) fail("Archive must expose 31 unique static dates");
const expectedDates = []; const cursor = new Date();
for (let offset = 0; offset <= ARCHIVE_HISTORY_DAYS; offset++) { expectedDates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() - 1); }
if (dates.join("|") !== expectedDates.join("|")) fail("Archive must be the exact continuous UTC today-plus-30 range in newest-first order");
const builtHome = await readDist("index.html");
if (builtHome.includes('meta name="pokesort-edge-daily" content="enabled"')) fail("edge Daily browser loading must remain feature-flagged OFF in the default production build");
if (!builtHome.includes('legacyParams.get("mode")==="infinite"') || !builtHome.includes(`legacyDate>=\"${dates.at(-1)}\"`) || !builtHome.includes(`legacyDate<=\"${dates[0]}\"`)) fail("legacy query fallback must cover Infinite and only the generated date window");
const archiveBoardSignatures = new Set();
for (const [index, date] of dates.entries()) {
  const html = await readDist(`daily/${date}/index.html`);
  const manifest = JSON.parse(await readRoot(`data/puzzles/public-daily/${date}.json`));
  if (manifest.date !== date || manifest.groups.length !== 4 || manifest.cards.length !== 16 || manifest.solver.solutionCount !== 1) fail(`${date} has an invalid immutable manifest`);
  if (archiveBoardSignatures.has(manifest.boardSignature)) fail(`${date} repeats an Archive board signature`);
  archiveBoardSignatures.add(manifest.boardSignature);
  for (const group of manifest.groups) {
    for (const value of [group.label, group.hint, group.explanation, ...group.members.map(({ name }) => name)]) if (!html.includes(value)) fail(`${date} is missing exact puzzle value: ${value}`);
  }
  const payloadText = html.match(/<script id="pokesort-puzzle-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  const payload = payloadText ? JSON.parse(payloadText) : null;
  if (!payload || payload.puzzleId !== manifest.puzzleId || payload.date !== date || payload.boardSignature !== manifest.boardSignature || payload.cards.length !== 16 || payload.groups.length !== 4) fail(`${date} is missing its exact playable payload`);
  if (!html.includes("exactly one four-group member partition")) fail(`${date} is missing its solver-backed overlap boundary`);
  if (!html.includes(`Puzzle #${manifest.contentHash.slice(0, 8).toUpperCase()}`) || !html.includes(`immutable UTC board for ${date}`)) fail(`${date} is missing its immutable date-specific playable-board introduction`);
  if (html.includes('name="robots" content="noindex,follow"')) fail(`${date} must be indexable after the unique-content release Gate`);
  if (index > 0 && !html.includes(`/daily/${dates[index - 1]}/`)) fail(`${date} is missing previous-date navigation`);
  if (index < dates.length - 1 && !html.includes(`/daily/${dates[index + 1]}/`)) fail(`${date} is missing next-date navigation`);
  for (const path of ["/archive/", "/how-to-play/", "/categories/"]) if (!html.includes(`href="${path}"`)) fail(`${date} is missing supporting link ${path}`);
}

const sitemap = await readDist("sitemap.xml");
const dailySitemapDates = [...sitemap.matchAll(/<loc>https:\/\/pokesort\.org\/daily\/(\d{4}-\d{2}-\d{2})\/<\/loc>/g)].map((match) => match[1]);
const calendarIndexForRelease = JSON.parse(await readRoot("data/puzzles/public-daily/index.json"));
const publishedCalendarDates = calendarIndexForRelease.entries.map(({ date }) => date).filter((date) => date <= dates[0]).sort().reverse();
if (dailySitemapDates.join("|") !== publishedCalendarDates.join("|")) fail("sitemap must retain every published immutable Daily page and exclude future manifests");
if (sitemap.includes("/pokelike-pokesort/today/")) fail("Pokelike Today sitemap release must remain held until publication Gate approval");
console.log("Product regression validation passed: protected routes/tasks, runtime safety, persistent unique Daily pages, and future-publication boundary.");
