import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright";

const origin = (process.env.POKESORT_PRODUCTION_ORIGIN || "https://pokesort.org").replace(/\/$/, "");
assert.equal(origin, "https://pokesort.org", "production smoke is pinned to the canonical production origin");
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const request = (url, options = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...options });
const expectRedirect = async (from, to) => {
  const response = await request(from);
  check(response.status === 308, `${from} must return 308; received ${response.status}`);
  check(response.headers.get("location") === to, `${from} must redirect to ${to}; received ${response.headers.get("location")}`);
  return { from, status: response.status, location: response.headers.get("location") };
};
const schemas = (html) => [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));

const redirects = [
  await expectRedirect("http://pokesort.org/", `${origin}/`),
  await expectRedirect("https://www.pokesort.org/", `${origin}/`),
  await expectRedirect("http://www.pokesort.org/archive/?source=production-smoke&check=origin", `${origin}/archive/?source=production-smoke&check=origin`),
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

const sitemapResponse = await request(`${origin}/sitemap.xml`);
check(sitemapResponse.status === 200, `sitemap must return 200; received ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
check(sitemapUrls.length > 0, "sitemap must contain URLs");
check(sitemapUrls.every((url) => url.startsWith(`${origin}/`) && !url.includes("www.")), "sitemap must contain only HTTPS apex URLs");

const robotsResponse = await request(`${origin}/robots.txt`);
check(robotsResponse.status === 200, `robots.txt must return 200; received ${robotsResponse.status}`);
const robots = await robotsResponse.text();
check(new RegExp(`^Sitemap:\\s+${origin.replaceAll(".", "\\.")}\/sitemap\\.xml\\s*$`, "m").test(robots), "robots.txt must declare the canonical sitemap");

const launchOptions = process.env.POKESORT_CHROME_PATH
  ? { executablePath: process.env.POKESORT_CHROME_PATH }
  : process.platform === "win32" ? { channel: process.env.POKESORT_BROWSER_CHANNEL || "chrome" } : {};
const browser = await chromium.launch({ headless: true, ...launchOptions });
let runtime;
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__pokesortRuntime?.state?.().loadState === "ready", null, { timeout: 30_000 });
  runtime = await page.evaluate(() => globalThis.__pokesortRuntime.state());
  check(runtime.loadState === "ready", `homepage game must enter ready state; received ${runtime.loadState}`);
  check(runtime.dateKey === new Date().toISOString().slice(0, 10), `Daily dateKey must equal the current UTC date; received ${runtime.dateKey}`);
} catch (error) {
  failures.push(`homepage runtime check failed: ${error.message}`);
} finally {
  await browser.close();
}

const result = { gate: failures.length ? "FAIL" : "PASS", origin, redirects, homepage: homeResponse.status, canonical: homeCanonical ?? null, ogSiteName: siteName ?? null, website: websiteSchemas[0] ?? null, sitemapUrls: sitemapUrls.length, robotsSitemap: `${origin}/sitemap.xml`, runtime: runtime ? { loadState: runtime.loadState, dateKey: runtime.dateKey } : null, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) throw new Error(`Production smoke failed:\n- ${failures.join("\n- ")}`);
