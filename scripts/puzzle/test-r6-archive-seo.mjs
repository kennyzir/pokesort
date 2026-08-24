import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicHistoryIndex, validatePublicDailyHistory } from "./public-daily-history.mjs";
import { publishElapsedHistory } from "./publish-elapsed-history.mjs";
import { sha256 } from "./stable.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(root, "dist");
const historyDirectory = resolve(root, "data/puzzles/public-daily");
const asOfDate = process.env.POKESORT_BUILD_UTC_DATE || new Date().toISOString().slice(0, 10);
const siteUrl = "https://pokesort.org";
const readDist = (path) => readFile(resolve(dist, path), "utf8");
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const schemas = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const one = (html, pattern, label) => {
  const matches = [...html.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label} must occur exactly once`);
  return matches[0][1];
};
const routeFile = (route) => route === "/" ? "index.html" : `${route.slice(1)}index.html`;
const routeLinks = (html) => [...html.matchAll(/href="(\/[^"#?]*)/g)].map((match) => match[1]);

const history = await validatePublicDailyHistory({ directory: historyDirectory, asOfDate });
const manifests = new Map(history.manifests.map((manifest) => [manifest.date, manifest]));
const dates = history.dates.slice().sort();
const newestFirst = dates.slice().reverse();
const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
const years = [...new Set(months.map((month) => month.slice(0, 4)))];

// Default production input is the tracked, elapsed public-history set. Ignored
// private/future data is neither required nor copied into the static output.
const trackedHistory = execFileSync("git", ["ls-files", "data/puzzles/public-daily"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
assert.equal(trackedHistory.length, dates.length + 1, "tracked public history must contain one index and one file per elapsed date");
assert(trackedHistory.includes("data/puzzles/public-daily/index.json"));
assert.deepEqual(trackedHistory.filter((path) => /\d{4}-\d{2}-\d{2}\.json$/.test(path)).map((path) => path.slice(-15, -5)).sort(), dates);
assert(trackedHistory.every((path) => !path.includes("private") && !path.includes("future")));
await assert.rejects(() => readFile(resolve(dist, "data/puzzles/public-daily/index.json")), "raw public-history indexes must not be exposed in dist");

const evergreenRoutes = ["/", "/infinite/", "/archive/", "/how-to-play/", "/categories/", "/pokelike-pokesort/", "/about/", "/pokesort-down/", "/privacy/"];
const yearRoutes = years.map((year) => `/archive/${year}/`);
const monthRoutes = months.map((month) => `/archive/${month.slice(0, 4)}/${month.slice(5)}/`);
const dailyRoutes = dates.map((date) => `/daily/${date}/`);
const expectedRoutes = [...evergreenRoutes.slice(0, 3), ...yearRoutes.slice().reverse(), ...monthRoutes.slice().reverse(), ...dailyRoutes.slice().reverse(), ...evergreenRoutes.slice(3)];

function assertSitemap(xml) {
  const entries = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((match) => ({ url: match[1], lastmod: match[2] }));
  assert.equal(entries.length, expectedRoutes.length, "sitemap route count must equal the approved indexable surface");
  assert.deepEqual(entries.map(({ url }) => new URL(url).pathname), expectedRoutes);
  assert(entries.every(({ url }) => url.startsWith(`${siteUrl}/`) && !/[?#]/.test(url)));
  const expectedLastmod = new Map([["/", dates.at(-1)], ["/archive/", dates.at(-1)]]);
  for (const date of dates) expectedLastmod.set(`/daily/${date}/`, date);
  for (const year of years) expectedLastmod.set(`/archive/${year}/`, dates.filter((date) => date.startsWith(year)).at(-1));
  for (const month of months) expectedLastmod.set(`/archive/${month.slice(0, 4)}/${month.slice(5)}/`, dates.filter((date) => date.startsWith(month)).at(-1));
  for (const { url, lastmod } of entries) assert.equal(lastmod, expectedLastmod.get(new URL(url).pathname), `unsupported or stale lastmod for ${url}`);
  return entries;
}

const sitemap = await readDist("sitemap.xml");
const sitemapEntries = assertSitemap(sitemap);
assert.throws(() => assertSitemap(sitemap.replace(`<lastmod>${dates.at(-1)}</lastmod>`, "<lastmod>1999-01-01</lastmod>")), /lastmod/);

const archive = await readDist("archive/index.html");
assert.equal((archive.match(/id="archive-grid"[\s\S]*?<\/nav>/)?.[0].match(/href="\/daily\//g) || []).length, Math.min(31, dates.length));
assert(!archive.includes("stable UTC date seed"), "Archive copy must describe immutable manifests, not a public/stable seed");
for (const monthRoute of monthRoutes) assert(archive.includes(`href="${monthRoute}"`), `${monthRoute} must be linked directly from Archive`);
for (const yearRoute of yearRoutes) assert(archive.includes(`href="${yearRoute}"`), `${yearRoute} must be linked from Archive`);

const titles = new Set(), descriptions = new Set(), h1s = new Set(), dailyMainText = new Set(), embeddedHashes = new Set();
const htmlByRoute = new Map();
for (const route of expectedRoutes) htmlByRoute.set(route, await readDist(routeFile(route)));

function assertDailyPage(html, manifest, index) {
  const { date } = manifest, canonical = `${siteUrl}/daily/${date}/`;
  assert.equal(one(html, /<title>([^<]+)<\/title>/g, `${date} title`), `PokeSort 4×4 Daily Puzzle for ${date}: Hints and Groups`);
  assert.equal(one(html, /<meta\s+name="description"\s+content="([^"]+)"/g, `${date} description`), `Play the PokeSort 4×4 board for ${date}. Use spoiler-controlled hints, then reveal the four verified groups when you are ready.`);
  assert.equal(one(html, /<link\s+rel="canonical"\s+href="([^"]+)"/g, `${date} canonical`), canonical);
  assert.equal(one(html, /<h1[^>]*>([\s\S]*?)<\/h1>/g, `${date} H1`).replace(/<[^>]+>/g, "").trim(), `PokeSort 4×4 puzzle for ${date}`);
  assert(!/name="robots"[^>]*noindex/i.test(html));

  const application = schemas(html).find((schema) => schema["@type"] === "WebApplication");
  const breadcrumb = schemas(html).find((schema) => schema["@type"] === "BreadcrumbList");
  assert(application && breadcrumb, `${date} needs WebApplication and BreadcrumbList schemas`);
  assert.equal(application.url, canonical); assert.equal(application.name, `PokeSort 4×4 Daily for ${date}`);
  assert.equal(application.datePublished, date); assert.equal(application.dateModified, date);
  assert.deepEqual(breadcrumb.itemListElement.map(({ item }) => item), [`${siteUrl}/`, `${siteUrl}/archive/`, `${siteUrl}/archive/${date.slice(0, 4)}/${date.slice(5, 7)}/`, canonical]);

  const puzzle = JSON.parse(one(html, /<script id="pokesort-puzzle-data" type="application\/json">([\s\S]*?)<\/script>/g, `${date} embedded puzzle`));
  assert.equal(puzzle.date, date); assert.equal(puzzle.puzzleId, manifest.puzzleId); assert.equal(puzzle.contentHash, manifest.contentHash);
  assert.deepEqual(puzzle.cards, manifest.cards.map(({ id, name }) => ({ id, name })));
  assert.equal(puzzle.cards.length, 16); assert.equal(new Set(puzzle.cards.map(({ id }) => id)).size, 16);
  assert.equal(puzzle.groups.length, 4);
  const pageText = text(html);
  for (const [groupIndex, group] of puzzle.groups.entries()) {
    const expected = manifest.groups[groupIndex];
    assert.equal(group.name, expected.label); assert.equal(group.hint, expected.hint); assert.equal(group.explanation, expected.explanation);
    assert.deepEqual(group.mons, expected.members.map(({ id, name }) => [name, id]));
    for (const value of [expected.label, expected.hint, expected.explanation, ...expected.members.map(({ name }) => name)]) assert(pageText.includes(value), `${date} HTML omits manifest evidence: ${value}`);
  }
  assert.equal((html.match(/<summary>Reveal group \d<\/summary>/g) || []).length, 4);
  assert(html.includes("exactly one complete partition") && html.includes(String(manifest.solver.validQuartetCount)));
  const older = newestFirst[index + 1], newer = newestFirst[index - 1];
  const nav = html.match(/<nav class="date-nav">([\s\S]*?)<\/nav>/)?.[1] || "";
  const linkedDates = [...nav.matchAll(/\/daily\/(\d{4}-\d{2}-\d{2})\//g)].map((match) => match[1]);
  assert.deepEqual(linkedDates, [older, newer].filter(Boolean), `${date} prev/next must point only to adjacent elapsed manifests`);
  assert([...html.matchAll(/\/daily\/(\d{4}-\d{2}-\d{2})\//g)].every((match) => manifests.has(match[1])));
  return { puzzle, main: text(html.match(/<main[\s\S]*?<\/main>/)?.[0] || "") };
}

for (const [index, date] of newestFirst.entries()) {
  const html = htmlByRoute.get(`/daily/${date}/`), manifest = manifests.get(date);
  const result = assertDailyPage(html, manifest, index);
  const title = one(html, /<title>([^<]+)<\/title>/g, `${date} title`), description = one(html, /<meta\s+name="description"\s+content="([^"]+)"/g, `${date} description`), h1 = one(html, /<h1[^>]*>([\s\S]*?)<\/h1>/g, `${date} H1`);
  assert(!titles.has(title) && !descriptions.has(description) && !h1s.has(h1), `${date} metadata must be unique`);
  titles.add(title); descriptions.add(description); h1s.add(h1);
  assert(!dailyMainText.has(result.main), `${date} duplicates another date page's material content`); dailyMainText.add(result.main);
  assert(!embeddedHashes.has(result.puzzle.contentHash)); embeddedHashes.add(result.puzzle.contentHash);
}

