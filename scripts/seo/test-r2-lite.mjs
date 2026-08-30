import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const root = resolve(new URL("../../", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const dist = resolve(root, "dist");
const expectedNavigation = [
  { key: "daily", href: "/", label: "Daily" },
  { key: "infinite", href: "/infinite/", label: "Infinite" },
  { key: "archive", href: "/archive/", label: "Archive" },
  { key: "how-to-play", href: "/how-to-play/", label: "How to Play" },
];
const expectedTopics = [
  { href: "/infinite/", label: "Play PokeSort Infinite" },
  { href: "/archive/", label: "Browse Daily Archive" },
  { href: "/how-to-play/", label: "How to Play PokeSort" },
  { href: "/categories/", label: "PokeSort Categories" },
  { href: "/pokelike-pokesort/", label: "Pokelike Pokésort Guide" },
];

const normalizeText = (value) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const attribute = (attributes, name) => attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
const anchors = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/g)].map((match) => ({
  attributes: match[1],
  href: attribute(match[1], "href"),
  key: attribute(match[1], "data-nav"),
  current: attribute(match[1], "aria-current"),
  label: normalizeText(match[2]),
}));
const nav = (html, file) => {
  const matches = [...html.matchAll(/<nav\s+aria-label="Main navigation">[\s\S]*?<\/nav>/g)];
  assert.equal(matches.length, 1, `${file} must contain exactly one main navigation`);
  return matches[0][0];
};
const expectedActiveKey = (path) => {
  if (path === "index.html") return "daily";
  if (path === "infinite/index.html") return "infinite";
  if (path === "how-to-play/index.html") return "how-to-play";
  if (path === "archive/index.html" || /^archive\/\d{4}(?:\/\d{2})?\/index\.html$/.test(path) || /^daily\/\d{4}-\d{2}-\d{2}\/index\.html$/.test(path)) return "archive";
  return null;
};
const normalizeNavigation = (value) => value.replace(/\s+aria-current="page"/g, "").replace(/\s+/g, " ").trim();
const htmlFiles = [];
const siteFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else {
      siteFiles.push(path);
      if (entry.name.endsWith(".html")) htmlFiles.push(path);
    }
  }
}
await collect(dist);

const pages = [];
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (!html.includes('class="site-header"')) continue;
  const path = relative(dist, file).split(sep).join("/");
  const mainNavigation = nav(html, path);
  const links = anchors(mainNavigation);
  assert.deepEqual(links.map(({ key, href, label }) => ({ key, href, label })), expectedNavigation, `${path} main navigation labels and targets`);
  assert.ok(links.every(({ href }) => !href.includes("?") && !href.includes("#game")), `${path} main navigation must use clean paths`);
  const current = links.filter(({ current }) => current !== null);
  assert.ok(current.every(({ current: value }) => value === "page"), `${path} only supports aria-current=page`);
  assert.ok(current.length <= 1, `${path} must have at most one current navigation item`);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, current.length, `${path} must not contain a second aria-current outside the main navigation`);
  const activeKey = expectedActiveKey(path);
  assert.deepEqual(current.map(({ key }) => key), activeKey ? [activeKey] : [], `${path} active navigation state`);
  pages.push({ path, html, mainNavigation });
}
assert.ok(pages.length >= 10, "expected all major generated pages to share the main navigation");
assert.equal(new Set(pages.map(({ mainNavigation }) => normalizeNavigation(mainNavigation))).size, 1, "all major pages must share one normalized main navigation HTML source");

const readRoute = (path) => readFile(resolve(dist, path, "index.html"), "utf8");
const home = await readFile(resolve(dist, "index.html"), "utf8");
const infinite = await readRoute("infinite");
const archive = await readRoute("archive");
const howTo = await readRoute("how-to-play");
const today = await readRoute("pokelike-pokesort/today");
const sitemap = await readFile(resolve(dist, "sitemap.xml"), "utf8");

