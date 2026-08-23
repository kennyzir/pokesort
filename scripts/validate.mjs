import { readFile, access } from "node:fs/promises";
const required = ["index.html", "archive/index.html", "how-to-play/index.html", "pokesort-alternative/index.html", "pokesort-down/index.html", "privacy/index.html", "assets/styles.css", "assets/game.js", "assets/logo.svg", "assets/logo-mark.svg", "assets/favicon.svg", "favicon.ico", "assets/favicon.ico", "assets/favicon-16x16.png", "assets/favicon-32x32.png", "assets/favicon-48x48.png", "assets/apple-touch-icon.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png", "assets/social-card.png", "manifest.webmanifest", "robots.txt", "sitemap.xml"];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));
for (const page of required.filter(file => file.endsWith(".html"))) {
  const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
  for (const marker of ["<title>", "name=\"description\"", "rel=\"canonical\"", "rel=\"icon\"", "rel=\"apple-touch-icon\"", "rel=\"manifest\""]) if (!html.includes(marker)) throw new Error(`${page} is missing ${marker}`);
}
const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
if (!manifest.icons?.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable")) throw new Error("Manifest is missing a 512x512 maskable icon");
const game = await readFile(new URL("../assets/game.js", import.meta.url), "utf8");
if ((game.match(/mons:\s*\[/g) || []).length < 12) throw new Error("Expected at least 12 puzzle groups");
console.log("Validated pages, metadata, and puzzle packs.");
