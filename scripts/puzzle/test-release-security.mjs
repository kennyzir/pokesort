import assert from "node:assert/strict";
import { inspectReleaseSecurityCandidate } from "./check-release-security.mjs";

const asOfDate = "2026-08-24";
assert.deepEqual(inspectReleaseSecurityCandidate({ path: "assets/safe.js", content: "const schemaVersion = 1;", asOfDate }), []);
assert.equal(inspectReleaseSecurityCandidate({ path: "assets/leak.js", content: 'const payload = "daily-2026-08-25-abcdefabcdefabcd";', asOfDate })[0].kind, "future-puzzle-id");
assert.equal(inspectReleaseSecurityCandidate({ path: "functions/leak.js", content: 'const x = {"sourceSeed":"do-not-publish"};', asOfDate })[0].kind, "public-seed-field");
const secretAssignment = ["CLOUDFLARE_DAILY_KV_API", "_TOKEN=actual", "-secret-value"].join("");
const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nabc";
assert.equal(inspectReleaseSecurityCandidate({ path: ".env", content: secretAssignment, asOfDate })[0].kind, "literal-release-secret");
assert.equal(inspectReleaseSecurityCandidate({ path: ".env", content: ["DAILY_ENVELOPE_HMAC", "_KEY=actual", "-key-material-that-must-not-ship"].join(""), asOfDate })[0].kind, "literal-release-secret");
assert.equal(inspectReleaseSecurityCandidate({ path: "config.pem", content: privateKeyMarker, asOfDate })[0].kind, "private-key-material");
assert.deepEqual(inspectReleaseSecurityCandidate({ path: ".github/workflows/safe.yml", content: "token: ${{ secrets.CLOUDFLARE_DAILY_KV_API_TOKEN }}", asOfDate }), []);
console.log("Release secret/future-payload mutation scan PASS.");