assert.ok(!home.includes('href="/pokelike-pokesort/today/"'), "home must not link to held Today");
assert.ok(home.includes('href="/pokelike-pokesort/"'), "home must retain the Pokelike guide link");
const topicBlock = home.match(/<div class="topic-links">([\s\S]*?)<\/div>/)?.[1];
assert.ok(topicBlock, "home topic-links must exist");
assert.deepEqual(anchors(topicBlock).map(({ href, label }) => ({ href, label })), expectedTopics, "home topic-links must contain exactly the five approved links");
assert.ok(howTo.includes('<a href="/pokesort-down/">PokeSort troubleshooting guide</a>'), "How to Play must link to troubleshooting");
assert.match(today, /<meta name="robots" content="noindex,follow">/, "Today must remain noindex,follow");
assert.match(today, /data-today-state="unavailable"/, "Today must remain held");
assert.ok(!sitemap.includes("/pokelike-pokesort/today/"), "Today must remain outside the sitemap");

assert.equal(home.match(/<title>([\s\S]*?)<\/title>/)?.[1], "PokeSort 4×4 Daily — Pokémon Grouping Puzzle", "protected home title");
assert.equal(home.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1], "Play today's free PokeSort 4×4 grouping puzzle. Sort 16 Pokémon into four hidden groups, protect your streak, or practice in 4×4 Infinite mode.", "protected home description");
assert.equal(normalizeText(home.match(/<h1>[\s\S]*?<\/h1>/)?.[0] ?? ""), "Find four groups in today’s 4×4 PokeSort", "protected home H1");
assert.equal(home.match(/<link rel="canonical" href="([^"]+)"/)?.[1], "https://pokesort.org/", "protected home canonical");
assert.equal(home.match(/<meta\s+property="og:title"\s+content="([^"]+)"/s)?.[1], "PokeSort 4×4 Daily — Pokémon Grouping Puzzle", "protected home og:title");
assert.equal(home.match(/<meta property="og:site_name" content="([^"]+)"/)?.[1], "PokeSort 4×4", "protected site name");

const schemas = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const webApplicationSchemas = schemas(home).filter((schema) => schema["@type"] === "WebApplication");
assert.equal(webApplicationSchemas.length, 1, "home must retain one WebApplication schema");
assert.deepEqual(webApplicationSchemas[0], {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "PokeSort 4×4 Daily",
  applicationCategory: "GameApplication",
  operatingSystem: "Any",
  url: "https://pokesort.org/",
  isPartOf: { "@id": "https://pokesort.org/#website" },
  description: "A free 4×4 Pokémon grouping puzzle with one Daily board and a separate Infinite practice mode.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
}, "protected home WebApplication schema");
const websiteSchemas = schemas(home).filter((schema) => schema["@type"] === "WebSite");
assert.equal(websiteSchemas.length, 1, "home must contain exactly one WebSite schema");
assert.deepEqual(websiteSchemas[0], {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": "https://pokesort.org/#website",
  name: "PokeSort 4×4",
  alternateName: ["PokeSort", "Poke Sort", "pokesort.org"],
  url: "https://pokesort.org/",
}, "protected WebSite schema");
for (const { path, html } of pages) {
  for (const website of schemas(html).filter((schema) => schema["@type"] === "WebSite")) {
    assert.equal(website.url, "https://pokesort.org/", `${path} WebSite URL must remain the root homepage`);
  }
}

assert.ok(!(await Promise.all(siteFiles.map((file) => readFile(file)))).some((contents) => contents.includes("pokesort.example")), "dist must not contain pokesort.example");
assert.equal(infinite.match(/<title>([\s\S]*?)<\/title>/)?.[1], "PokeSort 4×4 Infinite – Unlimited Pokémon Grouping Puzzles", "protected Infinite title");
assert.equal(infinite.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1], "Play unlimited 4×4 Pokémon sorting puzzles. Infinite mode creates repeatable practice boards and never changes your Daily streak.", "protected Infinite description");
assert.ok(infinite.includes("<h1>Play unlimited 4×4 Pokémon sorting puzzles</h1>"), "Infinite route must remain generated");
assert.ok(archive.includes("<h1>PokeSort 4×4 Daily Archive</h1>"), "Archive route must remain generated");
const dailyRoutes = htmlFiles.filter((file) => /[\\/]daily[\\/]\d{4}-\d{2}-\d{2}[\\/]index\.html$/.test(file));
assert.ok(dailyRoutes.length > 0, "Daily routes must remain generated");

console.log(`SEO R2-Lite dist regression PASS: ${pages.length} shared-nav pages, ${dailyRoutes.length} Daily routes, protected identity and held Today intact.`);
