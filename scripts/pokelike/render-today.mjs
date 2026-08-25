import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectManifest } from "./verify-manifest.mjs";

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function shell({ title, description, body, siteUrl }) {
  const url = `${siteUrl}/pokelike-pokesort/today/`;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url,
    description,
    isPartOf: { "@type": "WebSite", name: "PokeSort 4×4", url: `${siteUrl}/` },
    about: { "@type": "VideoGame", name: "Pokelike Daily Pokésort" },
  }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${escapeHtml(url)}">
  <meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(siteUrl)}/assets/social-card.png">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(siteUrl)}/assets/social-card.png">
  <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48 96x96"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" sizes="any"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/assets/styles.css">
  <script type="application/ld+json">${schema}</script>
</head><body>
<header class="site-header"><a class="brand" href="/" aria-label="PokeSort home"><img class="brand-mark" src="/assets/logo-mark.svg" width="34" height="34" alt=""><span>POKE<strong>SORT</strong></span></a><nav aria-label="Main navigation"><a href="/">4×4 Daily</a><a href="/infinite/">Infinite</a><a href="/archive/">Archive</a><a href="/pokelike-pokesort/">Pokelike guide</a></nav></header>
${body}
<footer><div><a class="brand footer-brand" href="/"><img class="brand-mark" src="/assets/logo-mark.svg" width="34" height="34" alt=""><span>POKE<strong>SORT</strong></span></a><p>Unofficial fan-made Pokémon puzzle and guide.</p></div><div class="footer-links"><a href="/">Play 4×4</a><a href="/pokelike-pokesort/">Pokelike rules</a><a href="/about/">About</a></div></footer>
<script type="module" src="/assets/pokelike-today.js"></script></body></html>`;
}

function unavailable({ siteUrl, requestedDate, reason = "No current published answer has passed verification.", availabilityReason = "not_published" }) {
  return shell({ siteUrl, title: "Pokelike Pokésort Today — Answer & Hint Status", description: "Check Pokelike Pokésort Today answer and hint availability. Publication stays held until the current six-Pokémon order and five links pass verification.", body: `<main class="content-page pokelike-today" data-today-state="unavailable" data-availability-reason="${escapeHtml(availabilityReason)}">
  <nav aria-label="Breadcrumb"><a href="/">PokeSort</a> / <a href="/pokelike-pokesort/">Pokelike Pokésort</a> / Today</nav><p class="section-label">POKELIKE DAILY · PUBLICATION HELD</p>
  <h1>Today’s Pokelike Pokésort answer is unavailable</h1><div class="notice" role="status"><strong>No answer is being shown.</strong> ${escapeHtml(reason)}</div>
  <p id="visitor-date"><span data-date-label>Build reference date</span>: <time data-local-date datetime="${escapeHtml(requestedDate)}">${escapeHtml(requestedDate)}</time>. Pokelike changes puzzles at midnight in the player’s local timezone, so a different date is never silently substituted.</p>
  <p>This page remains separate from the independent 4×4 PokeSort Daily. A missing answer does not change or remove that game.</p>
  <p><a class="primary-link" href="https://pokelike.xyz/pokesort" rel="external" data-today-analytics-target="official">Open the official Daily Pokésort →</a></p><p>Need the rules while this answer is held? Use the <a href="/pokelike-pokesort/">six-Pokémon solving guide and local worksheet</a>.</p>
