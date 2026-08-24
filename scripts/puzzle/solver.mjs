import { canonicalMemberSignature, compareRuleSpecificity, publicRuleEvidence } from "./rule-universe.mjs";

function combinationsOfFour(values) {
  const combinations = [];
  for (let a = 0; a < values.length - 3; a += 1) {
    for (let b = a + 1; b < values.length - 2; b += 1) {
      for (let c = b + 1; c < values.length - 1; c += 1) {
        for (let d = c + 1; d < values.length; d += 1) combinations.push([values[a], values[b], values[c], values[d]]);
      }
    }
  }
  return combinations;
}
function maskForIndexes(indexes) {
  return indexes.reduce((mask, index) => mask | (1 << index), 0);
}

export function enumerateInducedQuartets(boardIds, ruleUniverse) {
  if (boardIds.length !== 16 || new Set(boardIds).size !== 16) throw new Error("Solver requires exactly 16 unique species IDs");
  const quartetsByMask = new Map();
  for (const instance of ruleUniverse) {
    const matchingIndexes = [];
    for (let index = 0; index < boardIds.length; index += 1) {
      if (instance.memberIdSet.has(boardIds[index])) matchingIndexes.push(index);
    }
    if (matchingIndexes.length < 4) continue;
    for (const indexes of combinationsOfFour(matchingIndexes)) {
      const mask = maskForIndexes(indexes);
      const existing = quartetsByMask.get(mask) ?? { mask, memberIds: indexes.map((index) => boardIds[index]), matchingRules: [] };
      existing.matchingRules.push(instance);
      quartetsByMask.set(mask, existing);
    }
  }
  return [...quartetsByMask.values()]
    .map((quartet) => ({ ...quartet, matchingRules: quartet.matchingRules.sort(compareRuleSpecificity) }))
    .sort((left, right) => left.mask - right.mask);
}

export function solveBoard(boardIds, ruleUniverse, { maxPartitions = Number.POSITIVE_INFINITY, retainPartitions = 8 } = {}) {
  if (!(maxPartitions > 0)) throw new RangeError("maxPartitions must be positive");
  const quartets = enumerateInducedQuartets(boardIds, ruleUniverse);
  const byCard = Array.from({ length: 16 }, () => []);
  quartets.forEach((quartet, quartetIndex) => {
    for (let cardIndex = 0; cardIndex < 16; cardIndex += 1) {
      if (quartet.mask & (1 << cardIndex)) byCard[cardIndex].push(quartetIndex);
    }
  });

  const fullMask = 0xffff;
  let partitionCount = 0;
  const retained = [];
  function search(coveredMask, selected) {
    if (partitionCount >= maxPartitions) return;
    if (coveredMask === fullMask) {
      partitionCount += 1;
      if (retained.length < retainPartitions) retained.push([...selected]);
      return;
    }
    let firstUncovered = 0;
    while (coveredMask & (1 << firstUncovered)) firstUncovered += 1;
    for (const quartetIndex of byCard[firstUncovered]) {
      const quartet = quartets[quartetIndex];
      if (quartet.mask & coveredMask) continue;
      selected.push(quartetIndex);
      search(coveredMask | quartet.mask, selected);
      selected.pop();
      if (partitionCount >= maxPartitions) return;
    }
  }
  search(0, []);

  const publicPartitions = retained.map((partition) =>
    partition
      .map((quartetIndex) => {
        const quartet = quartets[quartetIndex];
        return {
          memberIds: [...quartet.memberIds].sort((left, right) => left - right),
          memberSignature: canonicalMemberSignature(quartet.memberIds),
          matchingRules: quartet.matchingRules.map(publicRuleEvidence),
        };
      })
      .sort((left, right) => left.memberSignature.localeCompare(right.memberSignature)),
  );

  return {
    solutionCount: partitionCount,
    countComplete: partitionCount < maxPartitions,
    validQuartetCount: quartets.length,
    partitions: publicPartitions,
  };
}
