import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { ARCHIVE_HISTORY_DAYS, GROUPS, PACK_NOTES, hash, puzzleFor } from "../assets/puzzle-data.js";

const output = new URL("../dist/", import.meta.url);
const siteUrl = (process.env.SITE_URL || "https://pokesort.org").replace(/\/$/, "");
const today = new Date().toISOString().slice(0, 10);
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const archiveDateRange = (end, historyDays) => { const dates = []; const date = new Date(`${end}T00:00:00Z`); for (let offset = 0; offset <= historyDays; offset++) { dates.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() - 1); } return dates; };
const archiveDates = archiveDateRange(today, ARCHIVE_HISTORY_DAYS);
const indexableDates = [];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "assets", "archive", "how-to-play", "pokelike-pokesort", "pokesort-alternative", "pokesort-down", "privacy", "categories", "about", "favicon.ico", "manifest.webmanifest"]) await cp(new URL(`../${path}`, import.meta.url), new URL(path, output), { recursive: true });
const workerTemplate = await readFile(new URL("edge-worker.js", import.meta.url), "utf8");
await writeFile(new URL("_worker.js", output), workerTemplate.replace("__ARCHIVE_NEWEST_DATE__", archiveDates[0]).replace("__ARCHIVE_OLDEST_DATE__", archiveDates.at(-1)));

let home = await readFile(new URL("../index.html", import.meta.url), "utf8");
home = home.replaceAll("/?mode=infinite#game", "/infinite/#game").replace("</head>", `  <script>const legacyParams=new URLSearchParams(location.search),legacyDate=legacyParams.get("date");if(legacyParams.get("mode")==="infinite")location.replace("/infinite/");else if(/^\\d{4}-\\d{2}-\\d{2}$/.test(legacyDate||"")&&legacyDate>="${archiveDates.at(-1)}"&&legacyDate<="${today}")location.replace("/daily/"+legacyDate+"/");</script>\n  </head>`);
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

let infinite = home
  .replace(/<title>[\s\S]*?<\/title>/, "<title>PokeSort Infinite – Unlimited Pokémon Sorting Puzzles</title>")
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, '<meta name="description" content="Play unlimited 4×4 Pokémon sorting puzzles. Infinite mode creates repeatable practice boards and never changes your Daily streak." />')
  .replace('rel="canonical" href="https://pokesort.example/"', 'rel="canonical" href="https://pokesort.example/infinite/"')
  .replace('property="og:url" content="https://pokesort.example/"', 'property="og:url" content="https://pokesort.example/infinite/"')
  .replace('content="PokeSort — Daily Pokémon Sorting Puzzle"', 'content="PokeSort Infinite – Unlimited 4×4 Pokémon Sorting Puzzles"')
  .replace('content="Sort 16 Pokémon into four hidden groups. A new puzzle every day, plus unlimited play."', 'content="Play repeatable 4×4 Pokémon grouping boards without changing your Daily streak."')
  .replace('"url": "https://pokesort.example/"', '"url": "https://pokesort.example/infinite/"')
  .replace('<a aria-current="page" href="/">Daily</a', '<a href="/">Daily</a')
  .replace('<a href="/infinite/#game">Infinite</a', '<a aria-current="page" href="/infinite/#game">Infinite</a')
  .replace("POKESORT · DAILY", "POKESORT · INFINITE")
  .replace("Today’s puzzle", "Infinite practice board")
  .replace("Find the four Pokémon groups", "Play unlimited 4×4 Pokémon sorting puzzles")
  .replace("Select four Pokémon connected by one exact Pokémon fact.", "Practice exact Pokémon connections without affecting your Daily streak.")
  .replace('<button class="active" data-mode="daily">', '<button data-mode="daily">')
  .replace('<button data-mode="infinite">', '<button class="active" data-mode="infinite">')
  .replace(/<section class="below-game">[\s\S]*<\/section>\s*<\/main>/, '<section class="below-game"><div class="content-grid"><div><p class="section-label">UNLIMITED PRACTICE</p><h2>How Infinite mode works</h2><p>Finish or reveal a board, then choose <strong>New Infinite</strong> for another puzzle. The round number and progress stay in this browser. Infinite uses the same hand-reviewed category packs as Daily, but it does not record a Daily win or change your streak.</p><h2>What Infinite is useful for</h2><p>Use it to practice spotting exact dual types, evolution methods, debut-region combinations, and special classifications. A repeated board is expected when the small current pack library cycles; this page does not claim endless unique source data.</p></div><aside class="return-card"><p class="section-label">DAILY MODE</p><h2>Keep practice separate from your streak</h2><p>Daily is tied to the UTC date. Archive reproduces a published date seed.</p><a class="big-link" href="/">Play today’s Daily <span>→</span></a><a class="quiet-link" href="/archive/">Choose a dated puzzle</a></aside></div></section></main>');