// Direct adversarial mutations are rejected by the same manifest-bound checks.
const newest = newestFirst[0], prior = newestFirst[1], newestHtml = htmlByRoute.get(`/daily/${newest}/`);
assert.throws(() => assertDailyPage(newestHtml.replace(`${siteUrl}/daily/${newest}/`, `${siteUrl}/daily/${prior}/`), manifests.get(newest), 0));
const priorPuzzleTag = htmlByRoute.get(`/daily/${prior}/`).match(/<script id="pokesort-puzzle-data"[\s\S]*?<\/script>/)[0];
assert.throws(() => assertDailyPage(newestHtml.replace(/<script id="pokesort-puzzle-data"[\s\S]*?<\/script>/, priorPuzzleTag), manifests.get(newest), 0));

for (const month of months) {
  const route = `/archive/${month.slice(0, 4)}/${month.slice(5)}/`, html = htmlByRoute.get(route);
  for (const date of dates.filter((value) => value.startsWith(month))) assert(html.includes(`href="/daily/${date}/"`), `${date} must persist on its month hub`);
}

// Measure real internal-link depth instead of assuming the hierarchy.
const distances = new Map([["/", 0]]), queue = ["/"];
while (queue.length) {
  const route = queue.shift(), nextDistance = distances.get(route) + 1;
  for (const link of routeLinks(htmlByRoute.get(route) || "")) if (htmlByRoute.has(link) && !distances.has(link)) { distances.set(link, nextDistance); queue.push(link); }
}
for (const route of dailyRoutes) assert((distances.get(route) ?? Infinity) <= 3, `${route} exceeds Home → Archive → Month → Date click depth`);

