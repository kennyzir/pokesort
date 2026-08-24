import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderTodayPage } from "./render-today.mjs";
import { computeContentSha256 } from "./verify-manifest.mjs";

const fixture = JSON.parse(await readFile(new URL("../../data/pokelike/fixtures/puzzle-54.verified.v1.json", import.meta.url), "utf8"));
const now = new Date("2026-08-24T05:00:00.000Z");
const count = (value, pattern) => (value.match(pattern) ?? []).length;

const preview = renderTodayPage({ manifests: [fixture], now, allowVerifiedPreview: true });
assert.equal(preview.state, "preview");
assert.equal(count(preview.html, /data-answer-position=/g), 6);
assert.equal(count(preview.html, /data-link-explanation=/g), 5);
assert.match(preview.html, /name="robots" content="noindex,follow"/);
assert.match(preview.html, /rel="canonical" href="https:\/\/pokesort\.org\/pokelike-pokesort\/today\/"/);
assert.match(preview.html, /property="og:url" content="https:\/\/pokesort\.org\/pokelike-pokesort\/today\/"/);
assert.match(preview.html, /PRIVATE PREVIEW/);
assert.match(preview.html, /midnight in each player’s local timezone/);
assert.match(preview.html, /<details class="today-disclosure" data-hint-level="0"><summary>No-spoiler hint/);
assert.match(preview.html, /<noscript>[\s\S]*Date check required/);
for (const candidate of fixture.candidates) assert.match(preview.html, new RegExp(`>${candidate.name}<`));
for (const link of fixture.links) assert.ok(preview.html.includes(link.explanation));
const previewSchemas = [...preview.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
assert.ok(previewSchemas.some((schema) => schema["@type"] === "WebPage" && schema.url === "https://pokesort.org/pokelike-pokesort/today/"));

const ordinaryVerified = renderTodayPage({ manifests: [fixture], now });
assert.equal(ordinaryVerified.state, "unavailable", "ordinary rendering must reject VERIFIED-only data");
assert.doesNotMatch(ordinaryVerified.html, /Yamask|Flygon|Hitmonchan|Honedge|Palpitoad|Nosepass/);
assert.match(ordinaryVerified.html, /<title>Pokelike Pokésort Today — Answer &amp; Hint Status<\/title>/);

const published = structuredClone(fixture);
published.status = "PUBLISHED";
const production = renderTodayPage({ manifests: [published], now });
assert.equal(production.state, "published");
assert.doesNotMatch(production.html, /PRIVATE PREVIEW/);

const stale = renderTodayPage({ manifests: [published], now: new Date("2026-08-25T05:00:00.000Z") });
assert.equal(stale.state, "unavailable");
assert.ok(stale.rejections[0].issues.includes("STALE_MANIFEST"));
assert.match(stale.html, /data-availability-reason="stale_record"/);
assert.doesNotMatch(stale.html, /Yamask|Flygon|Hitmonchan|Honedge|Palpitoad|Nosepass/);

const tampered = structuredClone(published);
tampered.candidates[0].name = "Tampered";
const rejected = renderTodayPage({ manifests: [tampered], now });
assert.equal(rejected.state, "unavailable");
assert.ok(rejected.rejections[0].issues.includes("CONTENT_HASH_MISMATCH"));
assert.match(rejected.html, /data-availability-reason="verification_failed"/);

const loadFailure = renderTodayPage({ now, unavailableReason: "build_failed" });
assert.match(loadFailure.html, /data-availability-reason="build_failed"/);

const future = structuredClone(published);
future.localDate = "2026-08-25"; future.day += 1; future.puzzleNumber += 1;
future.provenance.contentSha256 = computeContentSha256(future);
const futureResult = renderTodayPage({ manifests: [future], now });
assert.equal(futureResult.state, "unavailable");
assert.ok(futureResult.rejections[0].issues.includes("FUTURE_MANIFEST"));

console.log("Pokelike Today renderer tests passed: preview/published policy, complete initial HTML, and stale/future/tampered rejection.");
