import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
const output = new URL("../dist/", import.meta.url);
const siteUrl = (process.env.SITE_URL || "https://monsort.example").replace(/\/$/, "");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "404.html", "assets", "pokesort-alternative", "pokesort-down", "privacy", "manifest.webmanifest", "robots.txt", "sitemap.xml"]) {
  try { await cp(new URL(`../${path}`, import.meta.url), new URL(path, output), { recursive: true }); } catch (error) { if (path !== "404.html") throw error; }
}
async function replaceBaseUrl(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) await replaceBaseUrl(url);
    else if (/\.(html|xml|txt)$/.test(entry.name)) {
      const contents = await readFile(url, "utf8");
      await writeFile(url, contents.replaceAll("https://monsort.com", siteUrl));
    }
  }
}
await replaceBaseUrl(output);
console.log(`Static site built in dist/ for ${siteUrl}`);
if (siteUrl.endsWith(".example")) console.warn("Set SITE_URL to the production origin before deployment.");
