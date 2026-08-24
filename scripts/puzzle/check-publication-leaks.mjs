import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const KNOWN_DAILY_SEED = ["pokesort", "daily", "calendar", "2026", "v1"].join("-");
const DAILY_JSON_PATH = /(?:^|\/)data\/puzzles\/(?:daily|public-daily)\/(?:index|\d{4}-\d{2}-\d{2})\.json$/;
const DATED_DAILY_JSON_PATH = /(?:^|\/)data\/puzzles\/(?:daily|public-daily)\/(\d{4}-\d{2}-\d{2})\.json$/;
const DAILY_PRODUCTION_SOURCE_PATH = /(?:^|\/)scripts\/puzzle\/(?:build|prepare|publish)-daily-[^/]+\.mjs$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizePath(value) {
  return value.split(sep).join("/").replace(/^\.\//, "");
}

function utcDateNow() {
  return new Date().toISOString().slice(0, 10);
}

function assertUtcDate(value, optionName) {
  if (!ISO_DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${optionName} must be a valid UTC date in YYYY-MM-DD format`);
  }
}

function git(repoRoot, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function trackedPaths(repoRoot) {
  const output = git(repoRoot, ["ls-files", "--cached", "-z"]);
  return output.split("\0").filter(Boolean).map(normalizePath);
}

function readIndexCandidate(repoRoot, path) {
  try {
    return git(repoRoot, ["show", `:${path}`]);
  } catch {
    // Intent-to-add paths have no index blob. Their worktree copy is inspected below.
    return null;
  }
}

function readWorktreeCandidate(repoRoot, path) {
  const absolutePath = resolve(repoRoot, path);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, "utf8");
}

function collectDates(value, dates = []) {
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) dates.push(value);
    return dates;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDates(item, dates);
    return dates;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (ISO_DATE.test(key)) dates.push(key);
      collectDates(item, dates);
    }
  }
  return dates;
}

function inspectDailyJson({ path, source, content, asOfDate }) {
  const leaks = [];
  const filenameDate = path.match(DATED_DAILY_JSON_PATH)?.[1];
  if (filenameDate && filenameDate > asOfDate) {
    leaks.push({ path, source, kind: "future-daily-manifest", detail: `${filenameDate} is later than ${asOfDate}` });
  }

  try {
    const parsed = JSON.parse(content);
    const futureDates = [...new Set(collectDates(parsed).filter((date) => date > asOfDate))].sort();
    for (const date of futureDates) {
      leaks.push({ path, source, kind: "future-daily-date", detail: `${date} is later than ${asOfDate}` });
    }

    for (const field of ["seed", "sourceSeed", "productionSeed"]) {
      if (typeof parsed?.[field] === "string" && parsed[field].trim()) {
        leaks.push({ path, source, kind: "daily-production-seed", detail: `non-empty ${field} field` });
      }
    }
  } catch {
    leaks.push({ path, source, kind: "invalid-daily-json", detail: "cannot verify publication date because JSON is invalid" });
  }

  return leaks;
}

export function inspectPublicationCandidate({ path, source = "candidate", content, asOfDate }) {
  const normalizedPath = normalizePath(path);
  const leaks = [];

  if (content.includes(KNOWN_DAILY_SEED)) {
    leaks.push({ path: normalizedPath, source, kind: "known-daily-seed", detail: "known compromised calendar seed marker" });
  }

  if (DAILY_JSON_PATH.test(normalizedPath)) {
    leaks.push(...inspectDailyJson({ path: normalizedPath, source, content, asOfDate }));
  }

  if (DAILY_PRODUCTION_SOURCE_PATH.test(normalizedPath)) {
    const literalSeedAssignment = /\b(?:CALENDAR_SEED|DAILY_PRODUCTION_SEED|PRODUCTION_DAILY_SEED)\b\s*=\s*(["'`])([^"'`\r\n]{8,})\1/g;
    for (const match of content.matchAll(literalSeedAssignment)) {
      leaks.push({
        path: normalizedPath,
        source,
        kind: "literal-daily-production-seed",
        detail: `${match[0].split("=")[0].trim()} contains an in-source literal`,
      });
    }
  }

  return leaks;
}

export function checkPublicationLeaks({ repoRoot = process.cwd(), asOfDate = utcDateNow(), candidates = [] } = {}) {
  const resolvedRoot = resolve(repoRoot);
  assertUtcDate(asOfDate, "--as-of");

  // Ordinary untracked files are intentionally not publication candidates. This preserves
  // local/private future artifacts while still checking every tracked or staged path.
  const paths = new Set(trackedPaths(resolvedRoot));
  for (const candidate of candidates) {
    const absolute = resolve(resolvedRoot, candidate);
    const rel = normalizePath(relative(resolvedRoot, absolute));
    if (rel === ".." || rel.startsWith("../")) throw new Error(`Candidate is outside repository: ${candidate}`);
    paths.add(rel);
  }

  const explicit = new Set(candidates.map((candidate) => normalizePath(relative(resolvedRoot, resolve(resolvedRoot, candidate)))));
  const leaks = [];
  for (const path of [...paths].sort()) {
    const versions = [];
    const indexContent = readIndexCandidate(resolvedRoot, path);
    if (indexContent !== null) versions.push({ source: "index", content: indexContent });

    const worktreeContent = readWorktreeCandidate(resolvedRoot, path);
    if (worktreeContent !== null && (explicit.has(path) || worktreeContent !== indexContent)) {
      versions.push({ source: explicit.has(path) ? "explicit" : "worktree", content: worktreeContent });
    }

    for (const version of versions) {
      leaks.push(...inspectPublicationCandidate({ path, ...version, asOfDate }));
    }
  }

  const unique = new Map(leaks.map((leak) => [`${leak.path}\0${leak.source}\0${leak.kind}\0${leak.detail}`, leak]));
  return { repoRoot: resolvedRoot, asOfDate, checkedPathCount: paths.size, leaks: [...unique.values()] };
}

function parseArguments(argv) {
  const options = { candidates: [] };
  const nextValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo") options.repoRoot = nextValue(index++, argument);
    else if (argument === "--as-of") options.asOfDate = nextValue(index++, argument);
    else if (argument === "--candidate") options.candidates.push(nextValue(index++, argument));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.repoRoot === undefined) options.repoRoot = process.cwd();
  return options;
}

export function runCli(argv = process.argv.slice(2)) {
  try {
    const result = checkPublicationLeaks(parseArguments(argv));
    if (result.leaks.length > 0) {
      console.error(`Publication leak gate failed (${result.leaks.length} finding(s), allowed through ${result.asOfDate} UTC):`);
      for (const leak of result.leaks) console.error(`- ${leak.path} [${leak.source}] ${leak.kind}: ${leak.detail}`);
      return 1;
    }
    console.log(`Publication leak gate passed: ${result.checkedPathCount} tracked/staged/explicit candidate paths, allowed through ${result.asOfDate} UTC.`);
    return 0;
  } catch (error) {
    console.error(`Publication leak gate error: ${error.message}`);
    return 2;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) process.exitCode = runCli();
