const EVENT_SCHEMAS = Object.freeze({
  pokesort_board_ready: ["game_mode", "load_ms", "mistakes", "groups_solved", "outcome"],
  pokesort_game_start: ["game_mode", "elapsed_ms"],
  pokesort_guess_submit: ["game_mode", "elapsed_ms", "mistakes", "groups_solved", "guess_match_count", "outcome"],
  pokesort_group_solved: ["game_mode", "elapsed_ms", "mistakes", "groups_solved"],
  pokesort_valid_overlap: ["game_mode", "elapsed_ms", "mistakes", "groups_solved", "guess_match_count"],
  pokesort_hint_open: ["game_mode", "elapsed_ms", "mistakes", "groups_solved", "hint_level"],
  pokesort_reveal: ["game_mode", "elapsed_ms", "mistakes", "groups_solved"],
  pokesort_game_complete: ["game_mode", "elapsed_ms", "mistakes", "groups_solved", "outcome"],
  pokesort_share: ["game_mode", "elapsed_ms", "mistakes", "groups_solved", "share_method"],
  pokesort_new_infinite: ["game_mode", "elapsed_ms", "round_number"],
  pokesort_load_error: ["game_mode", "error_stage"],
});

const STRING_ENUMS = Object.freeze({
  game_mode: new Set(["daily", "archive", "infinite"]),
  share_method: new Set(["native", "clipboard"]),
  error_stage: new Set([
    "embedded_payload", "daily_api_fetch", "daily_api_payload", "archive_payload",
    "infinite_index", "infinite_shard", "infinite_overlap_contract", "state_restore", "render",
  ]),
});

const OUTCOMES = Object.freeze({
  pokesort_board_ready: new Set(["embedded", "api", "archive_manifest", "infinite_pool"]),
  pokesort_guess_submit: new Set(["correct", "valid_overlap", "invalid"]),
  pokesort_game_complete: new Set(["solved", "failed", "revealed"]),
});

const NUMBER_LIMITS = Object.freeze({
  elapsed_ms: 86_400_000,
  load_ms: 86_400_000,
  mistakes: 4,
  groups_solved: 4,
  guess_match_count: 4,
  hint_level: 3,
  round_number: 1_000_000_000,
});

const REQUIRED_PARAMETERS = Object.freeze({
  pokesort_board_ready: ["game_mode", "load_ms", "outcome"],
  pokesort_game_start: ["game_mode", "elapsed_ms"],
  pokesort_guess_submit: ["game_mode", "elapsed_ms", "guess_match_count", "outcome"],
  pokesort_group_solved: ["game_mode", "elapsed_ms", "groups_solved"],
  pokesort_valid_overlap: ["game_mode", "elapsed_ms", "guess_match_count"],
  pokesort_hint_open: ["game_mode", "elapsed_ms", "hint_level"],
  pokesort_reveal: ["game_mode", "elapsed_ms"],
  pokesort_game_complete: ["game_mode", "elapsed_ms", "outcome"],
  pokesort_share: ["game_mode", "elapsed_ms", "share_method"],
  pokesort_new_infinite: ["game_mode", "elapsed_ms", "round_number"],
  pokesort_load_error: ["game_mode", "error_stage"],
});

export const POKESORT_ANALYTICS_EVENTS = Object.freeze(Object.keys(EVENT_SCHEMAS));
export const POKESORT_ANALYTICS_PARAMETERS = Object.freeze([...new Set(Object.values(EVENT_SCHEMAS).flat())].sort());

export function sanitizePokeSortEvent(eventName, parameters = {}) {
  const allowed = EVENT_SCHEMAS[eventName];
  if (!allowed || !parameters || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const sanitized = {};
  for (const name of allowed) {
    const value = parameters[name];
    if (name === "outcome") {
      if (OUTCOMES[eventName]?.has(value)) sanitized[name] = value;
      continue;
    }
    if (STRING_ENUMS[name]) {
      if (typeof value === "string" && STRING_ENUMS[name].has(value)) sanitized[name] = value;
      continue;
    }
    if (Object.hasOwn(NUMBER_LIMITS, name) && Number.isSafeInteger(value) && value >= 0 && value <= NUMBER_LIMITS[name]) {
      sanitized[name] = value;
    }
  }
  if (REQUIRED_PARAMETERS[eventName].some((name) => !Object.hasOwn(sanitized, name))) return null;
  return sanitized;
}

export function emitPokeSortEvent(eventName, parameters = {}) {
  try {
    if (typeof window.gtag !== "function") return false;
    const sanitized = sanitizePokeSortEvent(eventName, parameters);
    if (!sanitized) return false;
    window.gtag("event", eventName, sanitized);
    return true;
  } catch {
    return false;
  }
}
