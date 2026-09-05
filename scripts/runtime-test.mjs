import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";

const dist = new URL("../dist/", import.meta.url);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    let relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (relative.endsWith("/")) relative += "index.html";
    let file = new URL(relative, dist), statusCode = 200;
    try { if (!(await stat(file)).isFile()) throw new Error(); }
    catch { file = new URL("404.html", dist); statusCode = 404; }
    const extension = file.pathname.slice(file.pathname.lastIndexOf("."));
    response.writeHead(statusCode, { "content-type": types[extension] || "application/octet-stream" });
    response.end(await readFile(file));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const launch = process.env.POKESORT_CHROME_PATH ? { executablePath: process.env.POKESORT_CHROME_PATH } : { channel: process.env.POKESORT_BROWSER_CHANNEL || "chrome" };
const browser = await chromium.launch({ headless: true, ...launch });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.route("https://raw.githubusercontent.com/**", (route) => route.abort());
await context.addInitScript(() => { Object.defineProperty(navigator, "share", { configurable: true, value: async ({ text }) => { globalThis.__pokesortShared = text; } }); });
const page = await context.newPage(), pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const assert = (value, message) => { if (!value) throw new Error(`Runtime regression: ${message}`); };
const cards = () => page.locator(".poke-card");
const select = async (names) => { for (const name of names) await cards().filter({ hasText: name }).click(); };
const submit = () => page.locator("#submit-selection").click();
const clearAndReload = async () => { await page.evaluate(() => localStorage.clear()); await page.reload(); await cards().first().waitFor(); };
const dailyPackFor = async (date) => {
  const manifest = JSON.parse(await readFile(new URL(`../data/puzzles/public-daily/${date}.json`, import.meta.url), "utf8"));
  return manifest.groups.map((group) => ({ name: group.label, hint: group.hint, mons: group.members.map(({ name, id }) => [name, id]) }));
};
const infinitePackFor = async (round) => {
  const index = JSON.parse(await readFile(new URL("../data/puzzles/infinite/index.json", import.meta.url), "utf8"));
  const poolIndex = (index.sequence.offset + (round % index.poolSize) * index.sequence.step) % index.poolSize;
  const entry = index.shards.find((shard) => poolIndex >= shard.start && poolIndex < shard.start + shard.count);
  const shard = JSON.parse(await readFile(new URL(`../data/puzzles/infinite/${entry.file}`, import.meta.url), "utf8"));
  return shard.puzzles[poolIndex - entry.start].groups.map((group) => ({ name: group.label, mons: group.members.map(({ name, id }) => [name, id]) }));
};

