import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessBoardQuality, DAILY_BOARD_QUALITY_POLICY, difficultyBand } from "./board-quality-policy.mjs";
import { loadCategoryModel } from "./category-model.mjs";
import { buildRuleUniverse } from "./rule-universe.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? null;
  return {
    minimum: sorted[0] ?? null,
    p25: percentile(0.25),
    median: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    maximum: sorted.at(-1) ?? null,
  };
}

export async function reportDailyQuality({ calendarDirectory = defaultDirectory } = {}) {
  const model = await loadCategoryModel();
  const universe = buildRuleUniverse(model);
  const ruleBySignature = new Map(universe.map((rule) => [rule.signature, rule]));
  const names = (await readdir(calendarDirectory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const manifests = await Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(calendarDirectory, name), "utf8"))));
  const assessments = manifests.map((manifest) => assessBoardQuality({ puzzle: manifest, ruleUniverse: universe }));
  const speciesExposure = new Map();
  const predicateExposure = new Map();
  const ruleFamilyCounts = new Map();
  const boardSignatures = new Set();
  const memberSignatures = new Set();
  const exactSignatures = new Set();
  let consecutiveSpeciesRepeats = 0;
  let priorSpecies = new Set();
  for (const manifest of manifests) {
    const species = new Set(manifest.cards.map(({ id }) => id));
    if ([...species].some((id) => priorSpecies.has(id))) consecutiveSpeciesRepeats += 1;
    priorSpecies = species;
    species.forEach((id) => speciesExposure.set(id, (speciesExposure.get(id) ?? 0) + 1));
    boardSignatures.add(manifest.boardSignature);
    for (const group of manifest.groups) {
      memberSignatures.add(group.memberSignature);
      exactSignatures.add(group.signature);
      predicateExposure.set(group.predicateSignature, (predicateExposure.get(group.predicateSignature) ?? 0) + 1);
      const family = ruleBySignature.get(group.predicateSignature)?.ruleId ?? "unknown";
      ruleFamilyCounts.set(family, (ruleFamilyCounts.get(family) ?? 0) + 1);
    }
  }
  const bands = { easy: 0, medium: 0, hard: 0, extreme: 0 };
  assessments.forEach(({ validQuartetCount }) => { bands[difficultyBand(validQuartetCount)] += 1; });
  const speciesValues = [...speciesExposure.values()];
  const predicateValues = [...predicateExposure.values()];
  return {
    reportSchemaVersion: 1,
    policyCalibrationTarget: DAILY_BOARD_QUALITY_POLICY,
    boardCount: manifests.length,
    validQuartetCount: distribution(assessments.map(({ validQuartetCount }) => validQuartetCount)),
    boardsWithinTargetValidQuartetRange: assessments.filter(({ validQuartetCount }) => (
      validQuartetCount >= DAILY_BOARD_QUALITY_POLICY.validQuartetCount.minimum
      && validQuartetCount <= DAILY_BOARD_QUALITY_POLICY.validQuartetCount.maximum
    )).length,
    overlapRuleCount: distribution(manifests.map(({ solver }) => solver.overlapRuleCount)),
    threeCardUnintendedCount: distribution(assessments.map(({ threeCardUnintendedCount }) => threeCardUnintendedCount)),
    boardsWithinThreeCardCap: assessments.filter(({ threeCardUnintendedCount }) => (
      threeCardUnintendedCount <= DAILY_BOARD_QUALITY_POLICY.threeCardUnintendedCount.maximum
    )).length,
    difficultyBands: bands,
    uniqueness: {
      distinctBoards: boardSignatures.size,
      distinctMemberGroups: memberSignatures.size,
      distinctExactGroups: exactSignatures.size,
    },
    ruleReuse: {
      distinctPredicates: predicateExposure.size,
      occurrencesPerPredicate: distribution(predicateValues),
      intendedGroupsByFamily: Object.fromEntries([...ruleFamilyCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    },
    speciesReuse: {
      availableSpecies: model.facts.pokemon.length,
      coveredSpecies: speciesExposure.size,
      occurrencesPerCoveredSpecies: distribution(speciesValues),
      consecutiveDayBoardsWithAnyRepeat: consecutiveSpeciesRepeats,
    },
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--calendar-dir") options.calendarDirectory = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await reportDailyQuality(parseArguments(process.argv.slice(2))), null, 2));
}
