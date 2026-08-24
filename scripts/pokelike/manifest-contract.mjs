export const MANIFEST_SCHEMA_VERSION = 1;

export const MANIFEST_STATUSES = Object.freeze([
  "PENDING",
  "EXTRACTED",
  "VERIFIED",
  "PUBLISHED",
  "BLOCKED",
  "STALE",
]);

export const SUPPORTED_RELATIONS = Object.freeze([
  "color",
  "type",
  "gen_eq",
  "gen_gt",
  "gen_lt",
  "stage_eq",
  "stage_gt",
  "stage_lt",
  "se",
]);

// The two first-party observations (#53 and #54) establish this mapping. Keep it
// versioned with the manifest contract instead of silently deriving a new epoch.
export const PUZZLE_EPOCH_DAY = 20635;

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
