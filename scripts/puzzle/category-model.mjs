import { readFile } from "node:fs/promises";

const defaultFactsUrl = new URL("../../data/pokemon/pokemon-facts.v1.json", import.meta.url);
const defaultRulesUrl = new URL("../../data/pokemon/category-rules.v2.json", import.meta.url);

export async function loadCategoryModel({ factsUrl = defaultFactsUrl, rulesUrl = defaultRulesUrl } = {}) {
  const [facts, rules] = await Promise.all([
    readFile(factsUrl, "utf8").then(JSON.parse),
    readFile(rulesUrl, "utf8").then(JSON.parse),
  ]);
  if (rules.factsSchemaVersion !== facts.schemaVersion) throw new Error("Category rules and facts schema versions do not match");
  return { facts, rules };
}

export function categoryModelAccepts(rules, storedModelId) {
  return storedModelId === rules.modelId || (rules.legacyCompatibleModelIds ?? []).includes(storedModelId);
}

export function categoryModelExcludedRuleIds(rules, storedModelId) {
  return new Set(storedModelId === rules.modelId ? [] : (rules.legacyCompatibility?.[storedModelId]?.excludedRuleIds ?? []));
}

function valueAtPath(record, path) {
  return path.split(".").reduce((value, key) => value?.[key], record);
}

function matches(record, predicate, parameters) {
  const actual = valueAtPath(record, predicate.path);
  if (predicate.operator === "includes") return Array.isArray(actual) && actual.includes(parameters[predicate.parameter]);
  if (predicate.operator === "equals") return actual === parameters[predicate.parameter];
  if (predicate.operator === "setEquals") {
    const expected = predicate.parameters.map((parameter) => parameters[parameter]);
    return Array.isArray(actual) && expected.length === actual.length && new Set(expected).size === expected.length && expected.every((value) => actual.includes(value));
  }
  throw new Error(`Unsupported predicate operator: ${predicate.operator}`);
}

export function validateParameters(rule, parameters) {
  const supplied = Object.keys(parameters).sort();
  const expected = rule.parameters.map(({ name }) => name).sort();
  if (supplied.join("|") !== expected.join("|")) throw new Error(`${rule.id} expects parameters ${expected.join(", ")}`);
  for (const parameter of rule.parameters) {
    const value = parameters[parameter.name];
    if (!parameter.values.includes(value)) throw new Error(`${rule.id}.${parameter.name} does not allow ${JSON.stringify(value)}`);
  }
  for (const constraint of rule.constraints ?? []) {
    if (constraint.kind === "distinctParameters") {
      const values = constraint.parameters.map((parameter) => parameters[parameter]);
      if (new Set(values).size !== values.length) throw new Error(`${rule.id} requires distinct parameters: ${constraint.parameters.join(", ")}`);
    } else {
      throw new Error(`Unsupported rule constraint: ${constraint.kind}`);
    }
  }
}

export function enumerateQualifyingIds(model, ruleId, parameters) {
  const rule = model.rules.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error(`Unknown category rule: ${ruleId}`);
  validateParameters(rule, parameters);
  return model.facts.pokemon.filter((record) => matches(record, rule.predicate, parameters)).map(({ id }) => id);
}

export function enumerateRuleInstances(model, ruleId, { minimumMembers = 4 } = {}) {
  const rule = model.rules.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error(`Unknown category rule: ${ruleId}`);
  const combinations = [];
  const seenMemberSets = new Set();
  function visit(index, parameters) {
    if (index === rule.parameters.length) {
      let ids;
      try {
        ids = enumerateQualifyingIds(model, ruleId, parameters);
      } catch (error) {
        if (/requires distinct parameters/.test(error.message)) return;
        throw error;
      }
      const memberSetKey = ids.join(",");
      if (ids.length >= minimumMembers && !seenMemberSets.has(memberSetKey)) {
        combinations.push({ parameters: { ...parameters }, ids });
        seenMemberSets.add(memberSetKey);
      }
      return;
    }
    const parameter = rule.parameters[index];
    for (const value of parameter.values) visit(index + 1, { ...parameters, [parameter.name]: value });
  }
  visit(0, {});
  return combinations;
}
