import assert from "node:assert/strict";
import { loadCategoryModel, enumerateQualifyingIds, enumerateRuleInstances } from "./category-model.mjs";

const model = await loadCategoryModel();
const { facts, rules } = model;
const legacyModel = await loadCategoryModel({ rulesUrl: new URL("../../data/pokemon/category-rules.v1.json", import.meta.url) });

assert.equal(facts.schemaVersion, 1);
assert.equal(rules.modelId, "pokesort-source-backed-categories-v2");
assert.deepEqual(rules.legacyCompatibleModelIds, ["pokesort-source-backed-categories-v1"]);
assert.deepEqual(rules.legacyCompatibility, { "pokesort-source-backed-categories-v1": { excludedRuleIds: ["monotype"] } });
assert.equal(legacyModel.rules.modelId, "pokesort-source-backed-categories-v1");
assert.equal(legacyModel.rules.rules.some(({ id }) => id === "monotype"), false);
assert.match(facts.datasetId, /^pokeapi-national-species-[0-9a-f]{12}$/);
assert.equal(facts.source.provider, "PokéAPI");
assert.match(facts.source.commit, /^[0-9a-f]{40}$/);
assert.match(facts.source.commitTimestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(facts.source.files.length, 7);
assert.ok(facts.source.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.url.includes(facts.source.commit)));
assert.deepEqual(facts.scope.includedGenerations, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.equal(facts.pokemon.length, 1025);
assert.deepEqual(facts.pokemon.map(({ id }) => id), Array.from({ length: 1025 }, (_, index) => index + 1));

const requiredProvenanceRefs = new Set(rules.provenance.requiredFactProvenanceRefs);
for (const pokemon of facts.pokemon) {
  assert.equal(typeof pokemon.name, "string");
  assert.ok(pokemon.name.length > 0);
  assert.ok(pokemon.generation >= 1 && pokemon.generation <= 9);
  assert.ok(facts.enumerations.colors.includes(pokemon.color));
  assert.ok(pokemon.types.length === 1 || pokemon.types.length === 2);
  assert.equal(new Set(pokemon.types).size, pokemon.types.length);
  assert.ok(["single", "base", "middle", "final"].includes(pokemon.evolution.stage));
  assert.ok(Number.isInteger(pokemon.evolution.depth) && pokemon.evolution.depth >= 0);
  assert.equal(pokemon.evolution.evolvesFromSpeciesId === null, pokemon.evolution.depth === 0);
  assert.equal(typeof pokemon.flags.isBaby, "boolean");
  assert.equal(typeof pokemon.flags.isLegendary, "boolean");
  assert.equal(typeof pokemon.flags.isMythical, "boolean");
  assert.deepEqual(new Set(pokemon.provenanceRefs), requiredProvenanceRefs);
}

for (const [enumerationName, values] of Object.entries(facts.enumerations)) {
  assert.ok(Array.isArray(values) && values.length > 0, `${enumerationName} must be non-empty`);
}
for (const rule of rules.rules) {
  assert.ok(facts.fieldProvenance[rule.sourceFieldProvenance], `${rule.id} has unknown provenance`);
  for (const parameter of rule.parameters) {
    if (parameter.valuesFrom) {
      const enumerationName = parameter.valuesFrom.split(".").at(-1);
      assert.deepEqual(parameter.values, facts.enumerations[enumerationName], `${rule.id}.${parameter.name} is stale`);
    }
  }
}

assert.deepEqual(enumerateQualifyingIds(model, "type", { type: "grass" }).slice(0, 3), [1, 2, 3]);
assert.deepEqual(enumerateQualifyingIds(model, "dual_type", { typeA: "grass", typeB: "poison" }).slice(0, 3), [1, 2, 3]);
assert.equal(enumerateQualifyingIds(model, "generation", { generation: 9 }).length, 120);
assert.ok(enumerateQualifyingIds(model, "color", { color: "yellow" }).includes(25));
assert.ok(enumerateQualifyingIds(model, "evolution_stage", { stage: "base" }).includes(1));
assert.ok(enumerateQualifyingIds(model, "evolution_stage", { stage: "middle" }).includes(2));
assert.ok(enumerateQualifyingIds(model, "evolution_stage", { stage: "final" }).includes(3));
assert.ok(enumerateQualifyingIds(model, "evolution_stage", { stage: "single" }).includes(128));
assert.ok(enumerateQualifyingIds(model, "baby", { value: true }).includes(172));
assert.ok(enumerateQualifyingIds(model, "legendary", { value: true }).includes(144));
assert.ok(enumerateQualifyingIds(model, "mythical", { value: true }).includes(151));
assert.throws(() => enumerateQualifyingIds(model, "dual_type", { typeA: "water", typeB: "water" }), /does not allow|expects|distinct/i);

const instanceCounts = Object.fromEntries(rules.rules.map((rule) => [rule.id, enumerateRuleInstances(model, rule.id).length]));
for (const [ruleId, count] of Object.entries(instanceCounts)) assert.ok(count > 0, `${ruleId} must enumerate at least one four-member category`);

const counts = {
  species: facts.pokemon.length,
  generations: Object.fromEntries(facts.enumerations.generations.map((generation) => [generation, enumerateQualifyingIds(model, "generation", { generation }).length])),
  flags: {
    baby: enumerateQualifyingIds(model, "baby", { value: true }).length,
    legendary: enumerateQualifyingIds(model, "legendary", { value: true }).length,
    mythical: enumerateQualifyingIds(model, "mythical", { value: true }).length,
  },
  qualifyingRuleInstances: instanceCounts,
};
console.log(JSON.stringify(counts, null, 2));
console.log("Pokémon facts and category rules passed QB1 validation.");