await mkdir(new URL("infinite/", output), { recursive: true });
await writeFile(new URL("infinite/index.html", output), infinite);

const monthFormatter = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const archiveMonths = new Map();
for (const date of archiveDates) { const month = date.slice(0, 7); if (!archiveMonths.has(month)) archiveMonths.set(month, []); archiveMonths.get(month).push(date); }
const archiveCards = [...archiveMonths].map(([month, dates]) => `<section class="archive-month"><h2><time datetime="${month}">${monthFormatter.format(new Date(`${month}-01T00:00:00Z`))}</time></h2><div class="archive-grid">${dates.map((date) => `<a class="archive-card" href="/daily/${date}/"><strong>PokeSort ${date}</strong><span>Puzzle #${hash(date)} · Play board →</span></a>`).join("\n")}</div></section>`).join("\n");
let archive = await readFile(new URL("../archive/index.html", import.meta.url), "utf8");
archive = archive.replaceAll("/?mode=infinite#game", "/infinite/#game")
  .replace("Missed a day? Open any of the last 30 daily Pokémon sorting puzzles.\n        Archive games do not change your current streak.", `Choose today’s board or any of the previous ${ARCHIVE_HISTORY_DAYS} Daily boards. Archive games use the same stable UTC date seed as the original game and do not change your current streak.`)
  .replace('<div class="archive-grid" id="archive-grid"></div>', `<nav id="archive-grid" aria-label="Daily puzzles grouped by month">${archiveCards}</nav>`)
  .replace(/\s*<script>[\s\S]*?<\/script>\s*<\/body>/, "\n  </body>");
await writeFile(new URL("archive/index.html", output), archive);

for (const [index, date] of archiveDates.entries()) {
  const pack = puzzleFor(date), previous = archiveDates[index + 1], next = archiveDates[index - 1], isIndexable = indexableDates.includes(date);
  const names = pack.flatMap((group) => group.mons.map(([name]) => name));
  const noSpoilerHints = pack.map((group) => `<li>${escapeHtml(group.hint)}</li>`).join("");
  const strongerHints = pack.map((group) => `<li>${escapeHtml(group.name)}</li>`).join("");
  const reveals = pack.map((group, groupIndex) => `<details><summary>Reveal group ${groupIndex + 1}</summary><h3>${escapeHtml(group.name)}</h3><p>${group.mons.map(([name]) => escapeHtml(name)).join(" · ")}</p><p>${escapeHtml(group.explanation)}</p></details>`).join("\n");
  const overlapNote = PACK_NOTES[hash(date) % GROUPS.length];
  const breadcrumbs = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "PokeSort", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: "Archive", item: `${siteUrl}/archive/` }, { "@type": "ListItem", position: 3, name: date, item: `${siteUrl}/daily/${date}/` },
  ] });
  const daily = home
    .replace(/<title>[\s\S]*?<\/title>/, `<title>PokeSort 4×4 Daily Puzzle for ${date}: Hints and Groups</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, `<meta name="description" content="Play the PokeSort 4×4 board for ${date}. Use spoiler-controlled hints, then reveal the four verified groups when you are ready." />`)
    .replace('rel="canonical" href="https://pokesort.example/"', `rel="canonical" href="https://pokesort.example/daily/${date}/"`)
    .replace('property="og:url" content="https://pokesort.example/"', `property="og:url" content="https://pokesort.example/daily/${date}/"`)
    .replace('"url": "https://pokesort.example/"', `"url": "https://pokesort.example/daily/${date}/"`)
    .replace('content="PokeSort — Daily Pokémon Sorting Puzzle"', `content="PokeSort 4×4 Daily Puzzle for ${date}: Hints and Groups"`)
    .replace('content="Sort 16 Pokémon into four hidden groups. A new puzzle every day, plus unlimited play."', `content="Play the ${date} PokeSort 4×4 board, then open spoiler-controlled hints and verified groups."`)
    .replace("Find the four Pokémon groups", `PokeSort 4×4 puzzle for ${date}`)
    .replace("Select four Pokémon connected by one exact Pokémon fact.", `Group these 16 Pokémon into four exact categories. Puzzle #${hash(date)} uses the UTC date ${date}.`)
    .replace("</head>", `${isIndexable ? "" : '<meta name="robots" content="noindex,follow">'} </head>`)
    .replace("</head>", `<script type="application/ld+json">${breadcrumbs}</script></head>`)
    .replace("</main>", `<section class="daily-answer content-page"><nav aria-label="Breadcrumb"><a href="/">PokeSort</a> / <a href="/archive/">Archive</a> / ${date}</nav><h2>Hints and groups for ${date}</h2><p>The playable board above contains ${names.map(escapeHtml).join(", ")}. Open only the level of help you want; every hint and answer is present in the same HTML for users and crawlers.</p><details><summary>No-spoiler hints</summary><ul>${noSpoilerHints}</ul></details><details><summary>Stronger category hints</summary><p>The four category names are shown without their members:</p><ul>${strongerHints}</ul></details><h2>Group reveals</h2>${reveals}<h2>Likely overlap</h2><p>${escapeHtml(overlapNote)}</p><nav class="date-nav">${previous ? `<a href="/daily/${previous}/">← ${previous}</a>` : ""}<a href="/archive/">Archive</a>${next ? `<a href="/daily/${next}/">${next} →</a>` : ""}</nav><p>Need the rules? Read <a href="/how-to-play/">How to play PokeSort</a> or check the <a href="/categories/">category reference</a>.</p></section></main>`);
  const directory = new URL(`daily/${date}/`, output); await mkdir(directory, { recursive: true }); await writeFile(new URL("index.html", directory), daily);
}

