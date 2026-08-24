import { canonicalJson, sha256 } from "./stable.mjs";
import {
  buildRuleUniverse,
  canonicalBoardSignature,
  canonicalGroupSignature,
  canonicalMemberSignature,
  publicRuleEvidence,
} from "./rule-universe.mjs";
import { enumerateInducedQuartets, solveBoard } from "./solver.mjs";
import { categoryModelAccepts, categoryModelExcludedRuleIds } from "./category-model.mjs";

function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}

function equal(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function verifyCanonicalHash(value, { label = "value", excludedKeys = ["contentHash"] } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MALFORMED_CONTENT", `${label} must be an object`);
  if (!/^[a-f0-9]{64}$/.test(value.contentHash ?? "")) fail("CONTENT_HASH_FORMAT", `${label} has no canonical SHA-256`);
  const excluded = new Set(excludedKeys);
  const base = Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
  const expected = sha256(base);
  if (value.contentHash !== expected) fail("CONTENT_HASH_MISMATCH", `${label} expected ${expected}, received ${value.contentHash}`);
  return expected;
}

export function buildCanonicalRuleEvidence(model) {
  const universe = buildRuleUniverse(model);
  return {
    universe,
    byPredicateSignature: new Map(universe.map((instance) => [instance.signature, instance])),
  };
}

function canonicalPokemon(model, id, context) {
  const pokemon = model.facts.pokemon.find((entry) => entry.id === id);
  if (!pokemon) fail("UNKNOWN_MEMBER", `${context} references species ${id}`);
  return pokemon;
}

function verifyPokemonCopy(stored, canonical, context) {
  const expected = {
    id: canonical.id,
    identifier: canonical.identifier,
    name: canonical.name,
    provenanceRefs: canonical.provenanceRefs,
  };
  if (!equal(Object.keys(stored).sort(), Object.keys(expected).sort())) fail("MEMBER_IDENTITY_SHAPE_MISMATCH", `${context} must contain exactly id, identifier, name, and provenanceRefs`);
  if (!equal(stored, expected)) fail("MEMBER_IDENTITY_MISMATCH", `${context} does not match pinned facts`);
}

function verifyGroupCopy(group, intended, context) {
  const expected = publicRuleEvidence(intended);
  if (group.label !== expected.label) fail("LABEL_MISMATCH", `${context} label differs from canonical evidence`);
  if (group.hint !== expected.hint) fail("HINT_MISMATCH", `${context} hint differs from canonical evidence`);
  if (group.explanation !== expected.explanation) fail("EXPLANATION_MISMATCH", `${context} explanation differs from canonical evidence`);
  if (!equal(group.provenance, expected.provenance)) fail("PROVENANCE_MISMATCH", `${context} source, boundary, or provenance differs from canonical evidence`);
}

export function verifyPuzzleSemantics(puzzle, {
  model,
  ruleEvidence,
  context = puzzle?.puzzleId ?? "puzzle",
  verifyCompletePartition = true,
} = {}) {
  if (!model) fail("MODEL_REQUIRED", context);
  const canonical = ruleEvidence ?? buildCanonicalRuleEvidence(model);
  if (!puzzle || typeof puzzle !== "object" || Array.isArray(puzzle)) fail("MALFORMED_PUZZLE", `${context} must be an object`);
  if (puzzle.factsSchemaVersion !== model.facts.schemaVersion) fail("FACTS_SCHEMA_MISMATCH", `${context} does not match pinned facts schema`);
  if (puzzle.datasetId !== model.facts.datasetId) fail("DATASET_ID_MISMATCH", `${context} does not match pinned facts dataset`);
  if (!categoryModelAccepts(model.rules, puzzle.categoryModelId)) fail("CATEGORY_MODEL_ID_MISMATCH", `${context} does not match pinned category model`);
  const legacyExcludedRuleIds = categoryModelExcludedRuleIds(model.rules, puzzle.categoryModelId);
  if (!Array.isArray(puzzle.cards) || puzzle.cards.length !== 16) fail("CARD_CARDINALITY", `${context} must contain 16 cards`);
  const cardIds = puzzle.cards.map(({ id }) => id);
  if (cardIds.some((id) => !Number.isSafeInteger(id)) || new Set(cardIds).size !== 16) fail("DUPLICATE_CARD_ID", `${context} cards must have 16 unique integer IDs`);
  if (puzzle.boardSignature !== canonicalBoardSignature(cardIds)) fail("BOARD_SIGNATURE_MISMATCH", context);
  puzzle.cards.forEach((card, index) => verifyPokemonCopy(card, canonicalPokemon(model, card.id, `${context}.cards[${index}]`), `${context}.cards[${index}]`));
  if (!Array.isArray(puzzle.groups) || puzzle.groups.length !== 4) fail("GROUP_CARDINALITY", `${context} must contain four groups`);

  const seenMembers = new Set();
  for (const [groupIndex, group] of puzzle.groups.entries()) {
    const groupContext = `${context}.groups[${groupIndex}]`;
    const intended = canonical.byPredicateSignature.get(group.predicateSignature);
    if (!intended) fail("UNKNOWN_PREDICATE", `${groupContext} uses ${group.predicateSignature}`);
    if (legacyExcludedRuleIds.has(intended.ruleId)) fail("LEGACY_MODEL_RULE_MISMATCH", `${groupContext} uses ${intended.ruleId}, which was introduced after ${puzzle.categoryModelId}`);
    const memberIds = group.memberIds;
    if (!Array.isArray(memberIds) || memberIds.length !== 4 || new Set(memberIds).size !== 4) fail("GROUP_MEMBER_CARDINALITY", `${groupContext} must contain exactly four unique members`);
    if (!Array.isArray(group.members) || !equal(group.members.map(({ id }) => id), memberIds)) fail("GROUP_MEMBER_PARITY", `${groupContext} members and memberIds differ`);
    for (const id of memberIds) {
      if (!cardIds.includes(id)) fail("GROUP_MEMBER_NOT_ON_BOARD", `${groupContext} includes ${id}`);
      if (!intended.memberIdSet.has(id)) fail("MEMBER_PREDICATE_MISMATCH", `${groupContext} species ${id} does not satisfy ${group.predicateSignature}`);
      if (seenMembers.has(id)) fail("DUPLICATE_PARTITION_MEMBER", `${context} repeats species ${id} across intended groups`);
      seenMembers.add(id);
    }
    group.members.forEach((member, index) => verifyPokemonCopy(member, canonicalPokemon(model, member.id, `${groupContext}.members[${index}]`), `${groupContext}.members[${index}]`));
    const memberSignature = canonicalMemberSignature(memberIds);
    if (group.memberSignature !== memberSignature) fail("MEMBER_SIGNATURE_MISMATCH", groupContext);
    if (group.signature !== canonicalGroupSignature(group.predicateSignature, memberIds)) fail("GROUP_SIGNATURE_MISMATCH", groupContext);
    verifyGroupCopy(group, intended, groupContext);
  }
  if (seenMembers.size !== 16) fail("PARTITION_MEMBER_COVERAGE", `${context} groups must cover every card exactly once`);

  const inducedByMembers = new Map(enumerateInducedQuartets(cardIds, canonical.universe).map((group) => [
    canonicalMemberSignature(group.memberIds),
    group.matchingRules.map(publicRuleEvidence),
  ]));
  for (const [groupIndex, group] of puzzle.groups.entries()) {
    const fresh = inducedByMembers.get(group.memberSignature);
    if (!fresh) fail("INTENDED_PARTITION_MISMATCH", `${context}.groups[${groupIndex}] is not a canonical induced quartet`);
    if (fresh.some(({ ruleId }) => legacyExcludedRuleIds.has(ruleId))) fail("LEGACY_MODEL_RULE_MISMATCH", `${context}.groups[${groupIndex}] contains evidence introduced after ${puzzle.categoryModelId}`);
    if (!equal(group.matchingRuleEvidence, fresh)) fail("MATCHING_RULE_EVIDENCE_MISMATCH", `${context}.groups[${groupIndex}] differs from a fresh full-universe solve`);
    if (!fresh.some(({ signature }) => signature === group.predicateSignature)) fail("INTENDED_PREDICATE_NOT_MATCHING", `${context}.groups[${groupIndex}]`);
  }
  if (!verifyCompletePartition) return { partitionSignature: null, solutionCount: null, validQuartetCount: inducedByMembers.size };
  const solved = solveBoard(cardIds, canonical.universe, { maxPartitions: 2, retainPartitions: 2 });
  if (solved.solutionCount !== 1 || !solved.countComplete) fail("NON_UNIQUE_FULL_PARTITION", `${context} has ${solved.solutionCount}${solved.countComplete ? "" : "+"} full partitions`);
  const partitionSignature = solved.partitions[0].map(({ memberSignature }) => memberSignature).sort().join("|");
  if (puzzle.solver?.solutionCount !== 1 || puzzle.solver?.countComplete !== true || puzzle.solver?.partitionSignature !== partitionSignature) fail("SOLVER_PROOF_MISMATCH", context);
  return { partitionSignature, solutionCount: solved.solutionCount, validQuartetCount: solved.validQuartetCount };
}
