import assert from "node:assert/strict";
import { inspectReleaseSecurityCandidate, RELEASE_SENSITIVE_ENV_NAMES } from "./check-release-security.mjs";

const asOfDate = "2026-08-24";
assert.deepEqual(inspectReleaseSecurityCandidate({ path: "assets/safe.js", content: "const schemaVersion = 1;", asOfDate }), []);
assert.equal(inspectReleaseSecurityCandidate({ path: "assets/leak.js", content: 'const payload = "daily-2026-08-25-abcdefabcdefabcd";', asOfDate })[0].kind, "future-puzzle-id");
assert.equal(inspectReleaseSecurityCandidate({ path: "functions/leak.js", content: 'const x = {"sourceSeed":"do-not-publish"};', asOfDate })[0].kind, "public-seed-field");
const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nabc";
for (const name of RELEASE_SENSITIVE_ENV_NAMES) {
  const literal = `${name}=actual-example-or-test-looking-secret-value`;
  assert.equal(inspectReleaseSecurityCandidate({ path: ".env", content: literal, asOfDate })[0]?.kind, "literal-release-secret", `${name} literal must be rejected even when it contains placeholder-looking words`);
}
const jsonSecret = `"${["POKESORT_PREVIEW_DAILY_ENVELOPE", "HMAC_KEY"].join("_")}": "literal-secret-value"`;
assert.equal(inspectReleaseSecurityCandidate({ path: "config.json", content: jsonSecret, asOfDate })[0].kind, "literal-release-secret");
const processEnvAssignment = `process.env.${["CLOUDFLARE", "ACCOUNT_ID"].join("_")} = "literal-account-value"`;
assert.equal(inspectReleaseSecurityCandidate({ path: "configure.mjs", content: processEnvAssignment, asOfDate })[0].kind, "literal-release-secret");
assert.equal(inspectReleaseSecurityCandidate({ path: "config.pem", content: privateKeyMarker, asOfDate })[0].kind, "private-key-material");
assert.deepEqual(inspectReleaseSecurityCandidate({ path: ".github/workflows/safe.yml", content: "token: ${{ secrets.CLOUDFLARE_DAILY_KV_API_TOKEN }}", asOfDate }), []);
assert.deepEqual(inspectReleaseSecurityCandidate({ path: ".github/workflows/safe.yml", content: "CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}", asOfDate }), []);
assert.deepEqual(inspectReleaseSecurityCandidate({ path: "wrangler.toml.example", content: 'id = "REPLACE_WITH_PRODUCTION_NAMESPACE_ID"', asOfDate }), []);
console.log("Release secret/future-payload mutation scan PASS.");
