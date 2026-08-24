import { enumerateRuleInstances } from "./category-model.mjs";
import { canonicalJson } from "./stable.mjs";

const RULE_COPY = {
  type: {
    hint: "Focus on the types shown for each species' default form.",
    explanation: "All four are {label} in the versioned PokéAPI default-form typing snapshot.",
  },
  dual_type: {
    hint: "Look for one exact pair of default-form types.",
    explanation: "All four have the exact default-form type pair {label} in the versioned PokéAPI snapshot.",
  },
  monotype: {
    hint: "Look for a species whose default form has exactly one type, not merely one shared type.",
    explanation: "All four have {label} in the versioned PokéAPI default-form typing snapshot.",
  },
  generation: {
    hint: "Compare the generation in which each species was introduced.",
    explanation: "All four species were introduced in {label}, according to the versioned PokéAPI species data.",
  },
  color: {
    hint: "Compare the Pokédex color classification, not the sprite's every visible color.",
    explanation: "All four share the {label} classification in the versioned PokéAPI species data.",
  },
  evolution_stage: {
    hint: "Compare each species' position in its evolution-chain topology.",
    explanation: "All four share {label} under the declared parent/child topology rule.",
  },
  baby: {
    hint: "Look for the baby-species flag in the versioned data snapshot.",
    explanation: "All four are marked as Baby Pokémon in the versioned PokéAPI species data.",
  },
  legendary: {
    hint: "Look for the legendary-species flag in the versioned data snapshot.",
    explanation: "All four are marked as Legendary Pokémon in the versioned PokéAPI species data.",
  },
  mythical: {
    hint: "Look for the mythical-species flag in the versioned data snapshot.",
    explanation: "All four are marked as Mythical Pokémon in the versioned PokéAPI species data.",
  },
};

function displayValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function canonicalParameters(ruleId, parameters) {
  const normalized = { ...parameters };
  if (ruleId === "dual_type") {
    const [typeA, typeB] = [parameters.typeA, parameters.typeB].sort();
    normalized.typeA = typeA;
    normalized.typeB = typeB;
  }
  return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function render(template, parameters, extras = {}) {
  return template.replaceAll(/\{([^}]+)\}/g, (_, key) => displayValue(extras[key] ?? parameters[key]));
}

function sourceFiles(fieldProvenance) {
  const files = fieldProvenance.sourceFiles ?? [fieldProvenance.sourceFile];
  return files.filter(Boolean);
}

export function canonicalRuleInstanceSignature(ruleId, parameters) {
  return `${ruleId}:${canonicalJson(canonicalParameters(ruleId, parameters))}`;
}

export function canonicalMemberSignature(memberIds) {
  return [...memberIds].sort((left, right) => left - right).join("-");
}

export function canonicalGroupSignature(ruleSignature, memberIds) {
  return `${ruleSignature}#${canonicalMemberSignature(memberIds)}`;
}

export function canonicalBoardSignature(cardIds) {
  return canonicalMemberSignature(cardIds);
}

export function buildRuleUniverse(model) {
  const instances = [];
  for (const rule of model.rules.rules) {
    const copy = RULE_COPY[rule.id];
    if (!copy) throw new Error(`Missing declared human-facing copy for rule ${rule.id}`);
    const provenanceField = model.facts.fieldProvenance[rule.sourceFieldProvenance];
    if (!provenanceField) throw new Error(`Rule ${rule.id} references unknown provenance ${rule.sourceFieldProvenance}`);
    for (const enumerated of enumerateRuleInstances(model, rule.id)) {
      const parameters = canonicalParameters(rule.id, enumerated.parameters);
      const label = render(rule.labelTemplate, parameters);
      const signature = canonicalRuleInstanceSignature(rule.id, parameters);
      instances.push({
        signature,
        ruleId: rule.id,
        parameters,
        memberIds: [...enumerated.ids].sort((left, right) => left - right),
        memberIdSet: new Set(enumerated.ids),
        label,
        hint: render(copy.hint, parameters, { label }),
        explanation: render(copy.explanation, parameters, { label }),
        provenance: {
          datasetId: model.facts.datasetId,
          provider: model.facts.source.provider,
          sourceCommit: model.facts.source.commit,
          factField: rule.sourceFieldProvenance,
          sourceFiles: sourceFiles(provenanceField),
          boundary: model.rules.semantics,
        },
      });
    }
  }
  return instances.sort((left, right) => left.signature.localeCompare(right.signature));
}

export function compareRuleSpecificity(left, right) {
  return left.memberIds.length - right.memberIds.length || left.signature.localeCompare(right.signature);
}

export function publicRuleEvidence(instance) {
  return {
    signature: instance.signature,
    ruleId: instance.ruleId,
    parameters: instance.parameters,
    qualifyingSpeciesCount: instance.memberIds.length,
    label: instance.label,
    hint: instance.hint,
    explanation: instance.explanation,
    provenance: instance.provenance,
  };
}
