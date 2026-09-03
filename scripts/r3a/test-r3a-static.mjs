import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(process.env.POKESORT_R3A_DIST || "dist");

const calls = [];
globalThis.window = { gtag: (...args) => calls.push(args) };
const analytics = await import("../../assets/analytics.js");

assert.deepEqual(analytics.POKESORT_ANALYTICS_EVENTS, [
  "pokesort_board_ready", "pokesort_game_start", "pokesort_guess_submit", "pokesort_group_solved",
  "pokesort_valid_overlap", "pokesort_hint_open", "pokesort_reveal", "pokesort_game_complete",
  "pokesort_share", "pokesort_new_infinite", "pokesort_load_error",
]);
assert.deepEqual(analytics.POKESORT_ANALYTICS_PARAMETERS, [
  "elapsed_ms", "error_stage", "game_mode", "groups_solved", "guess_match_count", "hint_level",
  "load_ms", "mistakes", "outcome", "round_number", "share_method",
]);
const sanitized = analytics.sanitizePokeSortEvent("pokesort_guess_submit", {
  game_mode: "daily", elapsed_ms: 12, mistakes: 0, groups_solved: 0, guess_match_count: 3, outcome: "valid_overlap",
  puzzle_id: "secret", pokemon_id: 25, pokemon_name: "Pikachu", selected_ids: [1, 2, 3, 4], group_name: "secret",
  member_signature: "1-2-3-4", raw_error: "secret", stack: "secret", URL: "https://example.test/?secret=1",
});
assert.deepEqual(sanitized, { game_mode: "daily", elapsed_ms: 12, mistakes: 0, groups_solved: 0, guess_match_count: 3, outcome: "valid_overlap" });
assert.equal(analytics.sanitizePokeSortEvent("unknown", {}), null);
assert.equal(analytics.sanitizePokeSortEvent("pokesort_load_error", { game_mode: "daily", error_stage: "other", raw_error: "x" }), null);
assert.equal(analytics.sanitizePokeSortEvent("pokesort_game_complete", { game_mode: "daily", elapsed_ms: 1, outcome: "failed" }), null);
assert.equal(analytics.sanitizePokeSortEvent("pokesort_game_complete", { game_mode: "daily", elapsed_ms: 1, outcome: "revealed" }), null);
assert.deepEqual(analytics.sanitizePokeSortEvent("pokesort_game_complete", { game_mode: "daily", elapsed_ms: 1, outcome: "solved" }), { game_mode: "daily", elapsed_ms: 1, outcome: "solved" });
assert.equal(analytics.emitPokeSortEvent("pokesort_share", { game_mode: "daily", elapsed_ms: 1, share_method: "clipboard" }), true);
assert.equal(calls.length, 1);
delete globalThis.window.gtag;
assert.doesNotThrow(() => analytics.emitPokeSortEvent("pokesort_board_ready", { game_mode: "daily", outcome: "embedded", load_ms: 1 }));
globalThis.window.gtag = () => { throw new Error("analytics unavailable"); };
assert.doesNotThrow(() => analytics.emitPokeSortEvent("pokesort_board_ready", { game_mode: "daily", outcome: "embedded", load_ms: 1 }));
assert.equal(analytics.emitPokeSortEvent("pokesort_board_ready", { game_mode: "daily", outcome: "embedded", load_ms: 1 }), false);

const [home, howTo, rules, manifest, game, build, styles] = await Promise.all([
  readFile(resolve(dist, "index.html"), "utf8"), readFile("how-to-play/index.html", "utf8"), readFile("data/pokemon/category-rules.v2.json", "utf8"),
  readFile("data/puzzles/public-daily/2026-08-25.json", "utf8"), readFile("assets/game.js", "utf8"), readFile("scripts/build.mjs", "utf8"), readFile("assets/styles.css", "utf8"),
]);
assert.match(home, /<title>PokeSort 4×4 Daily — Pokémon Grouping Puzzle<\/title>/);
assert.match(home, /content="Play today's free PokeSort 4×4 grouping puzzle\. Sort 16 Pokémon into four hidden groups, protect your streak, or practice in 4×4 Infinite mode\."/);
assert.match(home, /<h1>Find four groups in today’s 4×4 PokeSort<\/h1>/);
assert.match(home, /rel="canonical" href="https:\/\/pokesort\.org\/"/);
assert.match(home, /property="og:site_name" content="PokeSort 4×4"/);
assert.match(home, /<nav aria-label="Main navigation">[\s\S]*Daily[\s\S]*Infinite[\s\S]*Archive[\s\S]*How to Play[\s\S]*<\/nav>/);
assert.doesNotMatch(howTo, /Eeveelution|Vaporeon|Jolteon|Flareon|Espeon/);
assert.match(howTo, /Only Bug type/); assert.match(howTo, /Caterpie, Burmy, Shelmet, and Spidops/); assert.match(howTo, /href="\/daily\/2026-08-25\/"/);
const ruleData = JSON.parse(rules), daily = JSON.parse(manifest);
assert.ok(ruleData.rules.some(({ id }) => id === "monotype"));
const example = daily.groups.find(({ label }) => label === "Only Bug type");
assert.ok(example); assert.equal(example.predicateSignature, 'monotype:{"type":"bug"}');
assert.deepEqual(example.members.map(({ name }) => name), ["Caterpie", "Burmy", "Shelmet", "Spidops"]);
assert.match(game, /schemaVersion: 2, stateVersion: 2/); assert.match(game, /analyticsCompletionSent/); assert.match(game, /pokesort:game:v2:/); assert.match(game, /textContent = item\.selectedIds/);
assert.match(game, /Valid Pokémon fact — not the intended group\. No mistake charged\./);
assert.ok(game.indexOf("if (activeValidQuartets.has(signature))") < game.indexOf("mistakes += 1"));
assert.match(game, /Repeated guess/); assert.match(game, /Two members are \$\{names\[0\]\} and \$\{names\[1\]\}\./);
assert.match(game, /activeReadySessionId = requestedLoadVersion/); assert.match(game, /boardReadySentForLoadVersion !== requestedLoadVersion/);
assert.match(game, /migrated\.analyticsCompletionSent = terminal/); assert.match(game, /\$\{result\}\$\{item\.repeated \? " · Repeated guess" : ""\}/);
assert.doesNotMatch(game, /recordGameComplete\("failed"\)|recordGameComplete\("revealed"\)/);
assert.match(game, /if \(outcome === "solved"\) recordGameComplete\(\)/);
assert.match(game, /Date\.UTC\(now\.getUTCFullYear\(\), now\.getUTCMonth\(\), now\.getUTCDate\(\) \+ 1/);
assert.match(build, /assets\/infinite-overlaps/); assert.match(build, /payloadHash/); assert.doesNotMatch(build, /embeddedContentHash/); assert.match(styles, /\.guess-history/); assert.match(styles, /max-height:18rem;overflow-y:auto/);
assert.doesNotMatch(game, /puzzle_id|pokemon_id|pokemon_name|selected_ids|group_name|member_signature|raw_error|stack:/);
console.log(JSON.stringify({ gate: "PASS", analyticsEvents: analytics.POKESORT_ANALYTICS_EVENTS.length, protectedFields: true, howToPlayVerified: true, stateVersion: 2 }));
