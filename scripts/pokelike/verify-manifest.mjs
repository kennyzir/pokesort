import {
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_STATUSES,
  PUZZLE_EPOCH_DAY,
  SHA256_PATTERN,
  SUPPORTED_RELATIONS,
} from "./manifest-contract.mjs";
import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const TYPE_CHART = Object.freeze({
  normal: [], fire: ["grass", "ice", "bug", "steel"],
  water: ["fire", "ground", "rock"], electric: ["water", "flying"],
  grass: ["water", "ground", "rock"], ice: ["grass", "ground", "flying", "dragon"],
  fighting: ["normal", "ice", "rock", "dark", "steel"], poison: ["grass", "fairy"],
  ground: ["fire", "electric", "poison", "rock", "steel"],
  flying: ["grass", "fighting", "bug"], psychic: ["fighting", "poison"],
  bug: ["grass", "psychic", "dark"], rock: ["fire", "ice", "flying", "bug"],
  ghost: ["psychic", "ghost"], dragon: ["dragon"],
  dark: ["psychic", "ghost"], steel: ["ice", "rock", "fairy"],
  fairy: ["fighting", "dragon", "dark"],
});

export class ManifestValidationError extends Error {
  constructor(issues) {
    super(issues.map(({ code, path, message }) => `${code} ${path}: ${message}`).join("\n"));
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

function issue(issues, code, path, message) {
  issues.push({ code, path, message });
}

function rejectUnknownKeys(value, allowed, path, issues) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issue(issues, "UNKNOWN_PROPERTY", `${path}.${key}`, "is not allowed by manifest contract v1");
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, path, issues) {
  if (!isObject(value)) {
    issue(issues, "MISSING_OR_INVALID", path, "must be an object");
    return false;
  }
  return true;
}

function requireString(value, path, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issue(issues, "MISSING_OR_INVALID", path, "must be a non-empty string");
    return false;
  }
  return true;
}

