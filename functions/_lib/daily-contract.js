export const DAILY_API_SCHEMA_VERSION = 1;
export const DAILY_ENVELOPE_SCHEMA_VERSION = 2;
export const DAILY_KV_PREFIX = "daily:v2:";
export const MINIMUM_PRELOAD_DAYS = 7;
export const MAXIMUM_ENVELOPE_BYTES = 256_000;

export function utcDateFromNow(now = new Date()) {
  const parsed = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_SERVER_TIME");
  return parsed.toISOString().slice(0, 10);
}

export function isUtcDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "")
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function dailyKey(date) {
  if (!isUtcDate(date)) throw new Error("INVALID_DATE");
  return `${DAILY_KV_PREFIX}${date}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  if (!/^[a-f0-9]+$/i.test(value ?? "") || value.length % 2 !== 0) return null;
  return Uint8Array.from(value.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));
}

async function importEnvelopeKey(signingKey) {
  if (typeof signingKey !== "string" || new TextEncoder().encode(signingKey).byteLength < 32) {
    throw new Error("ENVELOPE_SIGNING_KEY_REQUIRED");
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSha256Hex(value, signingKey) {
  const key = await importEnvelopeKey(signingKey);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyHmacSha256(value, expectedHex, signingKey) {
  const signature = hexToBytes(expectedHex);
  if (!signature || signature.byteLength !== 32) return false;
  const key = await importEnvelopeKey(signingKey);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(canonicalJson(value)));
}

const hasPrivateDerivationMaterial = (value) => /(?:sourceSeed|productionSeed|calendarSeed|privateSeed|"seed"\s*:)/i.test(JSON.stringify(value));
const memberSignature = (ids) => [...ids].sort((a, b) => a - b).join("-");

export async function inspectDailyManifest(manifest, expectedDate) {
  const issues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { valid: false, issues: ["MALFORMED_MANIFEST"] };
  if (!isUtcDate(manifest.date) || manifest.date !== expectedDate) issues.push("DATE_MISMATCH");
  if (manifest.calendarSchemaVersion !== 1 || manifest.puzzleSchemaVersion !== 1) issues.push("SCHEMA_MISMATCH");
  if (manifest.publicationPolicy !== "stored manifests become public only when date <= current UTC date; storage does not imply publication or indexing") issues.push("PUBLICATION_POLICY_MISMATCH");
  if (Date.parse(manifest.publishAtUtc) !== Date.parse(`${expectedDate}T00:00:00.000Z`)) issues.push("PUBLISH_AT_MISMATCH");
  if (hasPrivateDerivationMaterial(manifest)) issues.push("PRIVATE_DERIVATION_MATERIAL");
  const cards = Array.isArray(manifest.cards) ? manifest.cards : [];
  const cardIds = cards.map((card) => card?.id);
  if (cards.length !== 16 || cardIds.some((id) => !Number.isSafeInteger(id)) || new Set(cardIds).size !== 16) issues.push("CARD_CARDINALITY");
  if (cards.length === 16 && manifest.boardSignature !== memberSignature(cardIds)) issues.push("BOARD_SIGNATURE_MISMATCH");
  const groups = Array.isArray(manifest.groups) ? manifest.groups : [];
  const partitionIds = [];
  if (groups.length !== 4) issues.push("GROUP_CARDINALITY");
  for (const group of groups) {
    const ids = Array.isArray(group?.memberIds) ? group.memberIds : [];
    if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some((id) => !cardIds.includes(id))) issues.push("GROUP_MEMBER_MISMATCH");
    if (group?.memberSignature !== memberSignature(ids)) issues.push("GROUP_SIGNATURE_MISMATCH");
    if (!Array.isArray(group?.members) || canonicalJson(group.members.map((member) => member?.id)) !== canonicalJson(ids)) issues.push("GROUP_MEMBER_COPY_MISMATCH");
    if (!Array.isArray(group?.matchingRuleEvidence) || !group.matchingRuleEvidence.some((rule) => rule?.signature === group?.predicateSignature)) issues.push("RULE_EVIDENCE_MISMATCH");
    partitionIds.push(...ids);
  }
  if (partitionIds.length !== 16 || new Set(partitionIds).size !== 16 || partitionIds.some((id) => !cardIds.includes(id))) issues.push("PARTITION_COVERAGE");
  if (manifest.solver?.solutionCount !== 1 || manifest.solver?.countComplete !== true) issues.push("NON_UNIQUE_SOLUTION");
  if (manifest.quality?.accepted !== true) issues.push("QUALITY_NOT_ACCEPTED");
  if (!/^[a-f0-9]{64}$/.test(manifest.contentHash ?? "")) issues.push("CONTENT_HASH_FORMAT");
  else {
    const { puzzleId, contentHash, ...base } = manifest;
    if (await sha256Hex(base) !== contentHash) issues.push("CONTENT_HASH_MISMATCH");
    if (puzzleId !== `daily-${expectedDate}-${contentHash.slice(0, 16)}`) issues.push("PUZZLE_ID_MISMATCH");
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export async function createDailyEnvelope(manifest, { environment, preparedAt = new Date().toISOString(), signingKey } = {}) {
  if (!["preview", "production"].includes(environment)) throw new Error("INVALID_ENVIRONMENT");
  const inspection = await inspectDailyManifest(manifest, manifest?.date);
  if (!inspection.valid) throw new Error(`INVALID_MANIFEST:${inspection.issues.join(",")}`);
  const base = {
    schemaVersion: DAILY_ENVELOPE_SCHEMA_VERSION,
    integrity: "HMAC-SHA-256",
    environment,
    utcDate: manifest.date,
    puzzleId: manifest.puzzleId,
    contentHash: manifest.contentHash,
    preparedAt: new Date(preparedAt).toISOString(),
    manifest,
  };
  const withHash = { ...base, envelopeHash: await sha256Hex(base) };
  return { ...withHash, authenticationTag: await hmacSha256Hex(withHash, signingKey) };
}

export async function inspectDailyEnvelope(envelope, { expectedDate, environment, signingKey } = {}) {
  const issues = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return { valid: false, issues: ["MALFORMED_ENVELOPE"] };
  if (envelope.schemaVersion !== DAILY_ENVELOPE_SCHEMA_VERSION || envelope.integrity !== "HMAC-SHA-256") issues.push("ENVELOPE_SCHEMA_MISMATCH");
  if (envelope.environment !== environment) issues.push("ENVIRONMENT_MISMATCH");
  if (envelope.utcDate !== expectedDate) issues.push("ENVELOPE_DATE_MISMATCH");
  const preparedTime = Date.parse(envelope.preparedAt);
  const activationTime = Date.parse(`${expectedDate}T00:00:00.000Z`);
  if (!Number.isFinite(preparedTime)) issues.push("PREPARED_AT_INVALID");
  else if (activationTime - preparedTime < MINIMUM_PRELOAD_DAYS * 86_400_000) issues.push("PRELOAD_WINDOW_TOO_SHORT");
  if (envelope.puzzleId !== envelope.manifest?.puzzleId || envelope.contentHash !== envelope.manifest?.contentHash) issues.push("ENVELOPE_MANIFEST_MISMATCH");
  const { authenticationTag, envelopeHash, ...base } = envelope;
  if (!/^[a-f0-9]{64}$/.test(envelopeHash ?? "") || await sha256Hex(base) !== envelopeHash) issues.push("ENVELOPE_HASH_MISMATCH");
  try {
    if (!await verifyHmacSha256({ ...base, envelopeHash }, authenticationTag, signingKey)) issues.push("ENVELOPE_AUTHENTICATION_FAILED");
  } catch {
    issues.push("ENVELOPE_AUTHENTICATION_FAILED");
  }
  const manifestInspection = await inspectDailyManifest(envelope.manifest, expectedDate);
  issues.push(...manifestInspection.issues);
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}
