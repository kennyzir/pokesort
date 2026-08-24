import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ALLOWED_FAMILIES = new Set(["type", "exact dual type", "generation", "color", "evolution stage", "baby", "legendary", "mythical"]);

const FAMILY_LABELS = { type: "type", dual_type: "exact dual type", generation: "generation", color: "color", evolution_stage: "evolution stage", baby: "baby", legendary: "legendary", mythical: "mythical" };

export async function loadPublicCapabilities({ reportPath = process.env.POKESORT_DIVERSITY_REPORT, validatedPoolSize, validatedNoRepeatRounds, validatedDiversity } = {}) {
  const fallback = {
    source: "validated-production-gate",
    poolSize: validatedPoolSize,
    noRepeatRounds: Math.min(validatedNoRepeatRounds, validatedPoolSize),
    solverVerified: true,
    advertisedFamilies: [],
  };
  let validatorMeasured = null;
  if (validatedDiversity?.advertisedFamilyCoverage > 0) {
    const measured = validatedDiversity.coveredAdvertisedFamilies?.map((family) => FAMILY_LABELS[family]);
    if (!measured?.length || measured.some((family) => !family) || measured.length !== validatedDiversity.advertisedFamilyCoverage || new Set(measured).size !== measured.length) throw new Error("Validated R3 diversity measurements contain an unsupported or inconsistent family summary");
    validatorMeasured = { ...fallback, source: "validated-r3-diversity-gate", advertisedFamilies: measured };
  }
  if (!reportPath && validatorMeasured) return validatorMeasured;
  if (!reportPath) return fallback;
  if (!validatorMeasured) throw new Error("R3 capability report requires a fresh validator diversity summary");
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  const capability = report.publicCapabilities;
  if (!capability || report.gate !== "PASS") throw new Error("R3 capability report must be PASS and contain publicCapabilities");
  if (capability.poolSize !== validatedPoolSize || !Number.isSafeInteger(capability.noRepeatRounds) || capability.noRepeatRounds < 1 || capability.noRepeatRounds > validatedPoolSize) throw new Error("R3 capability report pool measurements do not match validated production data");
  if (!Array.isArray(capability.advertisedFamilies) || capability.advertisedFamilies.some((family) => !ALLOWED_FAMILIES.has(family)) || new Set(capability.advertisedFamilies).size !== capability.advertisedFamilies.length) throw new Error("R3 capability report contains unsupported or duplicate advertised families");
  const expected = { poolSize: validatorMeasured.poolSize, noRepeatRounds: validatorMeasured.noRepeatRounds, advertisedFamilies: validatorMeasured.advertisedFamilies };
  if (JSON.stringify(capability) !== JSON.stringify(expected)) throw new Error("R3 capability report does not match the fresh validator summary");
  return { ...validatorMeasured, source: resolve(reportPath) };
}

export function infiniteCapabilityCopy(capability) {
  const families = capability.advertisedFamilies.length ? ` Measured coverage includes ${capability.advertisedFamilies.join(", ")}.` : " Category-family coverage is not advertised until the diversity report passes.";
  return {
    how: `Finish or reveal a board, then choose <strong>New Infinite</strong> for another puzzle. The round number and progress stay in this browser. Infinite draws from a finite pool of ${capability.poolSize.toLocaleString("en")} source-backed boards checked by the complete uniqueness solver; it does not record a Daily win or change your streak.`,
    useful: `The validated sequence provides ${capability.noRepeatRounds.toLocaleString("en")} no-repeat rounds before cycling.${families}`,
  };
}