function isIsoInstant(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isLocalDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function epochDay(localDate) {
  const [year, month, day] = localDate.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function localDateAt(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isIanaTimezone(value) {
  if (typeof value !== "string" || value === "" || value === "UTC") return value === "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value.includes("/");
  } catch {
    return false;
  }
}

function sameMembers(values, expected) {
  return values.length === expected.length
    && new Set(values).size === values.length
    && values.every((value) => expected.includes(value));
}

export function relationMatches(relation, left, right) {
  switch (relation) {
    case "color": return left.color === right.color;
    case "type": return left.types.some((type) => right.types.includes(type));
    case "gen_eq": return left.generation === right.generation;
    case "gen_gt": return left.generation > right.generation;
    case "gen_lt": return left.generation < right.generation;
    case "stage_eq": return left.stage === right.stage;
    case "stage_gt": return left.stage > right.stage;
    case "stage_lt": return left.stage < right.stage;
    case "se": return Boolean(TYPE_CHART[left.types[0]]?.includes(right.types[0]));
    default: return false;
  }
}

export function computeContentSha256(manifest) {
  const canonical = {
    localDate: manifest.localDate,
    timezone: manifest.timezone,
    day: manifest.day,
    puzzleNumber: manifest.puzzleNumber,
    candidates: [...(manifest.candidates ?? [])]
      .map(({ id, name, generation, stage, color, types }) => ({ id, name, generation, stage, color, types: [...(types ?? [])] }))
      .sort((left, right) => left.id - right.id),
    startOrder: [...(manifest.startOrder ?? [])],
    links: (manifest.links ?? []).map(({ relation, leftId, rightId }) => ({ relation, leftId, rightId })),
    solutionOrder: [...(manifest.solutionOrder ?? [])],
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function permutations(values) {
  if (values.length <= 1) return [values];
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const suffix of permutations(rest)) output.push([values[index], ...suffix]);
  }
  return output;
}

export function countSolutions(candidates, links) {
  if (!Array.isArray(candidates) || candidates.length !== 6 || !Array.isArray(links) || links.length !== 5) return 0;
  return permutations(candidates).reduce((count, order) => {
    const valid = links.every((link, index) => relationMatches(link.relation, order[index], order[index + 1]));
    return count + (valid ? 1 : 0);
  }, 0);
}

export function inspectManifest(manifest, { now = new Date() } = {}) {
  const issues = [];
  if (!requireObject(manifest, "$", issues)) return { valid: false, publishable: false, freshness: "UNKNOWN", solutionCount: 0, issues };
  rejectUnknownKeys(manifest, [
    "schemaVersion", "game", "status", "localDate", "timezone", "day", "puzzleNumber",
    "observedAt", "verifiedAt", "candidates", "startOrder", "links", "solutionOrder", "hints", "provenance",
  ], "$", issues);

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) issue(issues, "UNSUPPORTED_SCHEMA", "$.schemaVersion", `must equal ${MANIFEST_SCHEMA_VERSION}`);
  if (manifest.game !== "pokelike-pokesort") issue(issues, "MISSING_OR_INVALID", "$.game", "must equal pokelike-pokesort");
  if (!MANIFEST_STATUSES.includes(manifest.status)) issue(issues, "UNSUPPORTED_STATUS", "$.status", `must be one of ${MANIFEST_STATUSES.join(", ")}`);
  if (!isIanaTimezone(manifest.timezone)) issue(issues, "INVALID_TIMEZONE", "$.timezone", "must be UTC or an IANA area/location timezone");
  if (!isLocalDate(manifest.localDate)) issue(issues, "INVALID_LOCAL_DATE", "$.localDate", "must be a real YYYY-MM-DD date");
  if (!Number.isInteger(manifest.day)) issue(issues, "MISSING_OR_INVALID", "$.day", "must be an integer");
  if (!Number.isInteger(manifest.puzzleNumber) || manifest.puzzleNumber < 1) issue(issues, "MISSING_OR_INVALID", "$.puzzleNumber", "must be a positive integer");
  if (!isIsoInstant(manifest.observedAt)) issue(issues, "INVALID_INSTANT", "$.observedAt", "must be an ISO UTC instant");
  if (!isIsoInstant(manifest.verifiedAt)) issue(issues, "INVALID_INSTANT", "$.verifiedAt", "must be an ISO UTC instant");

  if (isLocalDate(manifest.localDate)) {
    const expectedDay = epochDay(manifest.localDate);
    if (manifest.day !== expectedDay) issue(issues, "DAY_MISMATCH", "$.day", `must equal ${expectedDay} for ${manifest.localDate}`);
    const expectedPuzzle = expectedDay - PUZZLE_EPOCH_DAY;
    if (manifest.puzzleNumber !== expectedPuzzle) issue(issues, "PUZZLE_MISMATCH", "$.puzzleNumber", `must equal ${expectedPuzzle} for day ${expectedDay}`);
  }

  let candidateById = new Map();
  const candidateNames = new Set();
  if (!Array.isArray(manifest.candidates) || manifest.candidates.length !== 6) {
    issue(issues, "CANDIDATE_COUNT", "$.candidates", "must contain exactly 6 candidates");
  } else {
    for (const [index, candidate] of manifest.candidates.entries()) {
      const path = `$.candidates[${index}]`;
      if (!requireObject(candidate, path, issues)) continue;
      rejectUnknownKeys(candidate, ["id", "name", "generation", "stage", "color", "types"], path, issues);
      if (!Number.isInteger(candidate.id) || candidate.id < 1) issue(issues, "MISSING_OR_INVALID", `${path}.id`, "must be a positive integer");
      requireString(candidate.name, `${path}.name`, issues);
      if (!Number.isInteger(candidate.generation) || candidate.generation < 1) issue(issues, "MISSING_OR_INVALID", `${path}.generation`, "must be a positive integer");
      if (!Number.isInteger(candidate.stage) || candidate.stage < 0) issue(issues, "MISSING_OR_INVALID", `${path}.stage`, "must be a non-negative integer");
      requireString(candidate.color, `${path}.color`, issues);
      if (!Array.isArray(candidate.types) || candidate.types.length < 1 || candidate.types.length > 2 || candidate.types.some((type) => !Object.hasOwn(TYPE_CHART, type))) {
        issue(issues, "MISSING_OR_INVALID", `${path}.types`, "must contain one or two supported lowercase Pokémon types");
      }
      if (candidateById.has(candidate.id)) issue(issues, "DUPLICATE_CANDIDATE", `${path}.id`, `duplicate id ${candidate.id}`);
      const normalizedName = typeof candidate.name === "string" ? candidate.name.trim().toLocaleLowerCase("en-US") : "";
      if (normalizedName && candidateNames.has(normalizedName)) issue(issues, "DUPLICATE_CANDIDATE", `${path}.name`, `duplicate name ${candidate.name}`);
      candidateNames.add(normalizedName);
      candidateById.set(candidate.id, candidate);
    }
  }

  const candidateIds = [...candidateById.keys()];
  for (const [field, values] of [["startOrder", manifest.startOrder], ["solutionOrder", manifest.solutionOrder]]) {
    if (!Array.isArray(values) || !sameMembers(values, candidateIds) || candidateIds.length !== 6) {
      issue(issues, "INVALID_PERMUTATION", `$.${field}`, "must be a complete permutation of the six unique candidate IDs");
    }
  }

  if (!Array.isArray(manifest.links) || manifest.links.length !== 5) {
    issue(issues, "LINK_COUNT", "$.links", "must contain exactly 5 links");
  } else {
    for (const [index, link] of manifest.links.entries()) {
      const path = `$.links[${index}]`;
      if (!requireObject(link, path, issues)) continue;
      rejectUnknownKeys(link, ["relation", "leftId", "rightId", "explanation"], path, issues);
      if (!SUPPORTED_RELATIONS.includes(link.relation)) issue(issues, "UNSUPPORTED_RELATION", `${path}.relation`, `unsupported relation ${String(link.relation)}`);
      requireString(link.explanation, `${path}.explanation`, issues);
      if (Array.isArray(manifest.solutionOrder) && manifest.solutionOrder.length === 6) {
        if (link.leftId !== manifest.solutionOrder[index] || link.rightId !== manifest.solutionOrder[index + 1]) {
          issue(issues, "LINK_ALIGNMENT", path, "leftId/rightId must match adjacent solution positions");
        }
        const left = candidateById.get(link.leftId);
        const right = candidateById.get(link.rightId);
        if (left && right && SUPPORTED_RELATIONS.includes(link.relation) && !relationMatches(link.relation, left, right)) {
          issue(issues, "FALSE_RELATION", path, `${link.relation} is false for ${left.name} -> ${right.name}`);
        }
      }
    }
  }

  if (isObject(manifest.hints)) rejectUnknownKeys(manifest.hints, ["noSpoiler", "progressive"], "$.hints", issues);
  if (!requireObject(manifest.hints, "$.hints", issues)
    || !requireString(manifest.hints?.noSpoiler, "$.hints.noSpoiler", issues)
    || !Array.isArray(manifest.hints?.progressive)
    || manifest.hints.progressive.length < 1
    || manifest.hints.progressive.some((hint) => typeof hint !== "string" || hint.trim() === "")) {
    issue(issues, "INVALID_HINTS", "$.hints", "must include one noSpoiler string and at least one progressive hint");
  }

  if (requireObject(manifest.provenance, "$.provenance", issues)) {
    rejectUnknownKeys(manifest.provenance, ["sourceUrl", "sourceSha256", "bundleUrl", "bundleSha256", "stateSha256", "contentSha256"], "$.provenance", issues);
    for (const field of ["sourceUrl", "bundleUrl"]) {
      if (!requireString(manifest.provenance[field], `$.provenance.${field}`, issues)
        || !/^https:\/\//.test(manifest.provenance[field] ?? "")) {
        issue(issues, "INVALID_SOURCE_URL", `$.provenance.${field}`, "must be an HTTPS URL");
      }
    }
    for (const field of ["sourceSha256", "bundleSha256", "stateSha256", "contentSha256"]) {
      if (!SHA256_PATTERN.test(manifest.provenance[field] ?? "")) issue(issues, "INVALID_HASH", `$.provenance.${field}`, "must be a lowercase 64-character SHA-256 hex digest");
    }
    if (SHA256_PATTERN.test(manifest.provenance.contentSha256 ?? "")
      && manifest.provenance.contentSha256 !== computeContentSha256(manifest)) {
      issue(issues, "CONTENT_HASH_MISMATCH", "$.provenance.contentSha256", "does not match the canonical core puzzle content");
    }
  }

  let freshness = "UNKNOWN";
  if (isIanaTimezone(manifest.timezone) && isLocalDate(manifest.localDate) && now instanceof Date && Number.isFinite(now.valueOf())) {
    const today = localDateAt(now, manifest.timezone);
    freshness = manifest.localDate === today ? "CURRENT" : (manifest.localDate < today ? "STALE" : "FUTURE");
    if (freshness === "STALE") issue(issues, "STALE_MANIFEST", "$.localDate", `is older than ${today} in ${manifest.timezone}`);
    if (freshness === "FUTURE") issue(issues, "FUTURE_MANIFEST", "$.localDate", `is later than ${today} in ${manifest.timezone}`);
  }
  if (isIsoInstant(manifest.observedAt) && Date.parse(manifest.observedAt) > now.valueOf()) {
    issue(issues, "FUTURE_OBSERVATION", "$.observedAt", "cannot be later than verifier time");
  }
  if (isIsoInstant(manifest.verifiedAt) && Date.parse(manifest.verifiedAt) > now.valueOf()) {
    issue(issues, "FUTURE_VERIFICATION", "$.verifiedAt", "cannot be later than verifier time");
  }
  if (isIsoInstant(manifest.observedAt) && isIsoInstant(manifest.verifiedAt) && Date.parse(manifest.verifiedAt) < Date.parse(manifest.observedAt)) {
    issue(issues, "VERIFICATION_ORDER", "$.verifiedAt", "cannot precede observedAt");
  }
  if (isIsoInstant(manifest.observedAt) && isIanaTimezone(manifest.timezone) && isLocalDate(manifest.localDate)
    && localDateAt(new Date(manifest.observedAt), manifest.timezone) !== manifest.localDate) {
    issue(issues, "OBSERVATION_DATE_MISMATCH", "$.observedAt", "does not fall on localDate in the manifest timezone");
  }

  let solutionCount = 0;
  if (candidateById.size === 6 && Array.isArray(manifest.links) && manifest.links.length === 5
    && manifest.links.every((link) => SUPPORTED_RELATIONS.includes(link?.relation))) {
    solutionCount = countSolutions([...candidateById.values()], manifest.links);
    if (solutionCount === 0) issue(issues, "ZERO_SOLUTIONS", "$.solutionOrder", "relations admit no solution");
    else if (solutionCount > 1) issue(issues, "MULTIPLE_SOLUTIONS", "$.solutionOrder", `relations admit ${solutionCount} solutions`);
    if (solutionCount === 1) {
      const supplied = manifest.solutionOrder?.map((id) => candidateById.get(id));
      if (supplied?.length === 6 && !manifest.links.every((link, index) => relationMatches(link.relation, supplied[index], supplied[index + 1]))) {
        issue(issues, "WRONG_SOLUTION", "$.solutionOrder", "is not the unique relation-satisfying order");
      }
    }
  }

  if (manifest.status === "STALE" && freshness === "CURRENT") issue(issues, "STATUS_FRESHNESS_MISMATCH", "$.status", "STALE status cannot describe a current record");
  const valid = issues.length === 0;
  const publishable = valid
    && ["VERIFIED", "PUBLISHED"].includes(manifest.status)
    && freshness === "CURRENT"
    && solutionCount === 1;
  return { valid, publishable, freshness, solutionCount, issues };
}

export function verifyManifest(manifest, options) {
  const result = inspectManifest(manifest, options);
  if (!result.valid) throw new ManifestValidationError(result.issues);
  return result;
}
