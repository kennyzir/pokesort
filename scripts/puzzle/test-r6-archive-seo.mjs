import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const dist = new URL("../../dist/", import.meta.url);
const asOfDate = new Date().toISOString().slice(0, 10);
const index = JSON.parse(await readFile(new URL("data/puzzles/public-daily/index.json", root), "utf8"));
const dates = index.entries.map(({ date }) => date);
assert(dates.every((date) => date <= asOfDate));
const sitemap = await readFile(new URL("sitemap.xml", dist), "utf8");
for (const date of dates) assert(sitemap.includes(`<loc>https://pokesort.org/daily/${date}/</loc><lastmod>${date}</lastmod>`));
assert([...sitemap.matchAll(/\/daily\/(\d{4}-\d{2}-\d{2})\//g)].every((match) => match[1] <= asOfDate));
const archive = await readFile(new URL("archive/index.html", dist), "utf8");
assert.equal((archive.match(/id="archive-grid"[\s\S]*?<\/nav>/)?.[0].match(/href="\/daily\//g) || []).length, 31);
const months = [...new Set(dates.map((date) => date.slice(0, 7)))];
for (const month of months) {
  const path = `archive/${month.slice(0, 4)}/${month.slice(5)}/index.html`;
  const html = await readFile(new URL(path, dist), "utf8");
  for (const date of dates.filter((value) => value.startsWith(month))) assert(html.includes(`href="/daily/${date}/"`), `${date} is not reachable from ${month}`);
}
for (const date of dates) {
  const html = await readFile(new URL(`daily/${date}/index.html`, dist), "utf8");
  assert(html.includes(`rel="canonical" href="https://pokesort.org/daily/${date}/"`));
  assert(html.includes("<h2>Board profile</h2>") && html.includes("<h2>Group reveals</h2>") && html.includes("<h2>Likely overlap</h2>"));
}
async function collectHtml(directory, result = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) await collectHtml(url, result); else if (entry.name.endsWith(".html")) result.push(await readFile(url, "utf8"));
  }
  return result;
}
const publicHtml = (await collectHtml(dist)).join("\n");
for (const match of publicHtml.matchAll(/(?:\/daily\/|date[=\"']|\"date\"\s*:\s*\")(\d{4}-\d{2}-\d{2})/g)) assert(match[1] <= asOfDate, `Future date leaked into public HTML: ${match[1]}`);
console.log(`R6 Archive/SEO Gate passed: ${dates.length} elapsed pages reachable through ${months.length} month pages; future HTML/sitemap dates absent.`);