const routes = ["/", "/infinite/", "/archive/", ...indexableDates.map((date) => `/daily/${date}/`), "/how-to-play/", "/categories/", "/pokelike-pokesort/", "/about/", "/pokesort-down/", "/privacy/"];
await writeFile(new URL("sitemap.xml", output), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((route) => `  <url><loc>${siteUrl}${route}</loc></url>`).join("\n")}\n</urlset>\n`);
await writeFile(new URL("robots.txt", output), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
await writeFile(new URL("_redirects", output), "# Query-aware redirects must be configured at the hosting edge.\n");
const notFound = home
  .replace(/<title>[\s\S]*?<\/title>/, "<title>Page not found – PokeSort</title>")
  .replace(/<meta\s+name="description"[\s\S]*?\/>/, '<meta name="description" content="The requested PokeSort page was not found. Return to the Daily game or choose a board from the Archive." />')
  .replace(/\s*<link rel="canonical"[^>]+>/, "")
  .replace('content="PokeSort — Daily Pokémon Sorting Puzzle"', 'content="Page not found – PokeSort"')
  .replace('content="Sort 16 Pokémon into four hidden groups. A new puzzle every day, plus unlimited play."', 'content="The requested PokeSort page was not found."')
  .replace('property="og:url" content="https://pokesort.example/"', 'property="og:url" content="https://pokesort.example/404.html"')
  .replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
  .replace(/\s*<script>const legacyParams[\s\S]*?<\/script>/, "")
  .replace("</head>", '<meta name="robots" content="noindex,follow"></head>')
  .replace(/<main>[\s\S]*<\/main>/, '<main class="content-page"><h1>Page not found</h1><p>This route does not contain a published puzzle.</p><p><a href="/">Play today’s PokeSort</a> or <a href="/archive/">open the Archive</a>.</p></main>');
await writeFile(new URL("404.html", output), notFound);

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
async function replaceBaseUrl(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory); if (entry.isDirectory()) await replaceBaseUrl(url); else if (/\.(html|xml|txt)$/.test(entry.name)) { let contents = await readFile(url, "utf8"); contents = contents.replaceAll("https://monsort.com", siteUrl).replaceAll("https://pokesort.example", siteUrl).replaceAll("/?mode=infinite#game", "/infinite/#game"); if (entry.name.endsWith(".html")) contents = ensureSocialMetadata(contents); await writeFile(url, contents); } } }
await replaceBaseUrl(output);
console.log(`Static site built in dist/ for ${siteUrl}: ${archiveDates.length} playable dated puzzles; dated index release held until packs are unique; ${routes.length} indexable routes.`);
