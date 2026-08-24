import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ARCHIVE_HISTORY_DAYS } from "../assets/puzzle-data.js";
import { loadManifestFiles, renderTodayPage } from "./pokelike/render-today.mjs";
import { runProductionDataGate } from "./puzzle/production-data-gate.mjs";
import { loadCategoryModel } from "./puzzle/category-model.mjs";
import { buildRuleUniverse, canonicalMemberSignature } from "./puzzle/rule-universe.mjs";
import { enumerateInducedQuartets } from "./puzzle/solver.mjs";
import { infiniteCapabilityCopy, loadPublicCapabilities } from "./puzzle/public-capabilities.mjs";

const directoryUrl = (path) => pathToFileURL(`${resolve(path)}${sep}`);
const output = process.env.POKESORT_BUILD_OUTPUT ? directoryUrl(process.env.POKESORT_BUILD_OUTPUT) : new URL("../dist/", import.meta.url);
const siteUrl = (process.env.SITE_URL || "https://pokesort.org").replace(/\/$/, "");
const gaMeasurementId = (process.env.PUBLIC_GA_MEASUREMENT_ID ?? "G-JEJ6WJ88P3").trim();
if (gaMeasurementId && !/^G-[A-Z0-9]+$/.test(gaMeasurementId)) throw new Error("PUBLIC_GA_MEASUREMENT_ID must be a GA4 measurement ID such as G-XXXXXXXXXX");
const today = process.env.POKESORT_BUILD_UTC_DATE || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(`${today}T00:00:00.000Z`).toISOString().slice(0, 10) !== today) throw new Error("POKESORT_BUILD_UTC_DATE must be a valid UTC date");
const edgeDailyActivationDate = process.env.POKESORT_EDGE_DAILY_ACTIVATION_DATE || "2026-08-25";
if (process.env.POKESORT_EDGE_DAILY === "1" && (!/^\d{4}-\d{2}-\d{2}$/.test(edgeDailyActivationDate) || new Date(`${edgeDailyActivationDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== edgeDailyActivationDate)) throw new Error("POKESORT_EDGE_DAILY_ACTIVATION_DATE must be a valid UTC date");
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const archiveDateRange = (end, historyDays) => { const dates = []; const date = new Date(`${end}T00:00:00Z`); for (let offset = 0; offset <= historyDays; offset++) { dates.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() - 1); } return dates; };
const archiveDates = archiveDateRange(today, ARCHIVE_HISTORY_DAYS);
const calendarDirectory = process.env.POKESORT_DAILY_DIR ? directoryUrl(process.env.POKESORT_DAILY_DIR) : new URL("../data/puzzles/public-daily/", import.meta.url);
const infiniteDirectory = process.env.POKESORT_INFINITE_DIR ? directoryUrl(process.env.POKESORT_INFINITE_DIR) : new URL("../data/puzzles/infinite/", import.meta.url);
const productionGate = await runProductionDataGate({ asOfDate: today });
console.log(`Production data Gate PASS: ${productionGate.daily.dates.length} elapsed Daily manifests and ${productionGate.infinite.poolSize} Infinite puzzles.`);
const infiniteCapabilities = await loadPublicCapabilities({ validatedPoolSize: productionGate.infinite.poolSize, validatedNoRepeatRounds: productionGate.infinite.noRepeatSequenceRounds, validatedDiversity: productionGate.infinite.diversity });
const infiniteCopy = infiniteCapabilityCopy(infiniteCapabilities);
const dailyRuleUniverse = buildRuleUniverse(await loadCategoryModel());
const calendarIndex = JSON.parse(await readFile(new URL("index.json", calendarDirectory), "utf8"));
const calendarEntries = new Map(calendarIndex.entries.map((entry) => [entry.date, entry]));
const publishedDates = calendarIndex.entries.map(({ date }) => date).filter((date) => date <= today).sort().reverse();
if (!publishedDates.includes(today) || archiveDates.some((date) => !calendarEntries.has(date))) throw new Error(`Immutable Daily calendar does not cover the ${today} publication window`);
const indexableDates = publishedDates;
const colors = ["#f5d65b", "#8bc5f5", "#f6a2ae", "#a8dbb6"];
const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const shortPuzzleId = (manifest) => manifest.contentHash.slice(0, 8).toUpperCase();
const publicPuzzle = (manifest) => ({
  schemaVersion: 1,
  puzzleId: manifest.puzzleId,
  contentHash: manifest.contentHash,
  date: manifest.date,
  boardSignature: manifest.boardSignature,
  cards: manifest.cards.map(({ id, name }) => ({ id, name })),
  validQuartets: enumerateInducedQuartets(manifest.cards.map(({ id }) => id), dailyRuleUniverse)
    .map(({ memberIds }) => canonicalMemberSignature(memberIds)),
  groups: manifest.groups.map((group, index) => ({
    name: group.label,
    hint: group.hint,
    explanation: group.explanation,
    color: colors[index],
    mons: group.members.map(({ id, name }) => [name, id]),
  })),
});
const puzzleDataTag = (manifest) => `<script id="pokesort-puzzle-data" type="application/json">${safeJson(publicPuzzle(manifest))}</script>`;
const embedPuzzle = (html, manifest) => html.includes('id="pokesort-puzzle-data"')
  ? html.replace(/<script id="pokesort-puzzle-data" type="application\/json">[\s\S]*?<\/script>/, puzzleDataTag(manifest))
  : html.replace("</head>", `${puzzleDataTag(manifest)}\n</head>`);
async function readDailyManifest(date) {
  const entry = calendarEntries.get(date);
  if (!entry || date > today) throw new Error(`No publishable immutable Daily manifest for ${date}`);
  const manifest = JSON.parse(await readFile(new URL(entry.file, calendarDirectory), "utf8"));
  if (manifest.date !== date || manifest.puzzleId !== entry.puzzleId || manifest.contentHash !== entry.contentHash) throw new Error(`Daily calendar index mismatch for ${date}`);
  return manifest;
}
const dailyManifests = new Map(await Promise.all(publishedDates.map(async (date) => [date, await readDailyManifest(date)])));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "assets", "archive", "how-to-play", "pokelike-pokesort", "pokesort-alternative", "pokesort-down", "privacy", "categories", "about", "favicon.ico", "manifest.webmanifest"]) await cp(new URL(`../${path}`, import.meta.url), new URL(path, output), { recursive: true });
await cp(infiniteDirectory, new URL("assets/infinite/", output), { recursive: true });
const workerTemplate = await readFile(new URL("edge-worker.js", import.meta.url), "utf8");
const dailyContractModule = await readFile(new URL("../functions/_lib/daily-contract.js", import.meta.url), "utf8");
const dailyHandlerModule = await readFile(new URL("../functions/_lib/daily-handler.js", import.meta.url), "utf8");
const stripModuleExports = (source) => source.replaceAll(/\bexport\s+(?=(?:const|function|class)\b)/g, "");
const composedWorker = [
  stripModuleExports(dailyContractModule),
  stripModuleExports(dailyHandlerModule.replace(/^import[^\n]+\n/m, "")),
  workerTemplate.replace(/^import[^\n]+\n/m, ""),
].join("\n").replace("__ARCHIVE_NEWEST_DATE__", archiveDates[0]).replace("__ARCHIVE_OLDEST_DATE__", archiveDates.at(-1));
if (/^import\s/m.test(composedWorker)) throw new Error("Advanced Mode worker composition left an unresolved module import");
await writeFile(new URL("_worker.js", output), composedWorker);

let home = await readFile(new URL("../index.html", import.meta.url), "utf8");
home = home.replaceAll("/?mode=infinite#game", "/infinite/#game").replace("</head>", `  <script>const legacyParams=new URLSearchParams(location.search),legacyDate=legacyParams.get("date");if(legacyParams.get("mode")==="infinite")location.replace("/infinite/");else if(/^\\d{4}-\\d{2}-\\d{2}$/.test(legacyDate||"")&&legacyDate>="${archiveDates.at(-1)}"&&legacyDate<="${today}")location.replace("/daily/"+legacyDate+"/");</script>\n  </head>`);
home = embedPuzzle(home, dailyManifests.get(today));
if (process.env.POKESORT_EDGE_DAILY === "1") home = home.replace("</head>", `<meta name="pokesort-edge-daily" content="enabled">\n<meta name="pokesort-edge-daily-activation-date" content="${edgeDailyActivationDate}">\n</head>`);
await writeFile(new URL("index.html", output), home);

const categoryFile = new URL("categories/index.html", output);
let categories = await readFile(categoryFile, "utf8");
categories = categories
  .replaceAll("PokeSort Categories – Connection Reference", "PokeSort 4×4 Categories – Connection Reference")
  .replace("Check the exact connection categories currently used by PokeSort", "Check the exact connection categories currently used by the PokeSort 4×4 grouping game")
  .replace("The reviewed category families used by current PokeSort boards.", "The reviewed category families used by current PokeSort 4×4 boards.")
  .replace("CURRENT GAME TAXONOMY", "CURRENT 4×4 GAME TAXONOMY")
  .replace("PokeSort category reference", "PokeSort 4×4 category reference");
await writeFile(categoryFile, categories);

const aboutFile = new URL("about/index.html", output);
let about = await readFile(aboutFile, "utf8");
about = about.replace(/<h2>How boards are made<\/h2><p>[\s\S]*?<\/p><h2>Definitions and sources<\/h2>/, `<h2>How boards are made</h2><p>Daily publishes immutable UTC-date manifests only after they have elapsed. This build contains ${productionGate.daily.dates.length} public boards from ${productionGate.daily.oldestDate} through ${productionGate.daily.newestDate}; future candidates are private inputs, not public routes or source data. Infinite is a finite pool of ${infiniteCapabilities.poolSize.toLocaleString("en")} solver-verified boards with ${infiniteCapabilities.noRepeatRounds.toLocaleString("en")} measured no-repeat rounds. ${infiniteCapabilities.advertisedFamilies.length ? `The R3 PASS report supports these advertised families: ${infiniteCapabilities.advertisedFamilies.join(", ")}.` : "No Infinite family-diversity claim is published until an R3 capability report passes."}</p><h2>Definitions and sources</h2>`);
about = about.replace("Every board is checked against all 100 rule instances", "Every board is checked against all 101 rule instances").replace("and Mythical flags. Every board", "and Mythical flags. Monotype is measured inside exact typing and is not counted as a ninth advertised Infinite family. Every board");
await writeFile(aboutFile, about);

let infinite = home
  .replace(/<title>[\s\S]*?<\/title>/, "<title>PokeSort 4×4 Infinite – Unlimited Pokémon Grouping Puzzles</title>")
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, '<meta name="description" content="Play unlimited 4×4 Pokémon sorting puzzles. Infinite mode creates repeatable practice boards and never changes your Daily streak." />')
  .replace('rel="canonical" href="https://pokesort.example/"', 'rel="canonical" href="https://pokesort.example/infinite/"')
  .replace('property="og:url" content="https://pokesort.example/"', 'property="og:url" content="https://pokesort.example/infinite/"')
  .replace('content="PokeSort 4×4 Daily — Pokémon Grouping Puzzle"', 'content="PokeSort Infinite – Unlimited 4×4 Pokémon Sorting Puzzles"')
  .replace('content="Play the PokeSort 4×4 Daily: sort 16 Pokémon into four hidden groups, with a separate Infinite practice mode."', 'content="Play repeatable 4×4 Pokémon grouping boards without changing your Daily streak."')
  .replace('"url": "https://pokesort.example/"', '"url": "https://pokesort.example/infinite/"')
  .replace('"name": "PokeSort 4×4 Daily"', '"name": "PokeSort 4×4 Infinite"')
  .replace('"description": "A free 4×4 Pokémon grouping puzzle with one Daily board and a separate Infinite practice mode."', '"description": "Unlimited 4×4 Pokémon grouping practice with a verified finite no-repeat sequence."')
  .replace('<a aria-current="page" href="/">Daily</a', '<a href="/">Daily</a')
  .replace('<a href="/infinite/#game">Infinite</a', '<a aria-current="page" href="/infinite/#game">Infinite</a')
  .replace("POKESORT · DAILY", "POKESORT · INFINITE")
  .replace("Today’s puzzle", "Infinite practice board")
  .replace("Find four groups in today’s 4×4 PokeSort", "Play unlimited 4×4 Pokémon sorting puzzles")
  .replace("Select four Pokémon connected by one exact Pokémon fact.", "Practice exact Pokémon connections without affecting your Daily streak.")
  .replace('<button class="active" data-mode="daily">', '<button data-mode="daily">')
  .replace('<button data-mode="infinite">', '<button class="active" data-mode="infinite">')
  .replace(/\s*<script id="pokesort-puzzle-data" type="application\/json">[\s\S]*?<\/script>/, "")
  .replace(/<section class="below-game">[\s\S]*<\/section>\s*<\/main>/, `<section class="below-game"><div class="content-grid"><div><p class="section-label">INFINITE PRACTICE</p><h2>How Infinite mode works</h2><p>${infiniteCopy.how}</p><h2>What the current pool proves</h2><p>${infiniteCopy.useful}</p></div><aside class="return-card"><p class="section-label">DAILY MODE</p><h2>Keep practice separate from your streak</h2><p>Daily is tied to an immutable UTC date manifest. Archive reproduces that exact published board.</p><a class="big-link" href="/">Play today’s Daily <span>→</span></a><a class="quiet-link" href="/archive/">Choose a dated puzzle</a></aside></div></section></main>`);
await mkdir(new URL("infinite/", output), { recursive: true });
await writeFile(new URL("infinite/index.html", output), infinite);

const monthFormatter = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const archiveMonths = new Map();
for (const date of publishedDates) { const month = date.slice(0, 7); if (!archiveMonths.has(month)) archiveMonths.set(month, []); archiveMonths.get(month).push(date); }
const recentCards = archiveDates.map((date) => `<a class="archive-card" href="/daily/${date}/"><strong>PokeSort ${date}</strong><span>Puzzle #${shortPuzzleId(dailyManifests.get(date))} · Play board →</span></a>`).join("\n");
const archiveYears = new Map();
for (const [month, dates] of archiveMonths) { const year = month.slice(0, 4); if (!archiveYears.has(year)) archiveYears.set(year, []); archiveYears.get(year).push({ month, dates }); }
const discoveryLinks = [...archiveYears].map(([year, months]) => `<section class="archive-month"><h2><a href="/archive/${year}/">${year} archive</a></h2><div class="archive-grid">${months.map(({ month, dates }) => `<a class="archive-card" href="/archive/${year}/${month.slice(5)}/"><strong>${monthFormatter.format(new Date(`${month}-01T00:00:00Z`))}</strong><span>${dates.length} published puzzle${dates.length === 1 ? "" : "s"} · Browse month →</span></a>`).join("\n")}</div></section>`).join("\n");
let archive = await readFile(new URL("../archive/index.html", import.meta.url), "utf8");
archive = archive.replaceAll("/?mode=infinite#game", "/infinite/#game")
  .replace("Missed a day? Open any of the last 30 daily Pokémon sorting puzzles.\n        Archive games do not change your current streak.", `Choose today’s board or any of the previous ${ARCHIVE_HISTORY_DAYS} Daily boards. Archive games reproduce the same immutable manifest published for each UTC date and do not change your current streak.`)
  .replace('<div class="archive-grid" id="archive-grid"></div>', `<section aria-labelledby="recent-puzzles"><h2 id="recent-puzzles">Latest ${archiveDates.length} puzzles</h2><nav class="archive-grid" id="archive-grid" aria-label="Latest Daily puzzles">${recentCards}</nav></section><section aria-labelledby="browse-history"><h2 id="browse-history">Browse all published puzzles</h2>${discoveryLinks}</section>`)
  .replace(/\s*<script>[\s\S]*?<\/script>\s*<\/body>/, "\n  </body>");
await writeFile(new URL("archive/index.html", output), archive);

const archiveShell = (title, description, canonicalPath, h1, body, breadcrumbs) => archive
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="${description}" />`)
  .replace(/<meta\s+property="og:title"\s+content="[^"]+"\s*\/>/, `<meta property="og:title" content="${title}" />`)
  .replace(/<meta\s+property="og:description"\s+content="[^"]+"\s*\/>/, `<meta property="og:description" content="${description}" />`)
  .replace('rel="canonical" href="https://pokesort.example/archive/"', `rel="canonical" href="https://pokesort.example${canonicalPath}"`)
  .replace('property="og:url" content="https://pokesort.example/archive/"', `property="og:url" content="https://pokesort.example${canonicalPath}"`)
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${safeJson(breadcrumbs)}</script>`)
  .replace(/<main class="content-page">[\s\S]*?<\/main>/, `<main class="content-page"><nav aria-label="Breadcrumb">${breadcrumbs.itemListElement.map(({ name, item }) => item ? `<a href="${new URL(item).pathname}">${escapeHtml(name)}</a>` : escapeHtml(name)).join(" / ")}</nav><p class="section-label">PUBLISHED DAILY HISTORY</p><h1>${h1}</h1><p class="lede">${description}</p>${body}</main>`);

const archiveRoutes = [];
for (const [year, months] of archiveYears) {
  const yearPath = `/archive/${year}/`, yearDirectory = new URL(`archive/${year}/`, output);
  const yearBody = months.map(({ month, dates }) => `<section class="archive-month"><h2><a href="/archive/${year}/${month.slice(5)}/">${monthFormatter.format(new Date(`${month}-01T00:00:00Z`))}</a></h2><p>${dates.length} immutable UTC puzzle${dates.length === 1 ? "" : "s"}, from ${dates.at(-1)} through ${dates[0]}.</p></section>`).join("\n");
  const yearCrumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "PokeSort", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "Archive", item: `${siteUrl}/archive/` }, { "@type": "ListItem", position: 3, name: year },
  ] };
  await mkdir(yearDirectory, { recursive: true });
  await writeFile(new URL("index.html", yearDirectory), archiveShell(`PokeSort 4×4 Archive for ${year}`, `Browse every immutable PokeSort 4×4 Daily puzzle published in ${year}, grouped by UTC month.`, yearPath, `PokeSort archive for ${year}`, yearBody, yearCrumbs));
  archiveRoutes.push({ route: yearPath, lastmod: months[0].dates[0] });
  for (const { month, dates } of months) {
    const monthNumber = month.slice(5), monthPath = `/archive/${year}/${monthNumber}/`, monthName = monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
    const monthBody = `<nav class="archive-grid" aria-label="Published Daily puzzles for ${monthName}">${dates.map((date) => `<a class="archive-card" href="/daily/${date}/"><strong>PokeSort ${date}</strong><span>Puzzle #${shortPuzzleId(dailyManifests.get(date))} · Hints and groups →</span></a>`).join("\n")}</nav>`;
    const monthCrumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "PokeSort", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "Archive", item: `${siteUrl}/archive/` }, { "@type": "ListItem", position: 3, name: year, item: `${siteUrl}${yearPath}` }, { "@type": "ListItem", position: 4, name: monthName },
    ] };
    const monthDirectory = new URL(`archive/${year}/${monthNumber}/`, output); await mkdir(monthDirectory, { recursive: true });
    await writeFile(new URL("index.html", monthDirectory), archiveShell(`PokeSort 4×4 Daily Archive – ${monthName}`, `Play every immutable PokeSort 4×4 Daily board published in ${monthName}, with date-specific hints, answers, and group explanations.`, monthPath, `PokeSort puzzles for ${monthName}`, monthBody, monthCrumbs));
    archiveRoutes.push({ route: monthPath, lastmod: dates[0] });
  }
}

