import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright";

const origin = (process.env.POKESORT_PRODUCTION_ORIGIN || "https://pokesort.org").replace(/\/$/, "");
assert.equal(origin, "https://pokesort.org", "production smoke is pinned to the canonical production origin");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const request = (url, options = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...options });
const permanentStatuses = new Set([301, 308]);
const allowedHosts = new Set(["pokesort.org", "www.pokesort.org"]);
const inspectRedirectChain = async (from, expectedFinal) => {
  const hops = [];
  let current = from, response;
  for (;;) {
    response = await request(current);
    if (!permanentStatuses.has(response.status)) {
      check(!(response.status >= 300 && response.status < 400), `${from} used non-permanent redirect status ${response.status}`);
      break;
    }
    const location = response.headers.get("location");
    check(Boolean(location), `${current} returned ${response.status} without Location`);
    if (!location) break;
    const destination = new URL(location, current);
    check(allowedHosts.has(destination.hostname), `${current} redirected to unapproved host ${destination.hostname}`);
    check(destination.protocol === "https:", `${current} redirected to non-HTTPS destination ${destination}`);
    hops.push({ from: current, status: response.status, location: destination.toString() });
    if (hops.length > 2) {
      failures.push(`${from} exceeded two permanent redirects`);
      break;
    }
    check(destination.toString() !== current, `${current} formed a redirect loop`);
    current = destination.toString();
  }
  check(current === expectedFinal, `${from} must finish at ${expectedFinal}; received ${current}`);
  check(response?.status === 200, `${from} final response must be 200; received ${response?.status}`);
  return { from, finalUrl: current, finalStatus: response?.status, hops };
};
const schemas = (html) => [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));

const redirectChains = [
  await inspectRedirectChain("http://pokesort.org/", `${origin}/`),
  await inspectRedirectChain("http://pokesort.org/infinite/?source=test", `${origin}/infinite/?source=test`),
  await inspectRedirectChain("http://www.pokesort.org/archive/?source=test&check=origin", `${origin}/archive/?source=test&check=origin`),
  await inspectRedirectChain("https://www.pokesort.org/", `${origin}/`),
  await inspectRedirectChain(`${origin}/`, `${origin}/`),
  await inspectRedirectChain("http://pokesort.org/?next=https%3A%2F%2Fevil.example%2F", `${origin}/?next=https%3A%2F%2Fevil.example%2F`),
];

const homeResponse = await request(`${origin}/`);
check(homeResponse.status === 200, `HTTPS homepage must return 200; received ${homeResponse.status}`);
const home = await homeResponse.text();
const homeCanonical = home.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
const siteName = home.match(/<meta\s+property="og:site_name"\s+content="([^"]+)"/)?.[1];
check(homeCanonical === `${origin}/`, `homepage canonical must be ${origin}/; received ${homeCanonical}`);
check(siteName === "PokeSort 4×4", `homepage og:site_name must be PokeSort 4×4; received ${siteName}`);
const websiteSchemas = schemas(home).filter((schema) => schema["@type"] === "WebSite");
const expectedWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${origin}/#website`,
  name: "PokeSort 4×4",
  alternateName: ["PokeSort", "Poke Sort", "pokesort.org"],
  url: `${origin}/`,
};
check(websiteSchemas.length === 1, `homepage must contain exactly one WebSite schema; received ${websiteSchemas.length}`);
check(isDeepStrictEqual(websiteSchemas[0], expectedWebsite), `homepage WebSite schema is incorrect; received ${JSON.stringify(websiteSchemas[0])}`);
check(!home.includes("pokesort.example") && !home.includes("monsort.com"), "homepage must not contain placeholder origins");

const sitemapResponse = await request(`${origin}/sitemap.xml`);
check(sitemapResponse.status === 200, `sitemap must return 200; received ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
check(sitemapUrls.length > 0, "sitemap must contain URLs");
check(sitemapUrls.every((url) => url.startsWith(`${origin}/`) && !url.includes("www.")), "sitemap must contain only HTTPS apex URLs");
check(!sitemap.includes("pokesort.example") && !sitemap.includes("monsort.com"), "sitemap must not contain placeholder origins");

const robotsResponse = await request(`${origin}/robots.txt`);
check(robotsResponse.status === 200, `robots.txt must return 200; received ${robotsResponse.status}`);
const robots = await robotsResponse.text();
check(new RegExp(`^Sitemap:\\s+${origin.replaceAll(".", "\\.")}\/sitemap\\.xml\\s*$`, "m").test(robots), "robots.txt must declare the canonical sitemap");

const launchOptions = process.env.POKESORT_CHROME_PATH
  ? { executablePath: process.env.POKESORT_CHROME_PATH }
  : process.platform === "win32" ? { channel: process.env.POKESORT_BROWSER_CHANNEL || "chrome" } : {};
const browser = await chromium.launch({ headless: true, ...launchOptions });
let runtime, infinite, archive, today;
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__pokesortRuntime?.state?.().loadState === "ready", null, { timeout: 30_000 });
  runtime = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  check(runtime.loadState === "ready", `homepage game must enter ready state; received ${runtime.loadState}`);
  check(runtime.dateKey === new Date().toISOString().slice(0, 10), `Daily dateKey must equal the current UTC date; received ${runtime.dateKey}`);
  await page.goto(`${origin}/infinite/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__pokesortRuntime?.state?.().loadState === "ready", null, { timeout: 30_000 });
  infinite = await page.evaluate(() => ({ ...globalThis.__pokesortRuntime.state(), cards: document.querySelectorAll(".poke-card").length }));
  check(infinite.mode === "infinite" && infinite.loadState === "ready" && infinite.cards === 16, `Infinite must be ready with 16 cards; received ${JSON.stringify(infinite)}`);
  const archiveResponse = await page.goto(`${origin}/archive/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  archive = { status: archiveResponse?.status(), cards: await page.locator("#archive-grid .archive-card").count() };
  check(archive.status === 200 && archive.cards > 0, `Archive must open with published cards; received ${JSON.stringify(archive)}`);
  const todayResponse = await page.goto(`${origin}/pokelike-pokesort/today/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  today = await page.evaluate(() => ({ state: document.querySelector("main")?.dataset.todayState, robots: document.querySelector('meta[name="robots"]')?.content, answers: document.querySelectorAll("[data-answer-position]").length }));
  check(todayResponse?.status() === 200 && today.state === "unavailable" && today.robots?.includes("noindex") && today.answers === 0, `Today must remain held, noindex, and answer-free; received ${JSON.stringify(today)}`);
} catch (error) {
  failures.push(`browser runtime check failed: ${error.message}`);
} finally {
  await browser.close();
}

const result = { gate: failures.length ? "FAIL" : "PASS", origin, redirectChains, homepage: homeResponse.status, canonical: homeCanonical ?? null, ogSiteName: siteName ?? null, website: websiteSchemas[0] ?? null, sitemapUrls: sitemapUrls.length, robotsSitemap: `${origin}/sitemap.xml`, runtime: runtime ? { loadState: runtime.loadState, dateKey: runtime.dateKey } : null, infinite: infinite ? { mode: infinite.mode, loadState: infinite.loadState, cards: infinite.cards } : null, archive, today, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) throw new Error(`Production smoke failed:\n- ${failures.join("\n- ")}`);