</main>` });
}

function verifiedBody(manifest, { preview }) {
  const byId = new Map(manifest.candidates.map((candidate) => [candidate.id, candidate]));
  const order = manifest.solutionOrder.map((id) => byId.get(id));
  const progressive = manifest.hints.progressive.map((hint, index) => `<details class="today-disclosure" data-hint-level="${index + 1}"><summary>Progressive hint ${index + 1}</summary><p>${escapeHtml(hint)}</p></details>`).join("\n");
  const orderItems = order.map((candidate, index) => `<li data-answer-position="${index + 1}"><span class="answer-position">${index + 1}</span> <strong>${escapeHtml(candidate.name)}</strong></li>`).join("\n");
  const explanations = manifest.links.map((link, index) => `<li data-link-explanation="${index + 1}"><strong>${escapeHtml(byId.get(link.leftId).name)} → ${escapeHtml(byId.get(link.rightId).name)}</strong><br>${escapeHtml(link.explanation)}</li>`).join("\n");
  return `<main class="content-page pokelike-today" data-today-state="${preview ? "preview" : "published"}" data-puzzle-date="${escapeHtml(manifest.localDate)}">
  <nav aria-label="Breadcrumb"><a href="/">PokeSort</a> / <a href="/pokelike-pokesort/">Pokelike Pokésort</a> / Today</nav><p class="section-label">POKELIKE DAILY${preview ? " · PRIVATE PREVIEW" : ""}</p>
  <h1>Pokelike Pokésort answer for <time datetime="${escapeHtml(manifest.localDate)}">${escapeHtml(manifest.localDate)}</time></h1>
  ${preview ? '<div class="notice" role="status"><strong>Preview only:</strong> this VERIFIED record has not been published and this page remains noindex.</div>' : ""}
  <p class="lede">Puzzle #${manifest.puzzleNumber}. Verified <time datetime="${escapeHtml(manifest.verifiedAt)}">${escapeHtml(manifest.verifiedAt)}</time>. Pokelike resets at midnight in each player’s local timezone.</p>
  <p id="visitor-date">The answer below is explicitly for local calendar date <strong>${escapeHtml(manifest.localDate)}</strong>. If your browser is on another date, this page hides the answer and reports it unavailable.</p>
  <noscript><div class="notice"><strong>Date check required:</strong> JavaScript is off, so this page cannot compare your browser date. Continue only if your local date is ${escapeHtml(manifest.localDate)}; otherwise this answer is unavailable for your date.</div></noscript>
  <p><a class="primary-link" href="https://pokelike.xyz/pokesort" rel="external" data-today-analytics-target="official">Play the official Daily Pokésort →</a></p>
  <section aria-labelledby="hints-title"><h2 id="hints-title">Hints without the full answer</h2><details class="today-disclosure" data-hint-level="0"><summary>No-spoiler hint</summary><p>${escapeHtml(manifest.hints.noSpoiler)}</p></details>${progressive}</section>
  <section aria-labelledby="answer-title"><h2 id="answer-title">Reveal the six-Pokémon order</h2><details class="today-disclosure answer-reveal" data-answer-reveal><summary>Show the verified order and all five links</summary><p>Read the chain from position 1 through position 6:</p><ol class="today-answer-order">${orderItems}</ol><h3>Why each neighbouring link works</h3><ol class="today-link-explanations">${explanations}</ol></details></section>
  <div class="notice"><strong>Unofficial answer guide:</strong> verify the board date in Pokelike before using a reveal. This site is not affiliated with Pokelike, Nintendo, Game Freak, or The Pokémon Company.</div>
</main>
<template id="date-mismatch-template"><main class="content-page pokelike-today" data-today-state="unavailable" data-availability-reason="local_date_mismatch"><nav aria-label="Breadcrumb"><a href="/">PokeSort</a> / <a href="/pokelike-pokesort/">Pokelike Pokésort</a> / Today</nav><p class="section-label">POKELIKE DAILY · DATE UNAVAILABLE</p><h1>No verified answer for your local date</h1><div class="notice" role="status"><strong>The displayed record was hidden.</strong> It belongs to <time datetime="${escapeHtml(manifest.localDate)}">${escapeHtml(manifest.localDate)}</time>, but your browser’s local date is <time data-local-date></time>.</div><p>Pokelike resets at local midnight; this page will not substitute another date’s answer.</p><p><a class="primary-link" href="https://pokelike.xyz/pokesort" rel="external" data-today-analytics-target="official">Open the official Daily Pokésort →</a></p><p><a href="/pokelike-pokesort/">Read the spoiler-free solving guide</a>.</p></main></template>`;
}

export function renderTodayPage({ manifests = [], now = new Date(), allowVerifiedPreview = false, siteUrl = "https://pokesort.org", unavailableReason = null } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new TypeError("now must be a valid Date");
  const accepted = [], rejections = [];
  for (const manifest of manifests) {
    const inspection = inspectManifest(manifest, { now });
    const statusAllowed = manifest?.status === "PUBLISHED" || (allowVerifiedPreview && manifest?.status === "VERIFIED");
    if (inspection.publishable && statusAllowed) accepted.push(manifest);
    else rejections.push({ localDate: manifest?.localDate, status: manifest?.status, issues: inspection.issues.map(({ code }) => code), statusAllowed });
  }
  const requestedDate = now.toISOString().slice(0, 10);
  const manifest = accepted.find((entry) => entry.localDate === requestedDate) ?? accepted[0];
  if (!manifest) {
    const availabilityReason = unavailableReason
      ?? (rejections.some((entry) => entry.issues.includes("STALE_MANIFEST")) ? "stale_record"
        : rejections.some((entry) => entry.issues.length > 0) ? "verification_failed"
          : "not_published");
    return { html: unavailable({ siteUrl, requestedDate, availabilityReason }), state: "unavailable", manifest: null, rejections };
  }
  const preview = manifest.status === "VERIFIED";
  return { html: shell({ siteUrl, title: `Pokelike Pokésort Answer Today (${manifest.localDate}) — Hints & Links`, description: `Spoiler-controlled hints, the verified six-Pokémon order, and all five link explanations for Pokelike Pokésort ${manifest.localDate}.`, body: verifiedBody(manifest, { preview }) }), state: preview ? "preview" : "published", manifest, rejections };
}

export async function loadManifestFiles(paths) {
  const manifests = [];
  for (const path of paths) manifests.push(JSON.parse(await readFile(resolve(path), "utf8")));
  return manifests;
}
