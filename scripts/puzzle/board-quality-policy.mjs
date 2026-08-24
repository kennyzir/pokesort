import { enumerateInducedQuartets } from "./solver.mjs";

export const DAILY_BOARD_QUALITY_POLICY = Object.freeze({
  schemaVersion: 1,
  policyId: "pokesort-daily-board-quality-v1",
  validQuartetCount: Object.freeze({ minimum: 12, maximum: 100 }),
  // Any two different four-card sets can overlap by at most three cards, so a
  // maximum-overlap <= 3 check is tautological. The calibrated metric is the
  // number of unintended canonical quartets that overlap an intended group by
  // exactly three cards. The legacy 365-board p75/p95 were 22/34; 30 rejects
  // the high-overlap tail without pretending that all overlap is invalid.
  threeCardUnintendedCount: Object.freeze({ maximum: 30 }),
  predicateCooldownDays: 14,
  consecutiveSpeciesRepeatAllowed: false,
  duplicateBoardAllowed: false,
  duplicateExactGroupAllowed: false,
  difficultyBands: Object.freeze({
    easy: Object.freeze({ minimum: 12, maximum: 35 }),
    medium: Object.freeze({ minimum: 36, maximum: 70 }),
    hard: Object.freeze({ minimum: 71, maximum: 100 }),
  }),
  difficultyTargetCycle: Object.freeze(["easy", "medium", "hard", "medium"]),
  difficultyDistributionMinimum: Object.freeze({ easy: 0.2, medium: 0.4, hard: 0.2 }),
  calibratedCoverageMinimum: 0.9,
});

const memberSignature = (ids) => [...ids].sort((left, right) => left - right).join("-");

export function difficultyBand(validQuartetCount, policy = DAILY_BOARD_QUALITY_POLICY) {
  return Object.entries(policy.difficultyBands).find(([, range]) => validQuartetCount >= range.minimum && validQuartetCount <= range.maximum)?.[0] ?? "extreme";
}

export function targetDifficultyBand(calendarOrdinal, policy = DAILY_BOARD_QUALITY_POLICY) {
  if (!Number.isSafeInteger(calendarOrdinal) || calendarOrdinal < 0) throw new RangeError("calendarOrdinal must be a non-negative safe integer");
  return policy.difficultyTargetCycle[calendarOrdinal % policy.difficultyTargetCycle.length];
}

export function assessBoardQuality({
  puzzle,
  ruleUniverse,
  policy = DAILY_BOARD_QUALITY_POLICY,
  expectedDifficultyBand = null,
  enforceExpectedDifficultyBand = false,
}) {
  const intended = new Set(puzzle.groups.map(({ memberIds }) => memberSignature(memberIds)));
  const quartets = enumerateInducedQuartets(puzzle.cards.map(({ id }) => id), ruleUniverse);
  const unintended = quartets.filter(({ memberIds }) => !intended.has(memberSignature(memberIds)));
  const intendedSets = puzzle.groups.map(({ memberIds }) => new Set(memberIds));
  const maximumUnintendedOverlap = unintended.reduce((maximum, quartet) => Math.max(
    maximum,
    ...intendedSets.map((group) => quartet.memberIds.filter((id) => group.has(id)).length),
  ), 0);
  const threeCardUnintendedCount = unintended.filter((quartet) => intendedSets.some(
    (group) => quartet.memberIds.filter((id) => group.has(id)).length === 3,
  )).length;
  const validQuartetCount = quartets.length;
  const ruleBySignature = new Map(ruleUniverse.map((rule) => [rule.signature, rule]));
  const families = puzzle.groups.map((group) => ruleBySignature.get(group.predicateSignature)?.ruleId ?? "unknown");
  const familyCounts = Object.fromEntries([...new Set(families)].sort()
    .map((family) => [family, families.filter((value) => value === family).length]));
  const band = difficultyBand(validQuartetCount, policy);
  const rejectionReasons = [];
  if (puzzle.solver.solutionCount !== 1 || puzzle.solver.countComplete !== true) rejectionReasons.push("not_unique_partition");
  if (validQuartetCount < policy.validQuartetCount.minimum) rejectionReasons.push("too_few_valid_quartets");
  if (validQuartetCount > policy.validQuartetCount.maximum) rejectionReasons.push("too_many_valid_quartets");
  if (threeCardUnintendedCount > policy.threeCardUnintendedCount.maximum) rejectionReasons.push("too_many_three_card_unintended_quartets");
  if (band === "extreme") rejectionReasons.push("uncontrolled_difficulty_extreme");
  if (enforceExpectedDifficultyBand && expectedDifficultyBand && band !== expectedDifficultyBand) rejectionReasons.push("difficulty_band_mismatch");
  return {
    policySchemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    validQuartetCount,
    unintendedValidQuartetCount: unintended.length,
    maximumUnintendedOverlap,
    threeCardUnintendedCount,
    ruleFamilyBreadth: Object.keys(familyCounts).length,
    ruleFamilyCounts: familyCounts,
    repeatedRuleFamilyCount: Object.values(familyCounts).filter((count) => count > 1).length,
    difficultyBand: band,
    expectedDifficultyBand,
    difficultyTargetMet: expectedDifficultyBand ? band === expectedDifficultyBand : null,
    validOverlapMemberSignatures: unintended.map(({ memberIds }) => memberSignature(memberIds)).sort(),
  };
}

export function summarizeQuality(assessments, rejections = {}, policy = DAILY_BOARD_QUALITY_POLICY) {
  const bands = { easy: 0, medium: 0, hard: 0, extreme: 0 };
  for (const item of assessments) bands[item.difficultyBand] += 1;
  const values = assessments.map(({ validQuartetCount }) => validQuartetCount).sort((a, b) => a - b);
  const percentile = (ratio) => values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? null;
  const calibratedCount = assessments.length - bands.extreme;
  const threeCardValues = assessments.map(({ threeCardUnintendedCount }) => threeCardUnintendedCount).sort((a, b) => a - b);
  const threeCardPercentile = (ratio) => threeCardValues[Math.min(threeCardValues.length - 1, Math.floor(threeCardValues.length * ratio))] ?? null;
  const distributionPass = Object.entries(policy.difficultyDistributionMinimum).every(([band, minimum]) => (
    assessments.length > 0 && bands[band] / assessments.length >= minimum
  ));
  return {
    policyId: policy.policyId,
    acceptedBoards: assessments.length,
    difficultyBands: bands,
    calibratedCoverage: assessments.length ? calibratedCount / assessments.length : 0,
    difficultyDistributionMinimum: policy.difficultyDistributionMinimum,
    difficultyDistributionPass: distributionPass,
    validQuartetDistribution: {
      minimum: values[0] ?? null,
      p25: percentile(0.25),
      median: percentile(0.5),
      p75: percentile(0.75),
      maximum: values.at(-1) ?? null,
    },
    maximumUnintendedOverlap: assessments.reduce((maximum, item) => Math.max(maximum, item.maximumUnintendedOverlap), 0),
    threeCardUnintendedDistribution: {
      minimum: threeCardValues[0] ?? null,
      p25: threeCardPercentile(0.25),
      median: threeCardPercentile(0.5),
      p75: threeCardPercentile(0.75),
      p95: threeCardPercentile(0.95),
      maximum: threeCardValues.at(-1) ?? null,
      acceptedMaximum: policy.threeCardUnintendedCount.maximum,
    },
    rejectionCounts: Object.fromEntries(Object.entries(rejections).sort(([left], [right]) => left.localeCompare(right))),
  };
}
