import { access, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARCHIVE_HISTORY_DAYS, GROUPS, PACK_NOTES } from "../assets/puzzle-data.js";
import { validateIntentRouting } from "./pokelike/validate-intent-routing.mjs";

const root = new URL("../", import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL("build.mjs", import.meta.url))], { cwd: fileURLToPath(root), stdio: "inherit", env: { ...process.env, SITE_URL: "https://pokesort.org" } });
const dist = new URL("../dist/", import.meta.url);
const expectedGaMeasurementId = (process.env.PUBLIC_GA_MEASUREMENT_ID ?? "G-JEJ6WJ88P3").trim();
const parseCsvLine = (line) => { const fields = []; let field = "", quoted = false; for (let i = 0; i < line.length; i++) { const character = line[i]; if (character === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; } else if (character === "," && !quoted) { fields.push(field); field = ""; } else field += character; } fields.push(field); return fields; };
const keywordMap = await readFile(new URL("../docs/seo/02-keyword-intent-map.csv", import.meta.url), "utf8");
const keywordRows = keywordMap.trim().split(/\r?\n/).map(parseCsvLine), keywordHeader = keywordRows.shift();
if (keywordHeader.length !== 15 || keywordRows.some((row) => row.length !== 15)) throw new Error("Keyword map must preserve the 15-field evidence and decision schema");
const queryIndex = keywordHeader.indexOf("query"), proposedIndex = keywordHeader.indexOf("proposed_target_url"), decisionIndex = keywordHeader.indexOf("decision");
if (new Set(keywordRows.map((row) => row[queryIndex])).size !== keywordRows.length) throw new Error("Keyword map must not contain duplicate queries");
const allowedDecisions = new Set(["BUILD", "IMPROVE", "MERGE", "HOLD", "DO_NOT_TARGET"]);
if (keywordRows.some((row) => !allowedDecisions.has(row[decisionIndex]))) throw new Error("Keyword map contains an unsupported decision");
for (const query of ["pokesort answer today", "pokesort solution today", "pokesort hint today", "today pokesort answer", "pokelike pokesort answer", "pokelike pokesort hint"]) { const row = keywordRows.find((item) => item[queryIndex] === query); if (!row || row[decisionIndex] !== "HOLD" || row[proposedIndex] !== "/pokelike-pokesort/today/") throw new Error(`${query} must be relevant but held at the verified Today data Gate`); }
for (const query of ["pokelike pokesort", "what is pokesort", "how to play pokelike pokesort", "pokesort tips"]) { const row = keywordRows.find((item) => item[queryIndex] === query); if (!row || row[decisionIndex] !== "BUILD" || row[proposedIndex] !== "/pokelike-pokesort/") throw new Error(`${query} must route to the evergreen Pokelike guide`); }
const keywordNarrative = await readFile(new URL("../docs/seo/02-keyword-intent-map.md", import.meta.url), "utf8");
if (keywordNarrative.includes("6-link-sequence:** do not target") || keywordNarrative.includes("Pokelike answer pages") || !keywordNarrative.includes("Pokésort is a Daily six-Pokémon minigame inside the parent game Pokelike")) throw new Error("Keyword narrative reintroduced the corrected Pokelike entity error");
if (GROUPS.length < 3 || PACK_NOTES.length !== GROUPS.length || GROUPS.some((pack) => pack.length !== 4 || pack.some((group) => group.mons.length !== 4 || !group.explanation))) throw new Error("Puzzle data must contain complete four-by-four packs, explanations, and overlap notes");
const required = ["index.html", "infinite/index.html", "archive/index.html", "how-to-play/index.html", "categories/index.html", "pokelike-pokesort/index.html", "pokelike-pokesort/today/index.html", "about/index.html", "pokesort-alternative/index.html", "pokesort-down/index.html", "privacy/index.html", "404.html", "favicon.ico", "assets/favicon-96x96.png", "assets/styles.css", "assets/game.js", "assets/puzzle-data.js", "assets/infinite/index.json", "assets/pokelike-worksheet.js", "assets/pokelike-today.js", "sitemap.xml", "robots.txt", "_redirects", "_worker.js"];
for (const file of required) await access(new URL(file, dist));
const favicon = await readFile(new URL("favicon.ico", dist));
const faviconCount = favicon.readUInt16LE(4);
const faviconSizes = Array.from({ length: faviconCount }, (_, index) => {
  const width = favicon[6 + index * 16] || 256;
  const height = favicon[7 + index * 16] || 256;
  return `${width}x${height}`;
});
if (favicon.readUInt16LE(0) !== 0 || favicon.readUInt16LE(2) !== 1 || !faviconSizes.includes("48x48") || !faviconSizes.includes("96x96")) throw new Error(`Root favicon.ico must contain valid 48px and 96px square icon frames; found ${faviconSizes.join(", ")}`);
const faviconPng = await readFile(new URL("assets/favicon-96x96.png", dist));
if (faviconPng.toString("ascii", 1, 4) !== "PNG" || faviconPng.readUInt32BE(16) !== 96 || faviconPng.readUInt32BE(20) !== 96) throw new Error("Search favicon must include a valid 96x96 PNG fallback");
const notFound = await readFile(new URL("404.html", dist), "utf8");
if (!notFound.includes('name="robots" content="noindex,follow"') || notFound.includes('rel="canonical"') || notFound.includes('WebApplication') || notFound.includes("URLSearchParams") || !/name="description"\s+content="The requested PokeSort page was not found\./s.test(notFound) || !/property="og:title"\s+content="Page not found – PokeSort"/s.test(notFound) || !/property="og:url"\s+content="https:\/\/pokesort\.org\/404\.html"/s.test(notFound) || !/name="twitter:title"\s+content="Page not found – PokeSort"/s.test(notFound)) throw new Error("404 metadata, robots, or schema is misleading");
const redirects = await readFile(new URL("_redirects", dist), "utf8");
if (redirects.includes("?mode=") || redirects.includes("?date=")) throw new Error("_redirects must not claim unsupported query matching");
const edgeWorker = await readFile(new URL("_worker.js", dist), "utf8");
if (!edgeWorker.includes('url.hostname === "www.pokesort.org"') || !edgeWorker.includes('url.searchParams.get("mode") === "infinite"') || !edgeWorker.includes('url.searchParams.get("date")') || !edgeWorker.includes("env.ASSETS.fetch(request)")) throw new Error("Pages edge worker must enforce host/query redirects and forward static assets");
const socialCard = await readFile(new URL("assets/social-card.png", dist));
if (socialCard.toString("ascii", 1, 4) !== "PNG" || socialCard.readUInt32BE(16) !== 1200 || socialCard.readUInt32BE(20) !== 630) throw new Error("Social card must be a valid 1200x630 PNG");
const alternative = await readFile(new URL("pokesort-alternative/index.html", dist), "utf8");
if (!alternative.includes('name="robots" content="noindex,follow"')) throw new Error("Held Alternative page must remain noindex,follow");
const privacy = await readFile(new URL("privacy/index.html", dist), "utf8");
if (!privacy.includes("raw.githubusercontent.com") || !privacy.includes("github-general-privacy-statement") || !privacy.includes("pokesort-pokelike-worksheet")) throw new Error("Privacy page must disclose the sprite and worksheet storage boundaries");
const pokelikeToday = await readFile(new URL("pokelike-pokesort/today/index.html", dist), "utf8");
if (!pokelikeToday.includes('data-today-state="unavailable"') || !pokelikeToday.includes('name="robots" content="noindex,follow"') || !pokelikeToday.includes("No answer is being shown") || pokelikeToday.includes("data-answer-position") || /Yamask|Flygon|Hitmonchan|Honedge|Palpitoad|Nosepass/.test(pokelikeToday)) throw new Error("default Today build must fail closed without emitting an answer");
const howTo = await readFile(new URL("how-to-play/index.html", dist), "utf8");
if (!howTo.includes("How to play PokeSort 4×4") || !howTo.includes("Pokédex color") || !howTo.includes("evolution-chain topology") || /fossil origin|fully evolved Fire starters|Item evolutions/.test(howTo)) throw new Error("How-to content must identify the 4×4 mechanic and describe only the versioned rule model");
const infinitePage = await readFile(new URL("infinite/index.html", dist), "utf8");
const categoriesPage = await readFile(new URL("categories/index.html", dist), "utf8");
const aboutPage = await readFile(new URL("about/index.html", dist), "utf8");
const pokelikePage = await readFile(new URL("pokelike-pokesort/index.html", dist), "utf8");
const downPage = await readFile(new URL("pokesort-down/index.html", dist), "utf8");
if (!infinitePage.includes("Play unlimited 4×4 Pokémon sorting puzzles") || !infinitePage.includes("finite pool of 1,000 source-backed boards") || !infinitePage.includes("1,000 no-repeat rounds") || !infinitePage.includes("Measured coverage includes type, exact dual type, generation, color, evolution stage, baby, legendary, mythical")) throw new Error("Infinite must expose its distinct 4×4 task and exactly the measured R3 finite-pool capabilities");
if (!categoriesPage.includes("PokeSort 4×4 category reference") || !categoriesPage.includes("101 enumerable predicates") || !categoriesPage.includes("does not infer alternate-form typing")) throw new Error("Categories must identify the current source-backed 4×4 rule model and exclusions");
if (!/This build contains \d+ public boards from \d{4}-\d{2}-\d{2} through \d{4}-\d{2}-\d{2}/.test(aboutPage) || !aboutPage.includes("future candidates are private inputs") || !aboutPage.includes("R3 PASS report supports these advertised families: type, exact dual type, generation, color, evolution stage, baby, legendary, mythical") || !aboutPage.includes("all 101 rule instances") || !aboutPage.includes("not counted as a ninth advertised Infinite family")) throw new Error("About page must disclose measured Daily/Infinite capability boundaries and solver methodology");
if (!pokelikePage.includes("Pokésort is a Daily minigame inside Pokelike") || !pokelikePage.includes("six Pokémon and five relationship clues") || !pokelikePage.includes("independent 4×4 grouping puzzle") || !pokelikePage.includes("does not fetch today’s board") || !pokelikePage.includes('href="https://pokelike.xyz/"')) throw new Error("Pokelike guide must preserve the parent/subgame relationship, mechanic boundary, official destination, and worksheet limitation");
if (!downPage.includes("Choose the PokeSort you are troubleshooting") || !downPage.includes("Pokelike’s Daily Pokésort") || !downPage.includes('href="/pokelike-pokesort/"') || !downPage.includes('href="https://pokelike.xyz/"')) throw new Error("Troubleshooting must disambiguate this 4×4 site from Pokelike Daily Pokésort");
const evidence = await readFile(new URL("../docs/content/puzzle-evidence.md", dist), "utf8");
const evidenceRows = evidence.split(/\r?\n/).filter((line) => /^\| \d+\./.test(line)).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
if (evidenceRows.length !== GROUPS.flat().length || !evidence.includes("community convention")) throw new Error("Every shipped puzzle group must have a review record and community-term boundary");
const evidenceRecords = JSON.parse(await readFile(new URL("../docs/content/puzzle-evidence.json", dist), "utf8"));
if (evidenceRecords.length !== GROUPS.flat().length) throw new Error("Machine-readable puzzle evidence must contain exactly one record per group");
for (const [packIndex, pack] of GROUPS.entries()) for (const group of pack) {
  const key = `${packIndex + 1}. ${group.name}`;
  const matches = evidenceRows.filter((row) => row[0] === key);
  const expectedMembers = group.mons.map(([name]) => name).sort().join("|");
  const recordedMembers = matches[0]?.[2].split(",").map((name) => name.trim()).sort().join("|");
  if (matches.length !== 1 || recordedMembers !== expectedMembers) throw new Error(`Puzzle evidence must exactly match ${key}: ${expectedMembers}`);
  const records = evidenceRecords.filter((record) => record.pack === packIndex + 1 && record.group === group.name);
  const record = records[0], expectedMemberData = group.mons.map(([name, id]) => `${name}:${id}`).sort().join("|");
  const recordedMemberData = record?.members?.map(({ name, id }) => `${name}:${id}`).sort().join("|");
  if (records.length !== 1 || recordedMemberData !== expectedMemberData || record.hint !== group.hint || record.explanation !== group.explanation) throw new Error(`Machine puzzle evidence must match IDs, hint, and explanation for ${key}`);
  if (!record.definition || !record.boundary || !record.sourceType || !/^\d{4}-\d{2}-\d{2}$/.test(record.reviewed) || !record.sources?.length || record.sources.some((source) => !source.startsWith("https://"))) throw new Error(`Machine puzzle evidence lacks definition, source, boundary, or review date for ${key}`);
}
const archive = await readFile(new URL("archive/index.html", dist), "utf8");
const archiveLinks = [...archive.matchAll(/href="\/daily\/(\d{4}-\d{2}-\d{2})\//g)].map((match) => match[1]);
if (archiveLinks.length !== ARCHIVE_HISTORY_DAYS + 1 || archive.includes("insertAdjacentHTML")) throw new Error(`Archive must server-render today plus ${ARCHIVE_HISTORY_DAYS} prior boards`);
const archiveMonths = new Set(archiveLinks.map((date) => date.slice(0, 7)));
if ([...archiveMonths].some((month) => !archive.includes(`href="/archive/${month.slice(0, 4)}/${month.slice(5)}/"`))) throw new Error("Archive must link every published month from its primary recent view");
for (const date of archiveLinks) await access(new URL(`daily/${date}/index.html`, dist));

const sitemap = await readFile(new URL("sitemap.xml", dist), "utf8");
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
if (!urls.length || urls.some((url) => url.includes("?") || !url.startsWith("https://pokesort.org/"))) throw new Error("Sitemap contains an invalid or parameterized URL");
const currentUtcDate = new Date().toISOString().slice(0, 10);
const dailyCalendarIndex = JSON.parse(await readFile(new URL("../data/puzzles/public-daily/index.json", import.meta.url), "utf8"));
const publishedDailyDates = dailyCalendarIndex.entries.map(({ date }) => date).filter((date) => date <= currentUtcDate).sort().reverse();
const publishedMonths = [...new Set(publishedDailyDates.map((date) => date.slice(0, 7)))];
const publishedYears = [...new Set(publishedMonths.map((month) => month.slice(0, 4)))];
const expectedPaths = ["/", "/infinite/", "/archive/", ...publishedYears.map((year) => `/archive/${year}/`), ...publishedMonths.map((month) => `/archive/${month.slice(0, 4)}/${month.slice(5)}/`), ...publishedDailyDates.map((date) => `/daily/${date}/`), "/how-to-play/", "/categories/", "/pokelike-pokesort/", "/about/", "/pokesort-down/", "/privacy/"];
const sitemapPaths = urls.map((url) => new URL(url).pathname);
if (sitemapPaths.length !== expectedPaths.length || expectedPaths.some((path) => !sitemapPaths.includes(path))) throw new Error(`Sitemap must contain the exact approved route set: ${expectedPaths.join(", ")}`);
const robots = await readFile(new URL("robots.txt", dist), "utf8");
if (robots !== "User-agent: *\nAllow: /\n\nSitemap: https://pokesort.org/sitemap.xml\n") throw new Error("robots.txt must contain the exact allow and apex sitemap policy");
if (urls.some((url) => /\/daily\/(\d{4}-\d{2}-\d{2})\//.exec(url)?.[1] > currentUtcDate)) throw new Error("Sitemap contains a future daily page");

const titles = new Map(), descriptions = new Map(), knownPaths = new Set([...urls.map((url) => new URL(url).pathname), ...archiveLinks.map((date) => `/daily/${date}/`), "/pokesort-alternative/", "/pokelike-pokesort/today/"]);
const mainTexts = [];
for (const url of urls) {
  const pathname = new URL(url).pathname;
  const file = pathname === "/" ? "index.html" : `${pathname.slice(1)}index.html`;
  const html = await readFile(new URL(file, dist), "utf8");
  if (!html.includes('rel="icon" href="/favicon.ico"')) throw new Error(`${pathname} must declare the stable root favicon URL`);
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1]?.trim();
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1]?.trim();
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/s)?.[1];
  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/s)?.[1];
  if (!title || !description || canonical !== url || ogUrl !== url) throw new Error(`${pathname} has invalid title, description, canonical, or OG URL (${canonical}; ${ogUrl})`);
  if (titles.has(title)) throw new Error(`Duplicate title: ${title}`); titles.set(title, pathname);
  if (descriptions.has(description)) throw new Error(`Duplicate description: ${description}`); descriptions.set(description, pathname);
  if ((html.match(/<h1[ >]/g) || []).length !== 1) throw new Error(`${pathname} must contain exactly one H1`);
  if (/<meta\s+name="robots"[^>]*content="[^"]*noindex/i.test(html)) throw new Error(`${pathname} is in the sitemap but noindexed`);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
  const requiredSchema = pathname === "/" || pathname === "/infinite/" ? "WebApplication" : pathname === "/pokesort-down/" ? "FAQPage" : pathname === "/pokelike-pokesort/" ? "WebPage" : null;
  if (requiredSchema && !schemas.some((schema) => schema["@type"] === requiredSchema)) throw new Error(`${pathname} must contain ${requiredSchema} structured data`);
  const socialChecks = [
    /property="og:title"\s+content="[^"]+"/s, /property="og:description"\s+content="[^"]+"/s,
    /property="og:type"\s+content="website"/s, new RegExp(`property="og:url"\\s+content="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "s"),
    /property="og:image"\s+content="https:\/\/pokesort\.org\/assets\/social-card\.png"/s,
    /name="twitter:card"\s+content="summary_large_image"/s, /name="twitter:title"\s+content="[^"]+"/s,
    /name="twitter:description"\s+content="[^"]+"/s, /name="twitter:image"\s+content="https:\/\/pokesort\.org\/assets\/social-card\.png"/s,
  ];
  if (socialChecks.some((pattern) => !pattern.test(html))) throw new Error(`${pathname} is missing route-level Open Graph or Twitter metadata`);
  for (const image of html.matchAll(/<img\s+([^>]+)>/g)) { const attrs = image[1]; if (!/\bwidth="\d+"/.test(attrs) || !/\bheight="\d+"/.test(attrs) || !/\balt="[^"]*"/.test(attrs)) throw new Error(`${pathname} has an image without width, height, or alt`); }
  const links = [...html.matchAll(/href="(\/[^"#?]*)/g)].map((match) => match[1]);
  if (!links.length) throw new Error(`${pathname} has no internal links`);
  for (const link of links) if (!link.startsWith("/assets/") && !knownPaths.has(link) && link !== "/manifest.webmanifest" && link !== "/favicon.ico") throw new Error(`${pathname} links to missing route ${link}`);
  if (pathname.startsWith("/daily/") && (!html.includes("<details>") || !html.includes("Puzzle #"))) throw new Error(`${pathname} is an empty daily template`);
  if (pathname.startsWith("/daily/") && ((html.match(/<details>/g) || []).length !== 6 || (html.match(/<summary>Reveal group \d<\/summary>/g) || []).length !== 4 || !html.includes("<h2>Likely overlap</h2>"))) throw new Error(`${pathname} lacks progressive hints, four group reveals, or overlap guidance`);
  if (pathname.startsWith("/daily/") && (!html.includes("<h2>Board profile</h2>") || !html.includes("exactly one complete partition"))) throw new Error(`${pathname} lacks its solver-backed unique board profile`);
  if (pathname.startsWith("/daily/") && !html.match(/property="og:title"\s+content="PokeSort 4×4 Daily Puzzle for \d{4}-\d{2}-\d{2}/s)) throw new Error(`${pathname} has inherited non-date OG metadata`);
  if (pathname.startsWith("/daily/") && !html.includes(`"url": "${url}"`)) throw new Error(`${pathname} has inherited homepage WebApplication URL`);
  mainTexts.push([pathname, (html.match(/<main[\s\S]*?<\/main>/)?.[0] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")]);
}

for (let i = 0; i < mainTexts.length; i++) for (let j = i + 1; j < mainTexts.length; j++) {
  if (mainTexts[i][0].startsWith("/daily/") && mainTexts[j][0].startsWith("/daily/")) continue;
  const left = new Set(mainTexts[i][1].toLowerCase().split(/\W+/).filter((word) => word.length > 4)), right = new Set(mainTexts[j][1].toLowerCase().split(/\W+/).filter((word) => word.length > 4));
  const similarity = [...left].filter((word) => right.has(word)).length / Math.max(1, new Set([...left, ...right]).size);
  if (similarity > 0.78) console.warn(`Content similarity warning: ${mainTexts[i][0]} and ${mainTexts[j][0]} (${similarity.toFixed(2)})`);
}

const indexableDailyCount = urls.filter((url) => new URL(url).pathname.startsWith("/daily/")).length;
if (indexableDailyCount !== publishedDailyDates.length) throw new Error("Every published immutable Daily page must remain in the sitemap");
for (const date of publishedDailyDates) {
  const html = await readFile(new URL(`daily/${date}/index.html`, dist), "utf8");
  const inSitemap = urls.includes(`https://pokesort.org/daily/${date}/`);
  const expectedUrl = `https://pokesort.org/daily/${date}/`;
  if (!sitemap.includes(`<loc>${expectedUrl}</loc><lastmod>${date}</lastmod>`)) throw new Error(`Daily ${date} needs its immutable publication date as sitemap lastmod`);
  if (!html.includes(`rel="canonical" href="${expectedUrl}"`) || !html.includes(`property="og:url" content="${expectedUrl}"`) || (html.match(/<h1[ >]/g) || []).length !== 1) throw new Error(`Daily ${date} has invalid canonical, OG URL, or H1`);
  if ((html.match(/<details>/g) || []).length !== 6 || (html.match(/<summary>Reveal group \d<\/summary>/g) || []).length !== 4 || !html.includes("<h2>Likely overlap</h2>")) throw new Error(`Daily ${date} lacks progressive hint and overlap content`);
  for (const json of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(json[1]);
  if (inSitemap === html.includes('name="robots" content="noindex,follow"')) throw new Error(`Daily ${date} has inconsistent sitemap/noindex policy`);
}
const builtHtmlFiles = [];
async function collectHtmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) await collectHtmlFiles(url);
    else if (entry.name.endsWith(".html")) builtHtmlFiles.push(url);
  }
}
await collectHtmlFiles(dist);
for (const file of builtHtmlFiles) {
  const html = await readFile(file, "utf8");
  const loaderCount = (html.match(/googletagmanager\.com\/gtag\/js\?id=/g) || []).length;
  const configCount = (html.match(/gtag\('config', 'G-[A-Z0-9]+', \{ page_location: location\.origin \+ location\.pathname, page_path: location\.pathname \}\)/g) || []).length;
  const containsExpectedId = !expectedGaMeasurementId || (html.includes(`gtag/js?id=${expectedGaMeasurementId}`) && html.includes(`gtag('config', '${expectedGaMeasurementId}', { page_location: location.origin + location.pathname, page_path: location.pathname })`));
  const expectedCount = expectedGaMeasurementId ? 1 : 0;
  if (loaderCount !== expectedCount || configCount !== expectedCount || !containsExpectedId) throw new Error(`${file.pathname} must load and configure the selected GA4 stream exactly once`);
}
await validateIntentRouting(dist);
console.log(`SEO and intent-routing validation passed for ${urls.length} canonical, indexable routes.`);