for (const [index, date] of publishedDates.entries()) {
  const manifest = dailyManifests.get(date);
  const pack = publicPuzzle(manifest).groups, previous = publishedDates[index + 1], next = publishedDates[index - 1], isIndexable = indexableDates.includes(date);
  const names = pack.flatMap((group) => group.mons.map(([name]) => name));
  const noSpoilerHints = pack.map((group) => `<li>${escapeHtml(group.hint)}</li>`).join("");
  const strongerHints = pack.map((group) => `<li>${escapeHtml(group.name)}</li>`).join("");
  const reveals = pack.map((group, groupIndex) => `<details><summary>Reveal group ${groupIndex + 1}</summary><h3>${escapeHtml(group.name)}</h3><p>${group.mons.map(([name]) => escapeHtml(name)).join(" · ")}</p><p>${escapeHtml(group.explanation)}</p></details>`).join("\n");
  const overlappingGroups = manifest.groups.filter((group) => group.matchingRuleEvidence.length > 1);
  const overlapNote = overlappingGroups.length
    ? `Some intended quartets also match additional verified labels (${overlappingGroups.map((group) => group.matchingRuleEvidence.map(({ label }) => label).join(" / ")).join("; ")}). The complete board still has exactly one four-group member partition.`
    : "The complete board was checked against every published rule in the versioned category model and has exactly one four-group member partition.";
  const boardProfile = `This board combines ${pack.map((group) => escapeHtml(group.name)).join(", ")}. The complete rule scan induced ${manifest.solver.validQuartetCount} valid four-card candidate${manifest.solver.validQuartetCount === 1 ? "" : "s"} and exactly one complete partition; ${manifest.solver.overlapRuleCount} additional matching rule label${manifest.solver.overlapRuleCount === 1 ? " was" : "s were"} retained as overlap evidence.`;
  const monthPath = `/archive/${date.slice(0, 4)}/${date.slice(5, 7)}/`;
  const monthName = monthFormatter.format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`));
  const breadcrumbs = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "PokeSort", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "Archive", item: `${siteUrl}/archive/` }, { "@type": "ListItem", position: 3, name: monthName, item: `${siteUrl}${monthPath}` }, { "@type": "ListItem", position: 4, name: date, item: `${siteUrl}/daily/${date}/` },
  ] });
  const publicationDates = `"datePublished": "${date}",\n        "dateModified": "${date}",`;
  const daily = embedPuzzle(home, manifest)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>PokeSort 4×4 Daily Puzzle for ${date}: Hints and Groups</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="Play the PokeSort 4×4 board for ${date}. Use spoiler-controlled hints, then reveal the four verified groups when you are ready." />`)
    .replace('rel="canonical" href="https://pokesort.example/"', `rel="canonical" href="https://pokesort.example/daily/${date}/"`)
    .replace('property="og:url" content="https://pokesort.example/"', `property="og:url" content="https://pokesort.example/daily/${date}/"`)
    .replace('"url": "https://pokesort.example/"', `"url": "https://pokesort.example/daily/${date}/"`)
    .replace('content="PokeSort 4×4 Daily — Pokémon Grouping Puzzle"', `content="PokeSort 4×4 Daily Puzzle for ${date}: Hints and Groups"`)
    .replace('content="Play the PokeSort 4×4 Daily: sort 16 Pokémon into four hidden groups, with a separate Infinite practice mode."', `content="Play the ${date} PokeSort 4×4 board, then open spoiler-controlled hints and verified groups."`)
    .replace('"name": "PokeSort 4×4 Daily"', `"name": "PokeSort 4×4 Daily for ${date}"`)
    .replace('"description": "A free 4×4 Pokémon grouping puzzle with one Daily board and a separate Infinite practice mode."', `"description": "The immutable PokeSort 4×4 Daily grouping board for ${date}, with spoiler-controlled hints and four verified groups."`)
    .replace('"offers": { "@type": "Offer"', `${publicationDates}\n        "offers": { "@type": "Offer"`)
    .replace("Find four groups in today’s 4×4 PokeSort", `PokeSort 4×4 puzzle for ${date}`)
    .replace("Select four Pokémon connected by one exact Pokémon fact.", `Group these 16 Pokémon into four exact categories. Puzzle #${shortPuzzleId(manifest)} is the immutable UTC board for ${date}.`)
    .replace("</head>", `${isIndexable ? "" : '<meta name="robots" content="noindex,follow">'} </head>`)
    .replace("</head>", `<script type="application/ld+json">${breadcrumbs}</script></head>`)
    .replace("</main>", `<section class="daily-answer content-page"><nav aria-label="Breadcrumb"><a href="/">PokeSort</a> / <a href="/archive/">Archive</a> / <a href="${monthPath}">${escapeHtml(monthName)}</a> / ${date}</nav><h2>Hints and groups for ${date}</h2><p>The playable board above contains ${names.map(escapeHtml).join(", ")}. Open only the level of help you want; every hint and answer is present in the same HTML for users and crawlers.</p><h2>Board profile</h2><p>${boardProfile}</p><details><summary>No-spoiler hints</summary><ul>${noSpoilerHints}</ul></details><details><summary>Stronger category hints</summary><p>The four category names are shown without their members:</p><ul>${strongerHints}</ul></details><h2>Group reveals</h2>${reveals}<h2>Likely overlap</h2><p>${escapeHtml(overlapNote)}</p><nav class="date-nav">${previous ? `<a href="/daily/${previous}/">← ${previous}</a>` : ""}<a href="/archive/">Archive</a>${next ? `<a href="/daily/${next}/">${next} →</a>` : ""}</nav><p>Need the rules? Read <a href="/how-to-play/">How to play PokeSort</a> or check the <a href="/categories/">category reference</a>.</p></section></main>`);
  const directory = new URL(`daily/${date}/`, output); await mkdir(directory, { recursive: true }); await writeFile(new URL("index.html", directory), daily);
}

