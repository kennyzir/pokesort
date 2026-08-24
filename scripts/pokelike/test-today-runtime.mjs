import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { renderTodayPage } from "./render-today.mjs";

const fixture = JSON.parse(await readFile(new URL("../../data/pokelike/fixtures/puzzle-54.verified.v1.json", import.meta.url), "utf8"));
const { html } = renderTodayPage({ manifests: [fixture], now: new Date("2026-08-24T05:00:00.000Z"), allowVerifiedPreview: true });
const analyticsClient = (await readFile(new URL("../../assets/pokelike-today-analytics.js", import.meta.url), "utf8")).replaceAll("export ", "");
const client = (await readFile(new URL("../../assets/pokelike-today.js", import.meta.url), "utf8")).replace(/^import .*\r?\n\r?\n/, "");
const documentHtml = html.replace('<script type="module" src="/assets/pokelike-today.js"></script>', `<script>${analyticsClient}\n${client}</script>`);
const launch = process.env.POKESORT_CHROME_PATH ? { executablePath: process.env.POKESORT_CHROME_PATH } : { channel: process.env.POKESORT_BROWSER_CHANNEL || "chrome" };
const browser = await chromium.launch({ headless: true, ...launch });
try {
  const matching = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Shanghai" });
  const page = await matching.newPage();
  await page.clock.install({ time: new Date("2026-08-24T05:00:00.000Z") });
  await page.setContent(documentHtml);
  assert.equal(await page.locator("[data-answer-position]").count(), 6);
  assert.equal(await page.locator("[data-link-explanation]").count(), 5);
  assert.equal(await page.locator("main").getAttribute("data-today-state"), "preview");
  assert.deepEqual(await page.evaluate(() => dataLayer.map(([command, name, parameters]) => ({ command, name, parameters }))), [
    { command: "event", name: "pokelike_today_view", parameters: { today_state: "preview" } },
  ]);
  const noSpoiler = page.locator('details[data-hint-level="0"]');
  await noSpoiler.locator("summary").click();
  const details = page.locator(".answer-reveal");
  await details.locator("summary").focus(); await page.keyboard.press("Enter");
  assert.equal(await details.evaluate((node) => node.open), true, "Enter on summary must reveal the answer with native details semantics");
  await page.locator('[data-today-analytics-target="official"]').evaluate((link) => link.addEventListener("click", (event) => event.preventDefault(), { once: true }));
  await page.locator('[data-today-analytics-target="official"]').click();
  assert.deepEqual(await page.evaluate(() => dataLayer.slice(1).map((entry) => entry[1])), [
    "pokelike_today_hint_open",
    "pokelike_today_answer_reveal",
    "pokelike_today_official_click",
  ]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "Today page must not overflow at 390px");
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "Today page must not overflow on desktop");
  assert.equal(await page.locator("details > summary").count(), fixture.hints.progressive.length + 2, "every spoiler level must use native details/summary semantics");
  await matching.close();

  const mismatching = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Los_Angeles" });
  const mismatchPage = await mismatching.newPage();
  await mismatchPage.clock.install({ time: new Date("2026-08-24T05:00:00.000Z") });
  await mismatchPage.setContent(documentHtml);
  assert.equal(await mismatchPage.locator("[data-answer-position]").count(), 0, "a different visitor local date must hide another date’s answer");
  assert.equal(await mismatchPage.locator("main").getAttribute("data-today-state"), "unavailable");
  assert.match(await mismatchPage.locator("main").textContent(), /2026-08-23/);
  assert.deepEqual(await mismatchPage.evaluate(() => dataLayer.map((entry) => [entry[1], entry[2]])), [
    ["pokelike_today_view", { today_state: "unavailable" }],
    ["pokelike_today_unavailable", { today_state: "unavailable", availability_reason: "local_date_mismatch" }],
  ]);
  await mismatching.close();
  console.log("Pokelike Today runtime tests passed at 390px and desktop: native keyboard disclosure and local-date mismatch fail closed.");
} finally { await browser.close(); }
