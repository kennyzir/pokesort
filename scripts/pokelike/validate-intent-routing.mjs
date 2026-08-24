import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_DIST = new URL("../../dist/", import.meta.url);
const PUBLISHED_ROUTES = ["/", "/infinite/", "/archive/", "/how-to-play/", "/categories/", "/pokelike-pokesort/", "/about/", "/pokesort-down/", "/privacy/"];

const assert = (condition, message) => { if (!condition) throw new Error(`Intent routing: ${message}`); };
const routeFile = (route) => route === "/" ? "index.html" : `${route.slice(1)}index.html`;
const text = (html, pattern) => html.match(pattern)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
const metadata = (html) => ({
  title: text(html, /<title>([\s\S]*?)<\/title>/i),
  description: text(html, /<meta\s+name="description"\s+content="([^"]+)"/i),
  h1: text(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
  canonical: text(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i),
  ogTitle: text(html, /<meta\s+property="og:title"\s+content="([^"]+)"/i),
  ogDescription: text(html, /<meta\s+property="og:description"\s+content="([^"]+)"/i),
  ogUrl: text(html, /<meta\s+property="og:url"\s+content="([^"]+)"/i),
});
const schemas = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((match) => JSON.parse(match[1]));
const answerIntent = /\b(answer|solution|hint)\b/i;

export async function validateIntentRouting(dist = DEFAULT_DIST) {
  const sitemap = await readFile(new URL("sitemap.xml", dist), "utf8");
  const sitemapRoutes = [...sitemap.matchAll(/<loc>https:\/\/pokesort\.org([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert(PUBLISHED_ROUTES.every((route) => sitemapRoutes.includes(route)), `sitemap must preserve all nine protected indexable routes: ${PUBLISHED_ROUTES.join(", ")}`);
  assert(sitemapRoutes.every((route) => PUBLISHED_ROUTES.includes(route) || /^\/daily\/\d{4}-\d{2}-\d{2}\/$/.test(route) || /^\/archive\/\d{4}\/(?:\d{2}\/)?$/.test(route)), "sitemap may add only validated immutable 4×4 Daily and Archive discovery routes beyond the protected route set");
  assert(!sitemapRoutes.includes("/pokelike-pokesort/today/"), "held Today route must remain absent from the sitemap");

  for (const route of [...PUBLISHED_ROUTES, "/pokelike-pokesort/today/"]) await access(new URL(routeFile(route), dist));
  const home = await readFile(new URL("index.html", dist), "utf8");
  const infinite = await readFile(new URL("infinite/index.html", dist), "utf8");
  const archive = await readFile(new URL("archive/index.html", dist), "utf8");
  const howTo = await readFile(new URL("how-to-play/index.html", dist), "utf8");
  const guide = await readFile(new URL("pokelike-pokesort/index.html", dist), "utf8");
  const today = await readFile(new URL("pokelike-pokesort/today/index.html", dist), "utf8");

  const distinct = new Map();
  for (const [route, html] of [["/", home], ["/infinite/", infinite], ["/archive/", archive], ["/how-to-play/", howTo], ["/pokelike-pokesort/", guide], ["/pokelike-pokesort/today/", today]]) {
    const values = metadata(html);
    for (const field of ["title", "description", "h1", "canonical", "ogTitle", "ogDescription", "ogUrl"]) assert(values[field], `${route} is missing ${field}`);
    assert(values.canonical === `https://pokesort.org${route}` && values.ogUrl === values.canonical, `${route} canonical and OG URL must be self-referential`);
    assert(!distinct.has(values.title), `${route} duplicates the title of ${distinct.get(values.title)}`);
    distinct.set(values.title, route);
  }

  for (const [route, html] of [["/", home], ["/infinite/", infinite], ["/archive/", archive], ["/how-to-play/", howTo]]) {
    const values = metadata(html);
    assert([values.title, values.description, values.h1].every((value) => value.includes("4×4")), `${route} title, description, and H1 must identify the independent 4×4 task`);
  }
  for (const entry of await readdir(new URL("daily/", dist), { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const values = metadata(await readFile(new URL(`daily/${entry.name}/index.html`, dist), "utf8"));
    assert([values.title, values.description, values.h1].every((value) => value.includes("4×4")), `/daily/${entry.name}/ must identify the independent 4×4 task`);
  }

  const guideMeta = metadata(guide);
  assert(!answerIntent.test([guideMeta.title, guideMeta.description, guideMeta.h1, ...schemas(guide).map(JSON.stringify)].join(" ")), "evergreen guide metadata/schema must not compete for dated answer or hint intent");
  assert(/six-Pokémon|6-Pokémon/.test(guideMeta.title + guideMeta.description + guideMeta.h1), "evergreen guide must identify its six-Pokémon rules task");
  assert(guide.includes('href="/pokelike-pokesort/today/">Check Today answer availability — publication currently held'), "evergreen guide must link to Today with an honest held-availability label");

  const todayMeta = metadata(today);
  assert(answerIntent.test(todayMeta.title) && /Today/i.test(todayMeta.title) && answerIntent.test(todayMeta.description), "Today metadata must own the dated answer/hint intent");
  assert(today.includes('name="robots" content="noindex,follow"') && today.includes('data-today-state="unavailable"'), "default Today page must remain held, noindex, and unavailable");
  assert(!today.includes("data-answer-position"), "held Today HTML must not contain an answer payload");
  const todayWebPage = schemas(today).find((schema) => schema["@type"] === "WebPage");
  assert(todayWebPage?.url === "https://pokesort.org/pokelike-pokesort/today/" && answerIntent.test(todayWebPage.name), "Today WebPage schema must use the self-canonical answer-intent identity");
  assert(schemas(guide).some((schema) => schema["@type"] === "WebPage" && schema.url === "https://pokesort.org/pokelike-pokesort/"), "evergreen guide must retain its separate self-canonical WebPage schema");
  assert(schemas(home).some((schema) => schema["@type"] === "WebApplication" && /4×4/.test(schema.name)), "home schema must identify the 4×4 application");
  assert(schemas(infinite).some((schema) => schema["@type"] === "WebApplication" && /4×4 Infinite/.test(schema.name)), "Infinite schema must identify the distinct 4×4 Infinite task");
  assert(schemas(archive).some((schema) => schema["@type"] === "CollectionPage" && /4×4/.test(schema.name)), "Archive schema must identify the 4×4 collection");

  for (const [route, html] of [["/", home], ["/pokelike-pokesort/", guide]]) {
    for (const match of html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (answerIntent.test(label) && /Today|Pokelike|Pokésort/i.test(label)) assert(match[1] === "/pokelike-pokesort/today/", `${route} answer-intent anchor “${label}” must route only to Today`);
    }
  }

  return { indexableRoutes: sitemapRoutes.length, protectedRoutes: PUBLISHED_ROUTES.length, todayIndexed: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await validateIntentRouting();
  console.log(`Pokelike intent routing passed: all ${result.protectedRoutes} protected routes retained within ${result.indexableRoutes} indexable routes; Today held/noindex.`);
}
