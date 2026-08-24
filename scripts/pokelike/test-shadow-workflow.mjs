import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/daily-pokelike-shadow.yml", "utf8");

for (const required of [
  'cron: "10 16 * * *"',
  "workflow_dispatch:",
  "contents: write",
  "cancel-in-progress: false",
  "timeout-minutes: 20",
  "node-version: 22",
  "npm ci",
  "playwright install --with-deps chromium",
  "timeout 8m npm run --silent capture:pokelike-shadow",
  "--timezone Asia/Shanghai",
  "--write",
  "validate-shadow-evidence.mjs",
  "--existing-receipt",
  "has_new_evidence=false",
  "has_new_evidence=true",
  'realpath --relative-to="$GITHUB_WORKSPACE"',
  'data/pokelike/shadow/Asia__Shanghai/*',
  "git diff --quiet --exit-code",
  "git diff --cached --quiet --exit-code",
  'git add -- "$CAPTURE_PATH" "$RECEIPT_PATH"',
  "git push origin HEAD:main",
]) assert(workflow.includes(required), `workflow must contain ${required}`);

for (const forbidden of [
  "mark:pokelike-published",
  "POKELIKE_TODAY_MANIFESTS",
  "POKELIKE_TODAY_PREVIEW",
  "POKELIKE_TODAY_INDEX",
  "wrangler",
  "cloudflare",
]) assert(!workflow.toLowerCase().includes(forbidden.toLowerCase()), `workflow must not contain ${forbidden}`);

assert.match(workflow, /permissions:\s*\n\s+contents: write\s*\n/);
assert.match(workflow, /expected_local_date="\$\(TZ=Asia\/Shanghai date \+%F\)"/);
assert.match(workflow, /changed_paths\[@\].*-ne 2/);
assert.match(workflow, /if: steps\.shadow\.outputs\.has_new_evidence == 'true'/);

console.log("Pokelike daily shadow workflow contract passed (UTC schedule, fail-closed evidence-only commit, and no publication/deploy controls). ");
