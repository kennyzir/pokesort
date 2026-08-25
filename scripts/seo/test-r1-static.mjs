import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const dist = new URL("../../dist/", import.meta.url);
const readDist = (path) => readFile(new URL(path, dist), "utf8");
const schemas = (html) => [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const one = (values, label) => {
  assert.equal(values.length, 1, `${label} must occur exactly once`);
  return values[0];
};
const metadata = (html, attribute, value) => one([...html.matchAll(new RegExp(`<meta\\s+${attribute}="${value}"\\s+content="([^"]+)"`, "g"))].map((match) => match[1]), `${value} metadata`);
const canonical = (html) => one([...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((match) => match[1]), "canonical");

const home = await readDist("index.html");
assert.match(home, /<title>PokeSort 4×4 Daily — Pokémon Grouping Puzzle<\/title>/, "R1 must not change the homepage title");
assert.match(home, /name="description"\s+content="Play today's free PokeSort 4×4 grouping puzzle\. Sort 16 Pokémon into four hidden groups, protect your streak, or practice in 4×4 Infinite mode\."/s, "R1 must not change the homepage description");
assert.match(home, /<h1>Find four groups in today’s 4×4 PokeSort<\/h1>/, "R1 must not change the homepage H1");
const embeddedPuzzle = JSON.parse(one([...home.matchAll(/<script id="pokesort-puzzle-data" type="application\/json">([\s\S]*?)<\/script>/g)].map((match) => match[1]), "home puzzle payload"));
const pages = [
  { label: "home", path: "index.html", url: "https://pokesort.org/", html: home },
  { label: "Infinite", path: "infinite/index.html", url: "https://pokesort.org/infinite/", html: await readDist("infinite/index.html") },
  { label: "Daily", path: `daily/${embeddedPuzzle.date}/index.html`, url: `https://pokesort.org/daily/${embeddedPuzzle.date}/`, html: await readDist(`daily/${embeddedPuzzle.date}/index.html`) },
];

for (const page of pages) {
  const pageSchemas = schemas(page.html);
  const website = one(pageSchemas.filter((schema) => schema["@type"] === "WebSite"), `${page.label} WebSite schema`);
  const application = one(pageSchemas.filter((schema) => schema["@type"] === "WebApplication"), `${page.label} WebApplication schema`);
  assert.equal(website["@id"], "https://pokesort.org/#website");
  assert.equal(website.name, "PokeSort 4×4");
  assert.deepEqual(website.alternateName, ["PokeSort", "Poke Sort", "pokesort.org"]);
  assert.equal(website.url, "https://pokesort.org/", `${page.label} WebSite URL must remain the root homepage`);
  assert.equal(application.url, page.url, `${page.label} WebApplication URL must match the current page`);
  assert.deepEqual(application.isPartOf, { "@id": "https://pokesort.org/#website" });
  assert.equal(canonical(page.html), page.url, `${page.label} canonical must match the current page`);
  assert.equal(metadata(page.html, "property", "og:site_name"), "PokeSort 4×4");
}

assert(home.indexOf('"@type": "WebApplication"') < home.indexOf('"@type": "WebSite"'), "WebSite schema must follow WebApplication in the homepage source");
const notFound = await readDist("404.html");
assert(!schemas(notFound).some((schema) => schema["@type"] === "WebApplication"), "404 must not retain WebApplication schema");

let htmlFiles = 0;
async function inspectDist(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) await inspectDist(url);
    else {
      const contents = await readFile(url);
      assert(!contents.includes(Buffer.from("pokesort.example")), `dist/${decodeURIComponent(url.pathname.split("/dist/")[1])} contains pokesort.example`);
      if (entry.name.endsWith(".html")) {
        htmlFiles += 1;
        const html = contents.toString("utf8");
        assert.equal((html.match(/property="og:site_name"/g) || []).length, 1, `${decodeURIComponent(url.pathname)} must contain exactly one og:site_name`);
        assert.match(html, /<meta\s+property="og:site_name"\s+content="PokeSort 4×4"\s*\/?>/);
      }
    }
  }
}
await inspectDist(dist);

const sitemap = await readDist("sitemap.xml");
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert(locations.length > 0, "sitemap must contain URLs");
assert(locations.every((url) => url.startsWith("https://pokesort.org/") && !url.includes("www.")), "sitemap URLs must use only the HTTPS apex origin");

const manifest = JSON.parse(await readDist("manifest.webmanifest"));
assert.equal(manifest.name, "PokeSort 4×4 — Daily Pokémon Puzzle");
assert.equal(manifest.short_name, "PokeSort");
const workflow = await readFile(new URL("../../.github/workflows/production-smoke.yml", import.meta.url), "utf8");
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /cron: "25 0 \* \* \*"/);
assert.match(workflow, /cron: "25 12 \* \* \*"/);
assert.match(workflow, /for attempt in 1 2 3 4 5 6 7/);
assert.match(workflow, /sleep 60/);
assert.match(workflow, /exit 1/);

const { default: edgeWorker } = await import(new URL("_worker.js", dist));
const assetPass = new Response("asset-pass", { status: 209 });
const env = { ASSETS: { fetch: async () => assetPass } };
const edgeFetch = (url) => edgeWorker.fetch(new Request(url), env);
const redirectCases = [
  ["http://pokesort.org/", "https://pokesort.org/"],
  ["https://www.pokesort.org/archive/?ref=r1", "https://pokesort.org/archive/?ref=r1"],
  ["http://www.pokesort.org/daily/test/?a=1&b=2", "https://pokesort.org/daily/test/?a=1&b=2"],
];
for (const [from, to] of redirectCases) {
  const response = await edgeFetch(from);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), to);
  const destination = await edgeFetch(to);
  assert.notEqual(destination.status, 308, `redirect destination must not loop: ${to}`);
}
for (const url of ["http://preview.pokesort.org/path/?next=https://evil.example", "http://pokesort.org.evil.example/path/"]) {
  assert.strictEqual(await edgeFetch(url), assetPass, `unapproved host must not be canonicalized: ${url}`);
}

console.log(JSON.stringify({ gate: "PASS", pages: pages.map(({ label, url }) => ({ label, url })), htmlFiles, sitemapUrls: locations.length, redirectCases: redirectCases.length, openRedirectCases: 2 }, null, 2));
