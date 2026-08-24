import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { infiniteCapabilityCopy, loadPublicCapabilities } from "./public-capabilities.mjs";

const fallback = await loadPublicCapabilities({ validatedPoolSize: 1000, validatedNoRepeatRounds: 1000 });
assert.deepEqual(fallback.advertisedFamilies, []);
assert.match(infiniteCapabilityCopy(fallback).useful, /not advertised until the diversity report passes/);
const gateMeasured = await loadPublicCapabilities({ validatedPoolSize: 1000, validatedNoRepeatRounds: 1000, validatedDiversity: { advertisedFamilyCoverage: 2, coveredAdvertisedFamilies: ["type", "dual_type"] } });
assert.deepEqual(gateMeasured.advertisedFamilies, ["type", "exact dual type"]);
const temporary = await mkdtemp(resolve(tmpdir(), "pokesort-capabilities-"));
try {
  const report = resolve(temporary, "report.json");
  await writeFile(report, JSON.stringify({ gate: "PASS", publicCapabilities: { poolSize: 1000, noRepeatRounds: 1000, advertisedFamilies: ["type", "generation"] } }));
  await assert.rejects(() => loadPublicCapabilities({ reportPath: report, validatedPoolSize: 1000, validatedNoRepeatRounds: 1000 }), /fresh validator/);
  const freshSummary = { advertisedFamilyCoverage: 2, coveredAdvertisedFamilies: ["type", "generation"] };
  const measured = await loadPublicCapabilities({ reportPath: report, validatedPoolSize: 1000, validatedNoRepeatRounds: 1000, validatedDiversity: freshSummary });
  assert.deepEqual(measured.advertisedFamilies, ["type", "generation"]);
  await writeFile(report, JSON.stringify({ gate: "PASS", publicCapabilities: { poolSize: 1000, noRepeatRounds: 1000, advertisedFamilies: ["unsupported"] } }));
  await assert.rejects(() => loadPublicCapabilities({ reportPath: report, validatedPoolSize: 1000, validatedNoRepeatRounds: 1000, validatedDiversity: freshSummary }), /unsupported/);
  await writeFile(report, JSON.stringify({ gate: "PASS", publicCapabilities: { poolSize: 1000, noRepeatRounds: 1000, advertisedFamilies: ["type", "generation"] } }));
  await assert.rejects(() => loadPublicCapabilities({ reportPath: report, validatedPoolSize: 1000, validatedNoRepeatRounds: 1000, validatedDiversity: { advertisedFamilyCoverage: 1, coveredAdvertisedFamilies: ["type"] } }), /fresh validator summary/);
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log("Public capability copy Gate passed for fail-closed fallback, fresh-validator derivation, and forged-report rejection.");
