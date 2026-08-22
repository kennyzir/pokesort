import { readFile, access } from "node:fs/promises";
const required = ["index.html", "archive/index.html", "how-to-play/index.html", "pokesort-alternative/index.html", "pokesort-down/index.html", "privacy/index.html", "assets/styles.css", "assets/game.js", "robots.txt", "sitemap.xml"];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));
for (const page of required.filter(file => file.endsWith(".html"))) {
  const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
  for (const marker of ["<title>", "name=\"description\"", "rel=\"canonical\""]) if (!html.includes(marker)) throw new Error(`${page} is missing ${marker}`);
}
const game = await readFile(new URL("../assets/game.js", import.meta.url), "utf8");
if ((game.match(/mons:\s*\[/g) || []).length < 12) throw new Error("Expected at least 12 puzzle groups");
console.log("Validated pages, metadata, and puzzle packs.");
