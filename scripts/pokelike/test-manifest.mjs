import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { computeContentSha256, inspectManifest, relationMatches, verifyManifest } from "./verify-manifest.mjs";

const fixture = async (name) => JSON.parse(await readFile(
  fileURLToPath(new URL(`../../data/pokelike/fixtures/${name}`, import.meta.url)),
  "utf8",
));
const clone = (value) => structuredClone(value);
const codes = (result) => new Set(result.issues.map(({ code }) => code));
const expectCode = (manifest, code, options) => {
  const result = inspectManifest(manifest, options);
  assert.equal(result.valid, false, `expected ${code} rejection`);
  assert(codes(result).has(code), `expected ${code}; got ${[...codes(result)].join(", ")}`);
};

const p53 = await fixture("puzzle-53.verified.v1.json");
const p54 = await fixture("puzzle-54.verified.v1.json");
const at53 = { now: new Date("2026-08-24T01:10:00.000Z") };
const at54 = { now: new Date("2026-08-24T01:10:00.000Z") };

for (const [manifest, options] of [[p53, at53], [p54, at54]]) {
  const result = verifyManifest(manifest, options);
  assert.equal(result.valid, true);
  assert.equal(result.publishable, true);
  assert.equal(result.freshness, "CURRENT");
  assert.equal(result.solutionCount, 1);
}

const missing = clone(p54);
delete missing.provenance;
expectCode(missing, "MISSING_OR_INVALID", at54);

const duplicate = clone(p54);
duplicate.candidates[5].id = duplicate.candidates[0].id;
expectCode(duplicate, "DUPLICATE_CANDIDATE", at54);

const falseRelation = clone(p54);
falseRelation.links[0].relation = "gen_lt";
expectCode(falseRelation, "FALSE_RELATION", at54);

const zero = clone(p54);
zero.links = zero.links.map((link, index) => ({
  ...link,
  relation: "gen_lt",
  leftId: zero.solutionOrder[index],
  rightId: zero.solutionOrder[index + 1],
}));
expectCode(zero, "ZERO_SOLUTIONS", at54);

const multiple = clone(p54);
multiple.candidates.forEach((candidate) => { candidate.color = "red"; });
multiple.links = multiple.links.map((link, index) => ({
  ...link,
  relation: "color",
  leftId: multiple.solutionOrder[index],
  rightId: multiple.solutionOrder[index + 1],
}));
const multipleResult = inspectManifest(multiple, at54);
assert.equal(multipleResult.solutionCount, 720);
assert(codes(multipleResult).has("MULTIPLE_SOLUTIONS"));

const unsupported = clone(p54);
unsupported.links[0].relation = "weight_gt";
expectCode(unsupported, "UNSUPPORTED_RELATION", at54);

const future = clone(p54);
future.localDate = "2026-08-25";
future.day = 20690;
future.puzzleNumber = 55;
future.observedAt = "2026-08-25T01:08:00.000Z";
future.verifiedAt = "2026-08-25T01:09:00.000Z";
expectCode(future, "FUTURE_MANIFEST", at54);
expectCode(future, "FUTURE_OBSERVATION", at54);

const stale = clone(p54);
stale.status = "STALE";
expectCode(stale, "STALE_MANIFEST", { now: new Date("2026-08-25T01:10:00.000Z") });

for (const field of ["sourceSha256", "bundleSha256", "stateSha256", "contentSha256"]) {
  const badHash = clone(p54);
  badHash.provenance[field] = "ABC123";
  expectCode(badHash, "INVALID_HASH", at54);
}

assert.equal(computeContentSha256(p53), p53.provenance.contentSha256);
assert.equal(computeContentSha256(p54), p54.provenance.contentSha256);
const tamperedContent = clone(p54);
tamperedContent.candidates[0].name = "Tampered Nosepass";
expectCode(tamperedContent, "CONTENT_HASH_MISMATCH", at54);
const mismatchedContentHash = clone(p54);
mismatchedContentHash.provenance.contentSha256 = "0000000000000000000000000000000000000000000000000000000000000000";
expectCode(mismatchedContentHash, "CONTENT_HASH_MISMATCH", at54);

for (const mutate of [
  (manifest) => { manifest.unexpected = true; },
  (manifest) => { manifest.candidates[0].unexpected = true; },
  (manifest) => { manifest.links[0].unexpected = true; },
  (manifest) => { manifest.hints.unexpected = true; },
  (manifest) => { manifest.provenance.unexpected = true; },
]) {
  const unknown = clone(p54);
  mutate(unknown);
  expectCode(unknown, "UNKNOWN_PROPERTY", at54);
}

const badTimezone = clone(p54);
badTimezone.timezone = "Shanghai";
expectCode(badTimezone, "INVALID_TIMEZONE", at54);

const badDay = clone(p54);
badDay.day += 1;
expectCode(badDay, "DAY_MISMATCH", at54);

const badPuzzle = clone(p54);
badPuzzle.puzzleNumber += 1;
expectCode(badPuzzle, "PUZZLE_MISMATCH", at54);

for (const status of ["PENDING", "EXTRACTED", "BLOCKED"]) {
  const nonPublishing = clone(p54);
  nonPublishing.status = status;
  const result = verifyManifest(nonPublishing, at54);
  assert.equal(result.valid, true);
  assert.equal(result.publishable, false);
}

const published = clone(p54);
published.status = "PUBLISHED";
const publishedResult = verifyManifest(published, at54);
assert.equal(publishedResult.valid, true);
assert.equal(publishedResult.publishable, true);
assert.equal(publishedResult.freshness, "CURRENT");
assert.equal(publishedResult.solutionCount, 1);

assert.equal(relationMatches("se",
  { types: ["fire"] }, { types: ["grass", "water"] }), true,
"se compares the attacker's primary type with the defender's primary type");
assert.equal(relationMatches("se",
  { types: ["fire"] }, { types: ["water", "grass"] }), false,
"se must not fall through to the defender's secondary type");

const relationCases = [
  ["color", { color: "red" }, { color: "red" }],
  ["type", { types: ["fire", "fighting"] }, { types: ["fire"] }],
  ["gen_eq", { generation: 5 }, { generation: 5 }],
  ["gen_gt", { generation: 5 }, { generation: 3 }],
  ["gen_lt", { generation: 3 }, { generation: 5 }],
  ["stage_eq", { stage: 1 }, { stage: 1 }],
  ["stage_gt", { stage: 2 }, { stage: 1 }],
  ["stage_lt", { stage: 0 }, { stage: 1 }],
];
for (const [relation, left, right] of relationCases) {
  assert.equal(relationMatches(relation, left, right), true, `${relation} true case`);
  assert.equal(relationMatches(relation, right, left), relation.endsWith("_eq") || relation === "color" || relation === "type", `${relation} reverse case`);
}

const throwsFixture = clone(p54);
throwsFixture.provenance.stateSha256 = "not-a-hash";
assert.throws(() => verifyManifest(throwsFixture, at54), (error) => error.name === "ManifestValidationError");
console.log("Pokelike manifest contract tests passed (2 first-party fixtures; rejection, freshness, state, and 720-permutation gates). ");