try {
  const today = new Date().toISOString().slice(0, 10), dailyPack = await dailyPackFor(today);
  await page.goto(`${base}/`); await cards().first().waitFor();
  assert(await cards().count() === 16, "Daily must render 16 cards at 390×844");

  const focusName = dailyPack[0].mons[0][0];
  await cards().filter({ hasText: focusName }).click();
  assert(await cards().filter({ hasText: focusName }).getAttribute("aria-pressed") === "true", "selection must expose pressed state");
  assert(await page.evaluate(() => document.activeElement?.textContent?.trim()) === focusName, "selection rerender must restore focus");
  await page.keyboard.press("ArrowRight");
  assert(await page.evaluate(() => document.activeElement?.matches(".poke-card")), "arrow keys must keep focus in the grid");

  await clearAndReload();
  await select(dailyPack[0].mons.map(([name]) => name)); await submit();
  assert(await page.locator(".solved-group").count() === 1, "a correct Daily group must lock");
  await page.reload(); await cards().first().waitFor();
  assert(await page.locator(".solved-group").count() === 1 && await cards().count() === 12, "solved progress must restore from localStorage");

  await clearAndReload();
  const oneAwayNames = await page.evaluate(() => {
    const puzzle = JSON.parse(document.querySelector("#pokesort-puzzle-data").textContent);
    const valid = new Set(puzzle.validQuartets);
    for (const group of puzzle.groups) {
      const three = group.mons.slice(0, 3).map(([name, id]) => ({ name, id }));
      for (const card of puzzle.cards.filter(({ id }) => !group.mons.some(([, memberId]) => memberId === id))) {
        const signature = [...three.map(({ id }) => id), card.id].sort((a, b) => a - b).join("-");
        if (!valid.has(signature)) return [...three.map(({ name }) => name), card.name];
      }
    }
    return [];
  });
  assert(oneAwayNames.length === 4, "Daily board must provide a non-overlap one-away fixture");
  await select(oneAwayNames); await submit();
  assert((await page.locator("#game-status").textContent()).includes("One away"), "three matching members must report One Away");
  await page.locator("#hint-button").click();
  assert((await page.locator("#game-status").textContent()).length > 5, "Hint must expose useful text");

  await clearAndReload();
  const overlapNames = await page.evaluate(() => {
    const puzzle = JSON.parse(document.querySelector("#pokesort-puzzle-data").textContent);
    const intended = new Set(puzzle.groups.map((group) => group.mons.map(([, id]) => id).sort((a, b) => a - b).join("-")));
    const signature = puzzle.validQuartets.find((item) => !intended.has(item));
    const ids = signature?.split("-").map(Number) || [];
    return ids.map((id) => puzzle.cards.find((card) => card.id === id)?.name);
  });
  assert(overlapNames.length === 4 && overlapNames.every(Boolean), "Daily payload must include at least one factual overlap fixture");
  const overlapBefore = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  const overlapCardsBefore = await cards().count();
  const overlapSolvedBefore = await page.locator(".solved-group").count();
  await select(overlapNames); await submit();
  const overlapAfter = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  const overlapStatus = await page.locator("#game-status").textContent();
  assert(overlapAfter.mistakes === overlapBefore.mistakes, "a factual overlap must not consume a mistake");
  assert(await page.locator(".solved-group").count() === overlapSolvedBefore, "a factual overlap must not solve a group");
  assert(await cards().count() === overlapCardsBefore, "a factual overlap must not remove or lock cards");
  assert(await page.locator('.poke-card[aria-pressed="true"]').count() === 0, "a factual overlap must clear the current selection");
  assert(!overlapAfter.gameOver, "a factual overlap must not end the game");
  assert(overlapStatus.includes("real canonical fact") && overlapStatus.includes("No mistake charged"), "a factual overlap must explain the valid fact and no-penalty outcome");

  await clearAndReload();
  const invalidNames = await page.evaluate(() => {
    const puzzle = JSON.parse(document.querySelector("#pokesort-puzzle-data").textContent);
    const valid = new Set(puzzle.validQuartets);
    const intendedGroups = puzzle.groups.map((group) => new Set(group.mons.map(([, id]) => id)));
    const cards = puzzle.cards;
    for (let a = 0; a < 13; a++) for (let b = a + 1; b < 14; b++) for (let c = b + 1; c < 15; c++) for (let d = c + 1; d < 16; d++) {
      const chosen = [cards[a], cards[b], cards[c], cards[d]];
      const signature = chosen.map(({ id }) => id).sort((left, right) => left - right).join("-");
      if (!valid.has(signature) && intendedGroups.every((group) => chosen.filter(({ id }) => group.has(id)).length < 3)) return chosen.map(({ name }) => name);
    }
    return [];
  });
  assert(invalidNames.length === 4, "Daily board must provide an unrelated quartet fixture");
  const invalidBefore = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  await select(invalidNames); await submit();
  const invalidAfter = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  assert(invalidBefore.mistakes === 0 && invalidAfter.mistakes === 1, "a factually invalid quartet must consume exactly one mistake");
  assert((await page.locator("#game-status").textContent()).includes("Not the connection"), "a factually invalid quartet must retain the unrelated feedback");

  await clearAndReload(); await page.locator("#reveal-board").click();
  assert((await page.locator("#game-status").textContent()).includes("revealed"), "Reveal must report a revealed board");
  assert(await page.evaluate(() => localStorage.getItem("pokesort-wins")) === null, "Reveal must not create a Daily win");

  await clearAndReload();
  const wrong = dailyPack.map((group) => group.mons[0][0]);
  for (let attempt = 0; attempt < 4; attempt++) { await select(wrong); await submit(); }
  assert((await page.locator("#mistakes").textContent()).includes("0"), "four failures must exhaust mistakes");
  assert(await cards().count() === 16 && await cards().evaluateAll((nodes) => nodes.every((node) => node.disabled)), "four failures must lock all cards");
  assert(await page.evaluate(() => localStorage.getItem("pokesort-wins")) === null, "failure must not create a Daily win");

  await clearAndReload();
  for (const group of dailyPack) { await select(group.mons.map(([name]) => name)); await submit(); }
  assert((await page.locator("#game-status").textContent()).includes("today’s PokeSort"), "Daily completion status must be mode-specific");
  assert(await page.evaluate((date) => JSON.parse(localStorage.getItem("pokesort-wins") || "[]").includes(date), today), "valid current Daily solve must record a win");
  await page.locator("#share-result").click();
  assert((await page.evaluate(() => globalThis.__pokesortShared)).includes(`${base}/`), "Daily share must use the canonical home route");

  await page.locator('[data-mode="infinite"]').click(); await page.waitForURL(`${base}/infinite/#game`); await cards().first().waitFor();
  assert(await cards().count() === 16 && await page.locator("#new-infinite").isVisible(), "Infinite must render 16 cards and New puzzle");
  const firstInfiniteBoard = (await cards().allTextContents()).sort().join("|");
  const runtimePoolAudit = await page.evaluate(async () => {
    const index = await (await fetch("/assets/infinite/index.json")).json();
    const first500 = Array.from({ length: 500 }, (_, round) => (index.sequence.offset + round * index.sequence.step) % index.poolSize);
    const shardStatuses = await Promise.all(index.shards.map(async ({ file }) => (await fetch(`/assets/infinite/${file}`)).status));
    return { unique: new Set(first500).size, shardStatuses };
  });
  assert(runtimePoolAudit.unique === 500 && runtimePoolAudit.shardStatuses.every((status) => status === 200), "Infinite runtime must expose 500 no-repeat selections and every validated shard");
  const winsBefore = await page.evaluate(() => localStorage.getItem("pokesort-wins"));
  for (const group of await infinitePackFor(0)) { await select(group.mons.map(([name]) => name)); await submit(); }
  assert((await page.locator("#game-status").textContent()).includes("Infinite puzzle #1"), "Infinite completion status must name its round");
  assert(await page.evaluate(() => localStorage.getItem("pokesort-wins")) === winsBefore, "Infinite must not change Daily wins");
  await page.locator("#share-result").click();
  const shared = await page.evaluate(() => globalThis.__pokesortShared);
  assert(shared.includes("PokeSort Infinite #1") && shared.includes(`${base}/infinite/`), "Infinite share must use its round and canonical route");
  await page.evaluate(() => { void globalThis.__pokesortRuntime.newInfinite(); void globalThis.__pokesortRuntime.newInfinite(); });
  await page.waitForFunction(() => document.querySelector("#game-kicker")?.textContent?.includes("#3") && document.querySelectorAll(".poke-card").length === 16);
  assert((await cards().allTextContents()).sort().join("|") !== firstInfiniteBoard, "rapid New Infinite requests must settle on the latest different verified board");
  const latestInfinitePack = await infinitePackFor(2);
  await select(latestInfinitePack[0].mons.map(([name]) => name)); await submit();
  assert(await page.locator(".solved-group").count() === 1, "rapid Infinite loads must not let a stale shard response replace the latest round");
  await page.locator('[data-mode="daily"]').click(); await page.waitForURL(`${base}/#game`);

  const inWindow = new Date(`${today}T00:00:00Z`); inWindow.setUTCDate(inWindow.getUTCDate() - 3);
  const inDate = inWindow.toISOString().slice(0, 10);
  await page.goto(`${base}/?date=${inDate}`); await page.waitForURL(`${base}/daily/${inDate}/`); await cards().first().waitFor();
  assert(await cards().count() === 16, "in-window legacy date must migrate to a playable static route");
  const inDatePack = await dailyPackFor(inDate);
  await select(inDatePack[0].mons.map(([name]) => name)); await submit();
  assert(await page.locator(".solved-group").count() === 1, "dated route must use its exact immutable manifest");
  const outside = new Date(`${today}T00:00:00Z`); outside.setUTCDate(outside.getUTCDate() - 31);
  const outDate = outside.toISOString().slice(0, 10);
  await page.evaluate((date) => localStorage.removeItem(`pokesort-daily-${date}`), today);
  await page.goto(`${base}/?date=${outDate}`); await cards().first().waitFor();
  assert(new URL(page.url()).searchParams.get("date") === outDate && await cards().count() === 16, "out-of-window legacy URL must remain browser-compatible");
  assert((await page.locator("#game-kicker").textContent()).includes(today) && !(await page.locator("#game-kicker").textContent()).includes(outDate), "an unavailable legacy date must honestly fall back to today's immutable board");

  await page.evaluate((date) => localStorage.removeItem(`pokesort-daily-${date}`), today);
  await page.goto(`${base}/?date=2026-00-99`); await cards().first().waitFor();
  assert((await page.locator("#game-kicker").textContent()).includes(today) && !(await page.locator("#game-kicker").textContent()).includes("2026-00-99"), "invalid calendar dates must fall back to today's board");
  await page.evaluate((date) => { localStorage.setItem("pokesort-wins", "{}"); localStorage.setItem(`pokesort-daily-${date}`, JSON.stringify({ cards: [], solved: {}, mistakes: -4 })); localStorage.setItem("pokesort-infinite-round", "not-a-round"); localStorage.removeItem("pokesort-infinite-0"); }, today);
  await page.goto(`${base}/`); await cards().first().waitFor();
  assert(await cards().count() === 16 && (await page.locator("#streak-count").textContent()) === "0", "corrupt saved game and wins data must safely reset");
  await page.goto(`${base}/infinite/`); await cards().first().waitFor();
  assert((await page.locator("#game-kicker").textContent()).includes("#1"), "invalid Infinite round storage must safely reset to round one");

  await page.goto(`${base}/pokelike-pokesort/`);
  assert((await page.locator("h1").textContent()).includes("six-Pokémon"), "Pokelike guide must identify the six-Pokémon task");
  assert(await page.locator("[data-slot]").count() === 6 && await page.locator("[data-link]").count() === 5, "Pokelike worksheet must expose six positions and five links");
  await page.locator('[data-slot="0"]').fill("Bulbasaur");
  await page.locator('[data-link="0"]').selectOption({ label: "Generation" });
  await page.locator("#worksheet-notes").fill("Check the left-to-right direction.");
  await page.reload();
  assert(await page.locator('[data-slot="0"]').inputValue() === "Bulbasaur" && await page.locator('[data-link="0"]').inputValue() === "Generation", "Pokelike worksheet must restore local progress");
  assert((await page.locator("#worksheet-notes").inputValue()).includes("left-to-right"), "Pokelike worksheet notes must restore locally");
  await page.locator("#clear-worksheet").click();
  assert(await page.locator('[data-slot="0"]').inputValue() === "" && await page.evaluate(() => localStorage.getItem("pokesort-pokelike-worksheet")) === null, "Pokelike worksheet clear must remove saved progress");

  await page.goto(`${base}/pokelike-pokesort/today/`);
  assert(await page.locator("main").getAttribute("data-today-state") === "unavailable", "default Today route must expose a held state");
  assert((await page.locator("main").textContent()).includes("No answer is being shown"), "held Today route must explain that no answer is shown");
  assert(await page.locator("[data-answer-position]").count() === 0, "held Today route must not leak a stale answer");

  await page.goto(`${base}/archive/`);
  assert(await page.locator("#archive-grid .archive-card").count() === 31, "Archive must keep the latest 31 puzzles as its primary recent view");
  const yearHref = await page.locator('a[href^="/archive/20"]').filter({ hasText: "archive" }).first().getAttribute("href");
  assert(/^\/archive\/\d{4}\/$/.test(yearHref || ""), "Archive must expose a year discovery link on mobile");
  const monthHref = await page.locator('a[href^="/archive/20"]').filter({ hasText: "Browse month" }).first().getAttribute("href");
  assert(/^\/archive\/\d{4}\/\d{2}\/$/.test(monthHref || ""), "Archive must expose mobile month discovery links");
  await page.goto(`${base}${yearHref}`);
  assert(await page.locator('a[href^="/archive/"][href$="/"]').filter({ hasText: /2026/ }).count() > 0, "year Archive must render an elapsed month link on mobile");
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "year Archive must not overflow the 390px mobile viewport");
  await page.goto(`${base}${monthHref}`);
  assert(await page.locator(".archive-card").count() > 0, "monthly Archive must render elapsed date cards on mobile");
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!bodyOverflow, "monthly Archive must not overflow the 390px mobile viewport");
  const datedHref = await page.locator('.archive-card[href^="/daily/"]').first().getAttribute("href");
  assert(/^\/daily\/\d{4}-\d{2}-\d{2}\/$/.test(datedHref || ""), "monthly Archive must link to real dated pages");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/archive/`);
  assert(await page.locator("#archive-grid .archive-card").count() === 31, "desktop Archive must preserve the same latest-31 primary view");
  await page.goto(`${base}${yearHref}`);
  assert(await page.locator(`a[href="${monthHref}"]`).count() === 1, "desktop year Archive must link its published month");
  await page.goto(`${base}${monthHref}`);
  assert(await page.locator('.archive-card[href^="/daily/"]').count() > 0, "desktop month Archive must expose dated pages");
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "desktop month Archive must not overflow its viewport");

  const missing = await page.goto(`${base}/not-a-real-route/`);
  assert(missing.status() === 404, "unknown routes must return HTTP 404 in the smoke server");
  assert(pageErrors.length === 0, `page errors occurred: ${pageErrors.join("; ")}`);
  console.log("Browser runtime validation passed in Chrome: gameplay at 390×844 plus mobile/desktop Archive year/month discovery, Pokelike worksheet, and 404.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