const routes = ["/", "/infinite/", "/archive/", ...archiveRoutes.map(({ route }) => route), ...indexableDates.map((date) => `/daily/${date}/`), "/how-to-play/", "/categories/", "/pokelike-pokesort/", "/about/", "/pokesort-down/", "/privacy/"];
const archiveLastmods = new Map(archiveRoutes.map(({ route, lastmod }) => [route, lastmod]));
await writeFile(new URL("sitemap.xml", output), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((route) => { const date = /^\/daily\/(\d{4}-\d{2}-\d{2})\/$/.exec(route)?.[1]; const lastmod = date || archiveLastmods.get(route) || (["/", "/archive/"].includes(route) ? publishedDates[0] : undefined); return `  <url><loc>${siteUrl}${route}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`; }).join("\n")}\n</urlset>\n`);
await writeFile(new URL("robots.txt", output), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
await writeFile(new URL("_redirects", output), "# Query-aware redirects must be configured at the hosting edge.\n");
const notFound = home
  .replace(/<title>[\s\S]*?<\/title>/, "<title>Page not found – PokeSort</title>")
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, '<meta name="description" content="The requested PokeSort page was not found. Return to the Daily game or choose a board from the Archive." />')
  .replace(/\s*<link rel="canonical"[^>]+>/, "")
  .replace(/<meta\s+property="og:title"[\s\S]*?\/>/, '<meta property="og:title" content="Page not found – PokeSort" />')
  .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, '<meta property="og:description" content="The requested PokeSort page was not found." />')
  .replace('property="og:url" content="https://pokesort.example/"', 'property="og:url" content="https://pokesort.example/404.html"')
  .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
  .replace(/\s*<script id="pokesort-puzzle-data" type="application\/json">[\s\S]*?<\/script>/, "")
  .replace(/\s*<script>const legacyParams[\s\S]*?<\/script>/, "")
  .replace("</head>", '<meta name="robots" content="noindex,follow"></head>')
  .replace(/<main>[\s\S]*<\/main>/, '<main class="content-page"><h1>Page not found</h1><p>This route does not contain a published puzzle.</p><p><a href="/">Play today’s PokeSort</a> or <a href="/archive/">open the Archive</a>.</p></main>');
await writeFile(new URL("404.html", output), notFound);

const todayManifestPaths = (process.env.POKELIKE_TODAY_MANIFESTS ?? "").split(/[;,]/).map((value) => value.trim()).filter(Boolean);
let todayManifests = [], todayLoadError = "";
try { todayManifests = await loadManifestFiles(todayManifestPaths); }
catch (error) { todayLoadError = `Configured Today data could not be loaded: ${error.message}`; }
const todayPage = renderTodayPage({ manifests: todayManifests, now: new Date(), allowVerifiedPreview: process.env.POKELIKE_TODAY_PREVIEW === "1", siteUrl, unavailableReason: todayLoadError ? "build_failed" : null });
const todayDirectory = new URL("pokelike-pokesort/today/", output);
await mkdir(todayDirectory, { recursive: true });
await writeFile(new URL("index.html", todayDirectory), todayPage.html);
if (todayLoadError) console.warn(todayLoadError);
console.log(`Pokelike Today build state: ${todayPage.state}; ${todayPage.rejections.length} configured record(s) rejected.`);
console.log(`Pokelike Today build monitor: ${JSON.stringify({ state: todayPage.state, configuredRecords: todayManifests.length, rejectedRecords: todayPage.rejections.length, rejectionCodes: [...new Set(todayPage.rejections.flatMap((entry) => entry.issues))].sort(), loadFailure: Boolean(todayLoadError) })}`);

function ensureSocialMetadata(html) {
  if (!html.includes("<html")) return html;
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1] || "PokeSort";
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/s)?.[1] || "Play PokeSort.";
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/s)?.[1];
  const tags = [
    !html.includes('property="og:title"') && `<meta property="og:title" content="${title}">`,
    !html.includes('property="og:description"') && `<meta property="og:description" content="${description}">`,
    !html.includes('property="og:type"') && '<meta property="og:type" content="website">',
    canonical && !html.includes('property="og:url"') && `<meta property="og:url" content="${canonical}">`,
    !html.includes('name="twitter:title"') && `<meta name="twitter:title" content="${title}">`,
    !html.includes('name="twitter:description"') && `<meta name="twitter:description" content="${description}">`,
    !html.includes('name="twitter:image"') && `<meta name="twitter:image" content="${siteUrl}/assets/social-card.png">`,
  ].filter(Boolean).join("\n");
  return html.replace("</head>", `${tags}\n</head>`);
}
function ensureGoogleAnalytics(html) {
  if (!gaMeasurementId || !html.includes("<html") || html.includes("googletagmanager.com/gtag/js")) return html;
  const analytics = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${gaMeasurementId}', { page_location: location.origin + location.pathname, page_path: location.pathname });
  </script>`;
  return html.replace("</head>", `${analytics}\n</head>`);
}
async function replaceBaseUrl(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory); if (entry.isDirectory()) await replaceBaseUrl(url); else if (/\.(html|xml|txt)$/.test(entry.name)) { let contents = await readFile(url, "utf8"); contents = contents.replaceAll("https://monsort.com", siteUrl).replaceAll("https://pokesort.example", siteUrl).replaceAll("/?mode=infinite#game", "/infinite/#game"); if (entry.name.endsWith(".html")) contents = ensureGoogleAnalytics(ensureSocialMetadata(contents)); await writeFile(url, contents); } } }
await replaceBaseUrl(output);
console.log(`Static site built in dist/ for ${siteUrl}: ${publishedDates.length} persistent published Daily pages; ${archiveDates.length} shown in Archive; ${routes.length} indexable routes.`);
