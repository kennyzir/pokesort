import assert from "node:assert/strict";
import { TODAY_EVENT_CONTRACT, emitTodayEvent, validateTodayEvent } from "../../assets/pokelike-today-analytics.js";

assert.deepEqual(Object.keys(TODAY_EVENT_CONTRACT).sort(), [
  "pokelike_today_answer_reveal",
  "pokelike_today_community_click",
  "pokelike_today_hint_open",
  "pokelike_today_official_click",
  "pokelike_today_unavailable",
  "pokelike_today_view",
]);
assert.deepEqual(validateTodayEvent("pokelike_today_hint_open", { today_state: "published", hint_level: 2 }), { today_state: "published", hint_level: 2 });
assert.throws(() => validateTodayEvent("pokelike_today_hint_open", { today_state: "published", hint_level: 1, pokemon_name: "redacted" }), /parameters must be exactly/);
assert.throws(() => validateTodayEvent("pokelike_today_view", { today_state: "published", page_location: "https:\/\/example.test\/?secret=1" }), /parameters must be exactly/);
assert.throws(() => validateTodayEvent("pokelike_today_unavailable", { today_state: "unavailable", availability_reason: "arbitrary text" }), /not an allowed value/);

const serializedContract = JSON.stringify(TODAY_EVENT_CONTRACT).toLowerCase();
for (const forbidden of ["pokemon", "order", "worksheet", "saved", "free_text", "query", "user_id", "localstorage", "page_location"]) assert.equal(serializedContract.includes(forbidden), false, `contract must not expose ${forbidden}`);

const queuedWindow = {};
emitTodayEvent("pokelike_today_answer_reveal", { today_state: "preview" }, queuedWindow);
assert.deepEqual(queuedWindow.dataLayer, [["event", "pokelike_today_answer_reveal", { today_state: "preview" }]], "events must queue safely when gtag is absent");

const calls = [];
const configuredWindow = { gtag: (...args) => calls.push(args) };
emitTodayEvent("pokelike_today_official_click", { today_state: "unavailable" }, configuredWindow);
assert.deepEqual(calls, [["event", "pokelike_today_official_click", { today_state: "unavailable" }]]);
assert.equal(configuredWindow.dataLayer, undefined, "the entrypoint must reuse existing gtag instead of loading or configuring another tag");

console.log("Pokelike Today analytics contract passed: six allowlisted events, exact low-cardinality payloads, safe queueing, and no puzzle/user/query fields.");
