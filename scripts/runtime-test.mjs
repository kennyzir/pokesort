import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { chromium } from "playwright";
import { puzzleFor } from "../assets/puzzle-data.js";

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

try {
  const today = new Date().toISOString().slice(0, 10), dailyPack = puzzleFor(today);
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
  await select([...dailyPack[0].mons.slice(0, 3).map(([name]) => name), dailyPack[1].mons[0][0]]); await submit();
  assert((await page.locator("#game-status").textContent()).includes("One away"), "three matching members must report One Away");
  await page.locator("#hint-button").click();
  assert((await page.locator("#game-status").textContent()).length > 5, "Hint must expose useful text");

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
  const winsBefore = await page.evaluate(() => localStorage.getItem("pokesort-wins"));
  for (const group of puzzleFor("infinite-0")) { await select(group.mons.map(([name]) => name)); await submit(); }
  assert((await page.locator("#game-status").textContent()).includes("Infinite puzzle #1"), "Infinite completion status must name its round");
  assert(await page.evaluate(() => localStorage.getItem("pokesort-wins")) === winsBefore, "Infinite must not change Daily wins");
  await page.locator("#share-result").click();
  const shared = await page.evaluate(() => globalThis.__pokesortShared);
  assert(shared.includes("PokeSort Infinite #1") && shared.includes(`${base}/infinite/`), "Infinite share must use its round and canonical route");
  await page.locator('[data-mode="daily"]').click(); await page.waitForURL(`${base}/#game`);

  const inWindow = new Date(`${today}T00:00:00Z`); inWindow.setUTCDate(inWindow.getUTCDate() - 3);
  const inDate = inWindow.toISOString().slice(0, 10);
  await page.goto(`${base}/?date=${inDate}`); await page.waitForURL(`${base}/daily/${inDate}/`); await cards().first().waitFor();
  assert(await cards().count() === 16, "in-window legacy date must migrate to a playable static route");
  const outside = new Date(`${today}T00:00:00Z`); outside.setUTCDate(outside.getUTCDate() - 31);
  const outDate = outside.toISOString().slice(0, 10);
  await page.goto(`${base}/?date=${outDate}`); await cards().first().waitFor();
  assert(new URL(page.url()).searchParams.get("date") === outDate && await cards().count() === 16, "out-of-window legacy date must remain compatible");
  for (const group of puzzleFor(outDate)) { await select(group.mons.map(([name]) => name)); await submit(); }
  await page.locator("#share-result").click();
  assert((await page.evaluate(() => globalThis.__pokesortShared)).includes(`${base}/?date=${outDate}`), "out-of-window legacy share must preserve its playable query URL");

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

  const missing = await page.goto(`${base}/not-a-real-route/`);
  assert(missing.status() === 404, "unknown routes must return HTTP 404 in the smoke server");
  assert(pageErrors.length === 0, `page errors occurred: ${pageErrors.join("; ")}`);
  console.log("Browser runtime validation passed in Chrome at 390×844: Daily, reveal/failure, Infinite, storage, share, keyboard, legacy dates, Pokelike worksheet, and 404.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
