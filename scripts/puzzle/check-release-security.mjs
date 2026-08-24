import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublicationLeaks } from "./check-publication-leaks.mjs";

const normalize = (value) => value.split(sep).join("/").replace(/^\.\//, "");
const publicSurface = /^(?:assets\/|functions\/|[^/]+\.html$|[^/]+\/index\.html$|data\/puzzles\/public-daily\/|\.github\/workflows\/)/;
export const RELEASE_SENSITIVE_ENV_NAMES = Object.freeze([
  "POKESORT_DAILY_SEED",
  "CLOUDFLARE_DAILY_KV_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "EXPECTED_CLOUDFLARE_ACCOUNT_ID",
  "POKESORT_CLOUDFLARE_ACCOUNT_ID",
  "POKESORT_PREVIEW_DAILY_KV_NAMESPACE_ID",
  "POKESORT_PRODUCTION_DAILY_KV_NAMESPACE_ID",
  "DAILY_ADMIN_SECRET",
  "DAILY_ENVELOPE_HMAC_KEY",
  "POKESORT_PREVIEW_DAILY_ENVELOPE_HMAC_KEY",
  "POKESORT_PRODUCTION_DAILY_ENVELOPE_HMAC_KEY",
]);
const sensitiveNamesPattern = [...RELEASE_SENSITIVE_ENV_NAMES].sort((left, right) => right.length - left.length).join("|");
const sensitiveAssignment = new RegExp(`(?<![A-Z0-9_$-])(?:["']?)(${sensitiveNamesPattern})(?:["']?)[ \\t]*[:=][ \\t]*(?:"([^"\\r\\n]*)"|'([^'\\r\\n]*)'|([^\\s,\\r\\n}]+))`, "g");
const allowedPlaceholder = (value) => !value
  || /^(?:REPLACE_WITH_[A-Z0-9_]+|\$\{\{|\$[A-Z_][A-Z0-9_]*$|process\.env(?:\.|\[))/i.test(value)
  || /^(?:key|signingKey|hmacKey)[,;)]?$/.test(value);

export function inspectReleaseSecurityCandidate({ path, content, asOfDate }) {
  const findings = [];
  const normalizedPath = normalize(path);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push({ path: normalizedPath, kind: "private-key-material" });
  for (const match of content.matchAll(sensitiveAssignment)) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (!allowedPlaceholder(value)) findings.push({ path: normalizedPath, kind: "literal-release-secret", name: match[1] });
  }
  if (publicSurface.test(normalizedPath)) {
    for (const match of content.matchAll(/daily-(\d{4}-\d{2}-\d{2})-[a-f0-9]{16,64}/g)) if (match[1] > asOfDate) findings.push({ path: normalizedPath, kind: "future-puzzle-id" });
    if (/"(?:sourceSeed|productionSeed|calendarSeed|privateSeed)"\s*:/.test(content)) findings.push({ path: normalizedPath, kind: "public-seed-field" });
  }
  return findings;
}

export function checkReleaseSecurity({ repoRoot = process.cwd(), asOfDate = new Date().toISOString().slice(0, 10), candidates = [] } = {}) {
  const root = resolve(repoRoot);
  const untracked = execFileSync("git", ["-C", root, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const explicitCandidates = [...new Set([...untracked, ...candidates])];
  const publication = checkPublicationLeaks({ repoRoot: root, asOfDate, candidates: explicitCandidates });
  const paths = new Set(execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map(normalize));
  for (const candidate of explicitCandidates) paths.add(normalize(relative(root, resolve(root, candidate))));
  const findings = [...publication.leaks];
  for (const path of paths) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    findings.push(...inspectReleaseSecurityCandidate({ path, content: readFileSync(absolute, "utf8"), asOfDate }));
  }
  return { gate: findings.length ? "BLOCKED" : "PASS", asOfDate, checkedPathCount: paths.size, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidates = []; let asOfDate;
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--candidate") candidates.push(process.argv[++index]);
    else if (process.argv[index] === "--as-of") asOfDate = process.argv[++index];
    else throw new Error(`Unknown argument: ${process.argv[index]}`);
  }
  const result = checkReleaseSecurity({ candidates, asOfDate });
  if (result.findings.length) {
    console.error(`Release security Gate BLOCKED (${result.findings.length} finding(s)).`);
    for (const finding of result.findings) console.error(`- ${finding.path}: ${finding.kind}`);
    process.exitCode = 1;
  } else console.log(`Release security Gate PASS: ${result.checkedPathCount} publication candidates checked; no secret, seed, or future-payload exposure.`);
}
