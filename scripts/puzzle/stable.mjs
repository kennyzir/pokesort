import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}
export function canonicalJson(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, space);
}

export function sha256(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(input).digest("hex");
}
