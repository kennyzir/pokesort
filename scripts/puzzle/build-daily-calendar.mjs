import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { loadCategoryModel } from "./category-model.mjs";
import { evaluateCandidateBoard, GENERATOR_VERSION } from "./generator.mjs";
import { SeededRandom } from "./prng.mjs";
import { buildRuleUniverse, canonicalMemberSignature } from "./rule-universe.mjs";
import { canonicalJson, sha256 } from "./stable.mjs";
import { assessBoardQuality, DAILY_BOARD_QUALITY_POLICY, summarizeQuality, targetDifficultyBand } from "./board-quality-policy.mjs";

export const CALENDAR_SCHEMA_VERSION = 1;
export const CALENDAR_GENERATOR_VERSION = "qb3-calendar-v1";
export const DEFAULT_START_DATE = "2026-07-25";
export const DEFAULT_DAY_COUNT = 365;
export const REQUIRED_PREDICATE_COOLDOWN_DAYS = 14;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultOutputDirectory = resolve(moduleDirectory, "../../data/puzzles/daily");

function choose4Count(count) {
  return count < 4 ? 0 : (count * (count - 1) * (count - 2) * (count - 3)) / 24;
}

function parseUtcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid UTC date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid UTC date: ${value}`);
  return date;
}

function addUtcDays(value, days) {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sampledRuleSets(values, rng, maximum) {
  const output = [];
  const seen = new Set();
  const totalCombinationCount = choose4Count(values.length);
  const limit = Math.min(maximum, totalCombinationCount);
  // Sampling is deterministic and explicitly bounded. Materializing C(100,4)
  // arrays per date would make failure behavior depend on available memory.
  for (let attempt = 0; output.length < limit && attempt < limit * 20; attempt += 1) {
    const selected = rng.sample(values, 4).sort((left, right) => left.signature.localeCompare(right.signature));
    const signature = selected.map(({ signature: value }) => value).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(selected);
  }
  if (output.length !== limit) throw new Error(`RULE_SET_SAMPLING_EXHAUSTED: expected ${limit}, received ${output.length}`);
  return output;
}

function materializeDailyManifest(date, puzzle, calendarAudit, quality) {
  const base = {
    calendarSchemaVersion: CALENDAR_SCHEMA_VERSION,
    puzzleSchemaVersion: puzzle.schemaVersion,
    calendarGeneratorVersion: CALENDAR_GENERATOR_VERSION,
    generatorVersion: puzzle.generatorVersion,
    factsSchemaVersion: puzzle.factsSchemaVersion,
    datasetId: puzzle.datasetId,
    categoryModelId: puzzle.categoryModelId,
    date,
    publishAtUtc: `${date}T00:00:00.000Z`,
    publicationPolicy: "stored manifests become public only when date <= current UTC date; storage does not imply publication or indexing",
    boardContentHash: puzzle.contentHash,
    boardSignature: puzzle.boardSignature,
    cards: puzzle.cards,
    groups: puzzle.groups,
    solver: puzzle.solver,
    difficulty: puzzle.difficulty,
    quality,
    generationAudit: {
      ...puzzle.generationAudit,
      calendar: calendarAudit,
    },
  };
  const contentHash = sha256(base);
  return {
    ...base,
    puzzleId: `daily-${date}-${contentHash.slice(0, 16)}`,
    contentHash,
  };
}

function manifestBytes(value) {
  return `${canonicalJson(value, 2)}\n`;
}

async function writeImmutable(path, bytes) {
  let existing;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing !== undefined) {
    if (existing !== bytes) throw new Error(`IMMUTABLE_MANIFEST_MISMATCH: ${path}`);
    return "unchanged";
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes, "utf8");
  return "created";
}

function candidatePredicateSet(puzzle) {
  return [...new Set(puzzle.groups.map(({ predicateSignature }) => predicateSignature))].sort();
}

function drawQuartet(rule, rng, usedSpecies, usedMemberGroups) {
  const available = rule.memberIds.filter((id) => !usedSpecies.has(id));
  if (available.length < 4) return null;
  // Large broad predicates can have millions of quartets; sampling lazily avoids
  // materializing an unbounded combinatorial pool. The bounded deterministic fallback
  // below finds a remaining quartet when repeated random samples collide.
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const memberIds = rng.sample(available, 4).sort((left, right) => left - right);
    if (!usedMemberGroups.has(canonicalMemberSignature(memberIds))) return memberIds;
  }
  for (let a = 0; a < available.length - 3; a += 1) {
    for (let b = a + 1; b < available.length - 2; b += 1) {
      for (let c = b + 1; c < available.length - 1; c += 1) {
        for (let d = c + 1; d < available.length; d += 1) {
          const memberIds = [available[a], available[b], available[c], available[d]];
          if (!usedMemberGroups.has(canonicalMemberSignature(memberIds))) return memberIds;
        }
      }
    }
  }
  return null;
}

function hasAvailableQuartet(rule, forbiddenSpecies, usedMemberGroups) {
  const available = rule.memberIds.filter((id) => !forbiddenSpecies.has(id));
  if (available.length < 4) return false;
  if (choose4Count(available.length) > usedMemberGroups.size) return true;
  for (let a = 0; a < available.length - 3; a += 1) {
    for (let b = a + 1; b < available.length - 2; b += 1) {
      for (let c = b + 1; c < available.length - 1; c += 1) {
        for (let d = c + 1; d < available.length; d += 1) {
          if (!usedMemberGroups.has(canonicalMemberSignature([available[a], available[b], available[c], available[d]]))) return true;
        }
      }
    }
  }
  return false;
}

function blockedQuartetCount(rule, memberGroupSignatures) {
  let count = 0;
  for (const signature of memberGroupSignatures) {
    const memberIds = signature.split("-").map(Number);
    if (memberIds.length === 4 && memberIds.every((id) => rule.memberIdSet.has(id))) count += 1;
  }
  return count;
}

function buildRemainingCapacity(ruleInstances, usedMemberGroups) {
  return new Map(ruleInstances.map((rule) => [
    rule.signature,
    Math.max(0, choose4Count(rule.memberIds.length) - blockedQuartetCount(rule, usedMemberGroups)),
  ]));
}

function generateForPredicates({ date, rules, model, universe, previousSpecies, usedMemberGroups, maxAttempts, calendarSeed, qualityPolicy, expectedDifficultyBand }) {
  const expectedSignatures = rules.map(({ signature }) => signature).sort();
  const counters = { attempted: 0, constructionRejected: 0, ambiguous: 0, unsolved: 0, predicateMismatch: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    counters.attempted += 1;
    const candidateSeed = `${calendarSeed}|${date}|${expectedSignatures.join("|")}|attempt:${attempt}`;
    const rng = new SeededRandom(candidateSeed);
    const selected = [];
    const usedSpecies = new Set();
    let unavailable = false;
    for (const rule of rng.shuffle(rules)) {
      const quartet = drawQuartet(rule, rng, usedSpecies, usedMemberGroups);
      if (!quartet) {
        unavailable = true;
        break;
      }
      selected.push({ instance: rule, memberIds: quartet });
      quartet.forEach((id) => usedSpecies.add(id));
    }
    if (unavailable || usedSpecies.size !== 16 || [...usedSpecies].some((id) => previousSpecies.has(id))) {
      counters.constructionRejected += 1;
      continue;
    }
    const boardIds = rng.shuffle([...usedSpecies]);
    const evaluation = evaluateCandidateBoard({
      model,
      ruleUniverse: universe,
      boardIds,
      intendedGroups: selected,
      candidateSeed,
      contentSeed: null,
      attemptNumber: attempt,
    });
    if (evaluation.status !== "accepted") {
      if (evaluation.status === "ambiguous") counters.ambiguous += 1;
      else if (evaluation.status === "unsolved") counters.unsolved += 1;
      else counters.constructionRejected += 1;
      continue;
    }
    if (candidatePredicateSet(evaluation.puzzle).join("|") !== expectedSignatures.join("|")) {
      counters.predicateMismatch += 1;
      continue;
    }
    const quality = assessBoardQuality({
      puzzle: evaluation.puzzle,
      ruleUniverse: universe,
      policy: qualityPolicy,
      expectedDifficultyBand,
    });
    if (!quality.accepted) {
      for (const reason of quality.rejectionReasons) counters[reason] = (counters[reason] ?? 0) + 1;
      continue;
    }
    return { puzzle: evaluation.puzzle, quality, counters };
  }
  return { puzzle: null, counters };
}

function auditCapacity(ruleInstances, dayCount, cooldownDays, remainingCapacity) {
  const maximumOccurrencesPerPredicate = Math.ceil(dayCount / (cooldownDays + 1));
  const totalSlots = ruleInstances.reduce(
    (total, rule) => total + Math.min(remainingCapacity.get(rule.signature) ?? 0, maximumOccurrencesPerPredicate),
    0,
  );
  return {
    predicateCount: ruleInstances.length,
    maximumOccurrencesPerPredicate,
    availableUniqueGroupSlotsAtCooldown: totalSlots,
    requiredGroupSlots: dayCount * 4,
    capacityNecessaryConditionMet: totalSlots >= dayCount * 4,
  };
}

export async function buildDailyCalendar({
  outputDirectory = defaultOutputDirectory,
  startDate = DEFAULT_START_DATE,
  dayCount = DEFAULT_DAY_COUNT,
  predicateCooldownDays = REQUIRED_PREDICATE_COOLDOWN_DAYS,
  attemptsPerRuleSet = 2_000,
  maximumRuleSetsPerDate = 2_000,
  preferredBandSearchRuleSets = 100,
  calendarSeed = process.env.POKESORT_DAILY_SEED,
  qualityPolicy = DAILY_BOARD_QUALITY_POLICY,
  historyManifests = [],
  excludedBoardSignatures = [],
  excludedExactGroupSignatures = [],
  excludedMemberGroupSignatures = [],
  write = true,
} = {}) {
  parseUtcDate(startDate);
  if (!Number.isSafeInteger(dayCount) || dayCount <= 0) throw new Error("dayCount must be a positive safe integer");
  if (!Number.isSafeInteger(maximumRuleSetsPerDate) || maximumRuleSetsPerDate <= 0) throw new Error("maximumRuleSetsPerDate must be a positive safe integer");
  if (!Number.isSafeInteger(preferredBandSearchRuleSets) || preferredBandSearchRuleSets <= 0 || preferredBandSearchRuleSets > maximumRuleSetsPerDate) throw new Error("preferredBandSearchRuleSets must be between 1 and maximumRuleSetsPerDate");
  if (typeof calendarSeed !== "string" || calendarSeed.length < 32) throw new Error("POKESORT_DAILY_SEED must be supplied privately and contain at least 32 characters");
  const started = performance.now();
  const model = await loadCategoryModel();
  const universe = buildRuleUniverse(model);
  const manifests = [];
  const history = [...historyManifests].sort((left, right) => left.date.localeCompare(right.date));
  // External product surfaces (currently the tracked Infinite pool) can reserve
  // signatures without affecting Daily's history-based cooldown schedule.
  const usedBoards = new Set([...excludedBoardSignatures, ...history.map(({ boardSignature }) => boardSignature)]);
  const usedExactGroups = new Set([...excludedExactGroupSignatures, ...history.flatMap(({ groups }) => groups.map(({ signature }) => signature))]);
  const usedMemberGroups = new Set([...excludedMemberGroupSignatures, ...history.flatMap(({ groups }) => groups.map(({ memberSignature }) => memberSignature))]);
  const remainingCapacity = buildRemainingCapacity(universe, usedMemberGroups);
  // Low-capacity predicates remain useful, but they must be rationed across the
  // whole requested range. Reciprocal Infinite exclusions leave only 57 rules
  // with 25+ annual slots, so consuming narrow predicates uniformly at random
  // makes the final cooldown window impossible even though aggregate capacity
  // is sufficient.
  const eligibleRules = universe.filter((rule) => (remainingCapacity.get(rule.signature) ?? 0) > 0);
  const capacityAudit = auditCapacity(eligibleRules, dayCount, predicateCooldownDays, remainingCapacity);
  if (!capacityAudit.capacityNecessaryConditionMet || eligibleRules.length < (predicateCooldownDays + 1) * 4) {
    throw new Error(`PREDICATE_COOLDOWN_CAPACITY_BLOCKED: ${JSON.stringify(capacityAudit)}`);
  }
  const recentPredicates = history.slice(-predicateCooldownDays).map(({ groups }) => groups.map(({ predicateSignature }) => predicateSignature));
  let previousSpecies = new Set(history.at(-1)?.cards.map(({ id }) => id) ?? []);
  const audit = {
    ruleSetCombinationsTried: 0,
    candidateAttempts: 0,
    constructionRejected: 0,
    ambiguous: 0,
    unsolved: 0,
    predicateMismatch: 0,
    qualityRejections: {},
    difficultyTargetMisses: 0,
  };

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const date = addUtcDays(startDate, dayIndex);
    const forbiddenPredicates = new Set(recentPredicates.flat());
    const availableRules = eligibleRules.filter((rule) => (
      !forbiddenPredicates.has(rule.signature)
      && (remainingCapacity.get(rule.signature) ?? 0) > 0
      && hasAvailableQuartet(rule, previousSpecies, usedMemberGroups)
    ));
    if (availableRules.length < 4) throw new Error(`CALENDAR_RULE_CAPACITY_EXHAUSTED: ${date}; availableRules=${availableRules.length}`);
    const remainingDays = dayCount - dayIndex;
    const sustainableThreshold = Math.ceil(remainingDays / (predicateCooldownDays + 1));
    const sustainableRules = availableRules.filter((rule) => (remainingCapacity.get(rule.signature) ?? 0) >= sustainableThreshold);
    const ruleSelectionPool = sustainableRules.length >= 4 ? sustainableRules : availableRules;
    const combinationRng = new SeededRandom(`${calendarSeed}|${date}|rule-sets`);
    const ruleSets = sampledRuleSets(ruleSelectionPool, combinationRng, maximumRuleSetsPerDate);
    const expectedDifficultyBand = targetDifficultyBand(history.length + dayIndex, qualityPolicy);
    let accepted;
    let fallback;
    let searchedRuleSets = 0;
    for (const rules of ruleSets) {
      searchedRuleSets += 1;
      audit.ruleSetCombinationsTried += 1;
      const result = generateForPredicates({
        date,
        rules,
        model,
        universe,
        previousSpecies,
        usedMemberGroups,
        maxAttempts: attemptsPerRuleSet,
        calendarSeed,
        qualityPolicy,
        expectedDifficultyBand,
      });
      for (const [key, count] of Object.entries(result.counters)) {
        if (["attempted", "constructionRejected", "ambiguous", "unsolved", "predicateMismatch"].includes(key)) audit[key === "attempted" ? "candidateAttempts" : key] += count;
        else audit.qualityRejections[key] = (audit.qualityRejections[key] ?? 0) + count;
      }
      if (!result.puzzle) continue;
      const puzzle = result.puzzle;
      if (usedBoards.has(puzzle.boardSignature)) continue;
      if (puzzle.groups.some(({ signature }) => usedExactGroups.has(signature))) continue;
      if (puzzle.groups.some(({ memberSignature }) => usedMemberGroups.has(memberSignature))) continue;
      const candidate = materializeDailyManifest(date, puzzle, {
        dayIndex,
        ruleSetAttempt: audit.ruleSetCombinationsTried,
        candidateAttempt: result.counters.attempted,
        predicateCooldownDays,
      }, result.quality);
      if (result.quality.difficultyBand === expectedDifficultyBand) {
        accepted = candidate;
        break;
      }
      fallback ??= candidate;
      // A preferred-band miss is allowed only after a bounded search. The
      // calendar-level distribution Gate remains authoritative; no threshold is
      // weakened and generation can never spin indefinitely on one date.
      if (searchedRuleSets >= preferredBandSearchRuleSets) {
        accepted = fallback;
        audit.difficultyTargetMisses += 1;
        break;
      }
    }
    accepted ??= fallback;
    if (!accepted) {
      throw new Error(`CALENDAR_DATE_EXHAUSTED: ${date}; availableRules=${availableRules.length}; audit=${JSON.stringify(audit)}`);
    }
    manifests.push(accepted);
    usedBoards.add(accepted.boardSignature);
    accepted.groups.forEach(({ signature, memberSignature }) => {
      usedExactGroups.add(signature);
      usedMemberGroups.add(memberSignature);
      const memberIds = memberSignature.split("-").map(Number);
      for (const rule of eligibleRules) {
        if (memberIds.every((id) => rule.memberIdSet.has(id))) {
          remainingCapacity.set(rule.signature, Math.max(0, (remainingCapacity.get(rule.signature) ?? 0) - 1));
        }
      }
    });
    previousSpecies = new Set(accepted.cards.map(({ id }) => id));
    recentPredicates.push(accepted.groups.map(({ predicateSignature }) => predicateSignature));
    if (recentPredicates.length > predicateCooldownDays) recentPredicates.shift();
  }

  const endDate = addUtcDays(startDate, dayCount - 1);
  const qualityReport = summarizeQuality(manifests.map(({ quality }) => quality), audit.qualityRejections, qualityPolicy);
  if (qualityReport.calibratedCoverage < qualityPolicy.calibratedCoverageMinimum || !qualityReport.difficultyDistributionPass) {
    throw new Error(`DAILY_QUALITY_DISTRIBUTION_BLOCKED: ${JSON.stringify(qualityReport)}`);
  }
  const indexBase = {
    calendarSchemaVersion: CALENDAR_SCHEMA_VERSION,
    calendarGeneratorVersion: CALENDAR_GENERATOR_VERSION,
    generatorVersion: GENERATOR_VERSION,
    factsSchemaVersion: model.facts.schemaVersion,
    datasetId: model.facts.datasetId,
    categoryModelId: model.rules.modelId,
    qualityPolicy,
    range: { startDate, endDate, dayCount },
    publicationPolicy: {
      timezone: "UTC",
      publishAt: "00:00:00Z on each manifest date",
      futureStorageIsPublication: false,
      indexing: "route/build layers must exclude dates after the current UTC date",
    },
    cooldownPolicy: {
      requiredPredicateCooldownDays: REQUIRED_PREDICATE_COOLDOWN_DAYS,
      achievedPredicateCooldownDays: predicateCooldownDays,
      consecutiveSpeciesRepeatAllowed: false,
      exactGroupRepeatAllowed: false,
      memberGroupRepeatAllowed: false,
    },
    capacityAudit,
    generationAudit: audit,
    qualityReport,
    entries: manifests.map(({ date, puzzleId, contentHash, boardContentHash, boardSignature, publishAtUtc }) => ({
      date, puzzleId, contentHash, boardContentHash, boardSignature, publishAtUtc, file: `${date}.json`,
    })),
  };
  const index = { ...indexBase, contentHash: sha256(indexBase) };
  const output = [...manifests.map((manifest) => ({ path: resolve(outputDirectory, `${manifest.date}.json`), bytes: manifestBytes(manifest) })), {
    path: resolve(outputDirectory, "index.json"), bytes: manifestBytes(index),
  }];
  const writes = { created: 0, unchanged: 0 };
  if (write) {
    for (const file of output) writes[await writeImmutable(file.path, file.bytes)] += 1;
  }
  return {
    manifests,
    index,
    output,
    writes,
    timing: { milliseconds: Number((performance.now() - started).toFixed(2)) },
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output-dir") options.outputDirectory = resolve(argv[++index]);
    else if (value === "--start-date") options.startDate = argv[++index];
    else if (value === "--days") options.dayCount = Number(argv[++index]);
    else if (value === "--attempts-per-rule-set") options.attemptsPerRuleSet = Number(argv[++index]);
    else if (value === "--max-rule-sets-per-date") options.maximumRuleSetsPerDate = Number(argv[++index]);
    else if (value === "--preferred-band-search-rule-sets") options.preferredBandSearchRuleSets = Number(argv[++index]);
    else if (value === "--no-write") options.write = false;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildDailyCalendar(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify({
    range: result.index.range,
    cooldownPolicy: result.index.cooldownPolicy,
    capacityAudit: result.index.capacityAudit,
    generationAudit: result.index.generationAudit,
    writes: result.writes,
    timing: result.timing,
  }, null, 2));
}