// No future date may occur in any public text artifact, route, sitemap, JSON,
// worker source, or link graph. This also catches copied private JSON payloads.
async function collectTextFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectTextFiles(path, files);
    else if (/\.(?:html|xml|json|js|txt|map)$/i.test(entry.name) || entry.name.startsWith("_worker")) files.push(path);
  }
  return files;
}
for (const file of await collectTextFiles(dist)) {
  const contents = await readFile(file, "utf8");
  for (const match of contents.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) assert(match[1] <= asOfDate, `future date ${match[1]} leaked into ${file}`);
  assert(!/(?:sourceSeed|productionSeed|calendarSeed|privateSeed)\s*[":=]/i.test(contents), `derivation material leaked into ${file}`);
}
const tomorrow = new Date(`${asOfDate}T00:00:00.000Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
await assert.rejects(() => readFile(resolve(dist, `daily/${tomorrow.toISOString().slice(0, 10)}/index.html`)));

// A fully rehashed, semantically valid copy of an earlier board under another
// date is still a thin duplicate and must fail the public-history Gate.
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "pokesort-r6-"));
try {
  const duplicateDirectory = resolve(temporaryRoot, "duplicate"); await mkdir(duplicateDirectory);
  const first = structuredClone(manifests.get(dates[0])), secondDate = dates[1], duplicate = structuredClone(first);
  duplicate.date = secondDate; duplicate.publishAtUtc = `${secondDate}T00:00:00.000Z`; delete duplicate.contentHash; delete duplicate.puzzleId;
  duplicate.contentHash = sha256(duplicate); duplicate.puzzleId = `daily-${secondDate}-${duplicate.contentHash.slice(0, 16)}`;
  const duplicateIndex = publicHistoryIndex([first, duplicate].map((manifest) => ({ ...manifest, file: `${manifest.date}.json` })));
  await writeFile(resolve(duplicateDirectory, `${first.date}.json`), `${JSON.stringify(first, null, 2)}\n`);
  await writeFile(resolve(duplicateDirectory, `${duplicate.date}.json`), `${JSON.stringify(duplicate, null, 2)}\n`);
  await writeFile(resolve(duplicateDirectory, "index.json"), `${JSON.stringify(duplicateIndex, null, 2)}\n`);
  await assert.rejects(() => validatePublicDailyHistory({ directory: duplicateDirectory, asOfDate: secondDate }), /reuses board content/);

  // Simulate a crash after manifest creation and before index rename. The next
  // invocation resumes the exact append; conflicting bytes remain untouched.
  const recoveryDirectory = resolve(temporaryRoot, "recovery"); await mkdir(recoveryDirectory);
  await writeFile(resolve(recoveryDirectory, `${first.date}.json`), `${JSON.stringify(first, null, 2)}\n`);
  await writeFile(resolve(recoveryDirectory, "index.json"), `${JSON.stringify(publicHistoryIndex([{ ...first, file: `${first.date}.json` }]), null, 2)}\n`);
  const second = structuredClone(manifests.get(secondDate)); second.quality = { ...second.quality, accepted: true }; delete second.contentHash; delete second.puzzleId;
  second.contentHash = sha256(second); second.puzzleId = `daily-${secondDate}-${second.contentHash.slice(0, 16)}`;
  const secondBytes = `${JSON.stringify(second, null, 2)}\n`;
  await writeFile(resolve(recoveryDirectory, `${secondDate}.json`), secondBytes, { flag: "wx" });
  const payload = { schemaVersion: 1, status: "ready", utcDate: secondDate, puzzleId: second.puzzleId, contentHash: second.contentHash, manifest: second };
  const recovered = await publishElapsedHistory({ payload, publicDirectory: recoveryDirectory, asOfDate: secondDate });
  assert.equal(recovered.result, "created");
  assert.equal((await validatePublicDailyHistory({ directory: recoveryDirectory, asOfDate: secondDate })).dates.length, 2);

  const conflictDirectory = resolve(temporaryRoot, "conflict"); await cp(recoveryDirectory, conflictDirectory, { recursive: true });
  const thirdDate = dates[2];
  await writeFile(resolve(conflictDirectory, `${thirdDate}.json`), "{}\n", { flag: "wx" });
  const third = structuredClone(manifests.get(thirdDate)); third.quality = { ...third.quality, accepted: true }; delete third.contentHash; delete third.puzzleId;
  third.contentHash = sha256(third); third.puzzleId = `daily-${thirdDate}-${third.contentHash.slice(0, 16)}`;
  const thirdPayload = { schemaVersion: 1, status: "ready", utcDate: thirdDate, puzzleId: third.puzzleId, contentHash: third.contentHash, manifest: third };
  await assert.rejects(() => publishElapsedHistory({ payload: thirdPayload, publicDirectory: conflictDirectory, asOfDate: thirdDate }), /IMMUTABLE_HISTORY_CONFLICT/);
  assert.equal(await readFile(resolve(conflictDirectory, `${thirdDate}.json`), "utf8"), "{}\n", "conflicting orphan must be preserved for investigation");
} finally { await rm(temporaryRoot, { recursive: true, force: true }); }

assert.equal(sitemapEntries.length, 9 + dates.length + years.length + months.length);
console.log(JSON.stringify({ gate: "PASS", indexableRoutes: sitemapEntries.length, evergreenRoutes: 9, elapsedDateRoutes: dates.length, yearHubs: years.length, monthHubs: months.length, maxDailyClickDepth: Math.max(...dailyRoutes.map((route) => distances.get(route))), trackedElapsedInputs: trackedHistory.length - 1, adversarialCases: ["stale-lastmod", "wrong-canonical", "copied-page-payload", "fully-rehashed-thin-board", "recoverable-orphan", "conflicting-orphan", "future-public-text"] }, null, 2));
