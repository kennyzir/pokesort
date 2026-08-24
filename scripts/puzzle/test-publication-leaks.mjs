import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPublicationLeaks, inspectPublicationCandidate } from "./check-publication-leaks.mjs";

const asOfDate = "2026-08-24";
const compromisedSeed = ["pokesort", "daily", "calendar", "2026", "v1"].join("-");
const temporaryRoots = [];

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "pokesort-publication-leaks-"));
  temporaryRoots.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "config", "core.autocrlf", "false"]);
  return root;
}

function write(root, path, content) {
  const target = join(root, ...path.split("/"));
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function stage(root, path) {
  execFileSync("git", ["-C", root, "add", "--", path]);
}

try {
  const cleanRepo = makeRepo();
  write(cleanRepo, "data/puzzles/daily/2026-08-24.json", JSON.stringify({ date: "2026-08-24", puzzleId: "daily-2026-08-24" }));
  stage(cleanRepo, "data/puzzles/daily/2026-08-24.json");
  write(cleanRepo, "data/puzzles/daily/2026-08-25.json", JSON.stringify({ date: "2026-08-25", answer: "local future fixture" }));

  let result = checkPublicationLeaks({ repoRoot: cleanRepo, asOfDate });
  assert.equal(result.leaks.length, 0, "an elapsed staged manifest must pass and an ordinary untracked future file must be ignored");

  write(cleanRepo, "data/puzzles/daily/2026-08-24.json", JSON.stringify({ date: "2026-08-25", puzzleId: "tracked-worktree-future" }));
  result = checkPublicationLeaks({ repoRoot: cleanRepo, asOfDate });
  assert(result.leaks.some((leak) => leak.source === "worktree" && leak.kind === "future-daily-date"), "an unstaged leak in a tracked worktree file must fail");
  write(cleanRepo, "data/puzzles/daily/2026-08-24.json", JSON.stringify({ date: "2026-08-24", puzzleId: "daily-2026-08-24" }));

  stage(cleanRepo, "data/puzzles/daily/2026-08-25.json");
  result = checkPublicationLeaks({ repoRoot: cleanRepo, asOfDate });
  assert(result.leaks.some((leak) => leak.kind === "future-daily-manifest"), "a staged future manifest must fail");

  const indexRepo = makeRepo();
  write(indexRepo, "data/puzzles/daily/index.json", JSON.stringify({ entries: [{ date: "2026-08-25" }] }));
  stage(indexRepo, "data/puzzles/daily/index.json");
  result = checkPublicationLeaks({ repoRoot: indexRepo, asOfDate });
  assert(result.leaks.some((leak) => leak.kind === "future-daily-date"), "future dates embedded in a staged Daily index must fail");

  const publicHistoryRepo = makeRepo();
  write(publicHistoryRepo, "data/puzzles/public-daily/2026-08-25.json", JSON.stringify({ date: "2026-08-25", answer: "future public history fixture" }));
  stage(publicHistoryRepo, "data/puzzles/public-daily/2026-08-25.json");
  result = checkPublicationLeaks({ repoRoot: publicHistoryRepo, asOfDate });
  assert(result.leaks.some((leak) => leak.kind === "future-daily-manifest"), "tracked public-history future manifests must fail the leak Gate");

  const seedRepo = makeRepo();
  write(seedRepo, "scripts/puzzle/build-daily-calendar.mjs", `export const CALENDAR_SEED = ${JSON.stringify(compromisedSeed)};\n`);
  stage(seedRepo, "scripts/puzzle/build-daily-calendar.mjs");
  result = checkPublicationLeaks({ repoRoot: seedRepo, asOfDate });
  assert(result.leaks.some((leak) => leak.kind === "known-daily-seed"), "the known compromised seed marker must fail");
  assert(result.leaks.some((leak) => leak.kind === "literal-daily-production-seed"), "a literal production calendar seed must fail");

  const explicitRepo = makeRepo();
  write(explicitRepo, "data/puzzles/daily/2026-08-25.json", JSON.stringify({ date: "2026-08-25" }));
  result = checkPublicationLeaks({ repoRoot: explicitRepo, asOfDate, candidates: ["data/puzzles/daily/2026-08-25.json"] });
  assert(result.leaks.some((leak) => leak.source === "explicit"), "an explicitly supplied untracked publication candidate must be checked");

  const directInspection = inspectPublicationCandidate({
    path: "data/puzzles/daily/2026-08-24.json",
    source: "fixture",
    content: JSON.stringify({ date: "2026-08-24", sourceSeed: "should-not-be-public" }),
    asOfDate,
  });
  assert(directInspection.some((leak) => leak.kind === "daily-production-seed"), "a non-empty sourceSeed field must fail even for an elapsed manifest");

  console.log("Publication leak gate passed positive, negative, staged, untracked, index, seed, and explicit-candidate fixtures.");
} finally {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
}
