import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RELEASE_SENSITIVE_ENV_NAMES } from "./check-release-security.mjs";

const workflow = await readFile(resolve(".github/workflows/daily-archive-refresh.yml"), "utf8");
const handoff = await readFile(resolve("docs/roadmap/R4_CLOUDFLARE_HANDOFF.md"), "utf8");
const rehearsal = await readFile(resolve("docs/roadmap/R7_RELEASE_REHEARSAL.md"), "utf8");

assert.match(workflow, /schedule:\s*\n\s+- cron: "10 0 \* \* \*"/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /^permissions:\s*\n\s+contents: read\s*$/m, "workflow default token must be read-only");
assert.equal((workflow.match(/contents: write/g) ?? []).length, 1, "only elapsed-history publisher may write repository contents");
assert.match(workflow, /concurrency:\s*\n\s+group: daily-pokesort-release-main\s*\n\s+cancel-in-progress: false/, "the complete release must be a non-cancelling single writer");
assert.match(workflow, /publish-elapsed-history:\s*\n\s+needs: prepare-private-buffer/);
assert.match(workflow, /readiness-monitor:\s*\n\s+needs: publish-elapsed-history/);

assert.equal((workflow.match(/actions\/checkout@v5/g) ?? []).length, 3);
assert.equal((workflow.match(/actions\/setup-node@v5/g) ?? []).length, 3);
assert.equal((workflow.match(/node-version: 22/g) ?? []).length, 3);
assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact|retention-days:/, "future payloads must not enter workflow artifacts");

for (const required of [
  'private_dir="$RUNNER_TEMP/pokesort-private-buffer"',
  '--manifest "$path"',
  "--minimum-count 7",
  "POKESORT_DAILY_AUTOMATION_ENABLED == 'true'",
  '"$CLOUDFLARE_ACCOUNT_ID" == "$EXPECTED_CLOUDFLARE_ACCOUNT_ID"',
  "POKESORT_PRODUCTION_DAILY_KV_NAMESPACE_ID",
  "POKESORT_PRODUCTION_DAILY_ENVELOPE_HMAC_KEY",
]) assert.ok(workflow.includes(required), `missing workflow security contract: ${required}`);
assert.doesNotMatch(workflow, /git add\s+(?:-A|--all|\.)\b/);
assert.ok(workflow.includes("git add -- data/puzzles/public-daily"));
assert.ok(workflow.includes("[[ ${#staged[@]} -le 2 ]]"));
assert.ok(workflow.includes("git diff --cached --diff-filter=D --quiet"));

const publishStart = workflow.indexOf("  publish-elapsed-history:");
const monitorStart = workflow.indexOf("  readiness-monitor:");
const publishJob = workflow.slice(publishStart, monitorStart);
const apiStage = publishJob.indexOf("--strategy api");
const appendGate = publishJob.indexOf("npm run release:gate");
const narrowStage = publishJob.indexOf("git add -- data/puzzles/public-daily");
const push = publishJob.indexOf("git push origin HEAD:main");
assert.ok(apiStage >= 0 && apiStage < appendGate && appendGate < narrowStage && narrowStage < push, "enabled UTC publication order must be current API -> exact append -> shared Gate -> narrow commit/push");
assert.doesNotMatch(workflow, /POKESORT_EDGE_DAILY:\s*["']?1|DAILY_API_ENABLED:\s*["']?true/, "edge routing and browser adoption must remain default-off");

const actualSensitiveNames = [...new Set([...workflow.matchAll(/\b(?:[A-Z][A-Z0-9_]*(?:SEED|TOKEN|ACCOUNT_ID|NAMESPACE_ID|HMAC_KEY))\b/g)].map((match) => match[0]))];
for (const name of actualSensitiveNames) assert.ok(RELEASE_SENSITIVE_ENV_NAMES.includes(name), `release scanner must explicitly cover workflow input ${name}`);

for (const name of [
  "POKESORT_PREVIEW_DAILY_KV_NAMESPACE_ID",
  "POKESORT_PRODUCTION_DAILY_KV_NAMESPACE_ID",
  "POKESORT_PREVIEW_DAILY_ENVELOPE_HMAC_KEY",
  "POKESORT_PRODUCTION_DAILY_ENVELOPE_HMAC_KEY",
]) assert.ok(handoff.includes(name), `preview/production isolation handoff missing ${name}`);
assert.match(handoff, /preview and production keys must never be shared/i);
assert.match(rehearsal, /quota.*unverified|cost.*unverified|unverified.*quota|unverified.*cost/i, "cost/quota assumptions must remain explicitly unverified");

console.log(JSON.stringify({ gate: "PASS", schedule: "00:10 UTC + manual", permissions: "least privilege", concurrency: "single writer, non-cancelling", privateArtifacts: "none", commitScope: "one exact date + index", externalActivation: "default off" }));
