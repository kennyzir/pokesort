# PokeSort question-bank and release remediation roadmap

Drafted: 2026-08-24
Approved for repository-local execution: 2026-08-24
Status: Roadmap Controller active; R0–R7 PASS locally, R8 static rollout in progress; target-account KV activation blocked
Execution ledger after approval: `docs/roadmap/EXECUTION_LEDGER.md`

## 1. Outcome

Repair the locally complete question-bank candidate so that PokeSort can truthfully provide:

- a materially new, source-backed Daily board for every UTC date;
- no public access to future Daily boards, seeds, answers, or equivalent derivation material;
- an atomic UTC day transition that does not depend on a post-midnight static deployment;
- an Infinite pool whose category and species diversity matches the public product copy;
- validators that prove semantic facts and provenance, not only hash and partition consistency;
- one fail-closed production build path used locally, in GitHub Actions, and by Cloudflare;
- stable gameplay, full published-date discovery, and preserved SEO/product surfaces.

This roadmap does not authorize a push, deployment, Cloudflare resource mutation, secret creation, GSC action, or deletion of existing product surfaces.

## 2. Protected baseline

Every phase must preserve or explicitly improve the following baseline:

- Daily, Infinite, Archive, dated puzzle pages, Pokelike guide/Today HOLD, categories, how-to, alternative, about, privacy, redirects, and real 404 behavior;
- the homepage playable board, three major homepage sections, current navigation, controls, keyboard/touch behavior, share, streak, mistakes, hints, reveal, and browser-local progress;
- all already-published Daily manifests and dated URLs, byte-for-byte unless a proven correctness defect requires a separately recorded migration;
- 1,025 pinned Pokémon facts and their reproducible provenance;
- existing noindex/index policies, canonicals, sitemap rules, structured data, analytics privacy boundaries, responsive layout, and accessibility;
- unrelated dirty-tree work. No reset, clean, bulk overwrite, or `git commit -am` release shortcut is allowed.

Baseline regression evidence must record route count, homepage section count, game controls, core tasks, published/indexed surfaces, responsive runtime, and data counts before the first implementation change.

## 3. Target architecture

```text
Pinned facts + canonical rules
             |
             v
  deterministic generator + solver + quality gate
             |
       +-----+--------------------+
       |                          |
       v                          v
Published history          Private future buffer
(public, immutable)        (Cloudflare KV, not Git)
       |                          |
       v                          v
Static dated pages       Pages Function date guard
                                  |
                         current UTC date only
                                  |
                                  v
                         Daily browser runtime
```

Recommended Cloudflare boundary:

- Keep source code, facts, rules, validators, and elapsed manifests public.
- Store a rolling 30-day validated future buffer in a private Workers KV namespace.
- Expose `/api/daily/current` and optionally `/api/daily/YYYY-MM-DD` through a narrowly routed Pages Function.
- The Function calculates UTC itself and returns only current or elapsed dates; future queries return `404` regardless of client parameters.
- Preload date-specific KV keys well before their activation date. Do not write or replace the active key at midnight. This avoids depending on KV write visibility at the boundary.
- Use the existing scheduled GitHub job after midnight to export only the newly elapsed immutable manifest into the public history and rebuild SEO pages. Gameplay availability must not depend on that later static deployment.
- Keep the current explicit unavailable state as the final fail-closed behavior when the active manifest is absent or invalid; never relabel yesterday's board.

Cloudflare documents that Pages Functions can bind KV and encrypted secrets. KV is eventually consistent and may take 60 seconds or more to expose a recent write globally, so the design deliberately preloads future date keys rather than writing at midnight. A separate Worker Cron is optional for monitoring or buffer replenishment, but date activation itself is a pure UTC read decision.

## 4. Release blockers and phase order

| Phase | Purpose | Depends on | Exit status required |
|---|---|---|---|
| R0 | Freeze unsafe publication and capture baseline | none | PASS |
| R1 | Canonical semantic validation and build gate | R0 | PASS |
| R2 | Daily quality model and regenerated private future buffer | R1 | PASS |
| R3 | Infinite diversity rebuild and truthful copy | R1 | PASS |
| R4 | Private storage and UTC edge delivery | R1, R2 | PASS locally; external binding may be conditional |
| R5 | Runtime loading/state correctness | R4 contract | PASS |
| R6 | Archive and SEO depth | R1 | PASS |
| R7 | Automation, security, observability, and release rehearsal | R2–R6 | PASS |
| R8 | Authorized production rollout and post-release verification | R7 + separate authorization | PASS |

R2, R3, and R6 may be developed independently after R1, but their accepted integrations remain sequential. R4 must not expose any private board until the R1 verifier accepts it.

## 5. Detailed phases

### R0 — Publication freeze, inventory, and protected baseline

Work:

1. Treat the fixed calendar seed and all 334 future manifests as compromised publication candidates. Do not stage or commit them.
2. Inventory tracked versus untracked puzzle assets and record which 31 dates are already elapsed as of 2026-08-24.
3. Preserve elapsed manifests and isolate future artifacts behind an explicit ignored/private path until they are regenerated.
4. Add a repository leak check that fails if a tracked Daily manifest has a date later than the build's allowed UTC publication date, or if known secret/seed markers are present.
5. Capture the product/SEO/runtime baseline in the execution ledger.

Gate R0:

- no future manifest or production seed is tracked by Git;
- leak test has positive and negative fixtures;
- all existing elapsed routes and game tasks remain present;
- current `npm test`, `npm audit --audit-level=low`, and `git diff --check` results are recorded;
- no data is deleted; displaced future artifacts have a documented recoverable location.

### R1 — Canonical semantic verifier and single production gate

Work:

1. Extract a pure canonical rule-evidence module keyed by `predicateSignature` from the pinned facts and rule model.
2. For every intended group verify:
   - the predicate exists in the canonical universe;
   - exactly the stored four members satisfy the intended quartet membership;
   - label, hint, explanation, source type, boundary, and provenance equal canonical evidence;
   - `matchingRuleEvidence` equals a fresh solver calculation;
   - the board has exactly one accepted full partition.
3. Recompute content hashes from canonicalized content; never trust a hash copied from an index.
4. Apply the same contract to Daily, Infinite, public history, private buffer inputs, and emitted shards.
5. Refactor validators so `npm run build` can invoke them without recursively invoking another build.
6. Make production `npm run build` fail before deleting or emitting `dist` when any release-data Gate fails.
7. Add mutation tests for fabricated predicate, swapped label, false hint, false provenance, member tampering, stale matching evidence, stale index hash, duplicate IDs, and malformed shard content.

Gate R1:

- every mutation fixture fails for the expected reason;
- `npm run build` itself rejects tampered Daily and Infinite inputs;
- ordinary build and test need no network access;
- no `dist` candidate is emitted after a failed validation;
- clean canonical data remains byte-stable across two builds.

### R2 — Daily quality model and secure calendar regeneration

Work:

1. Add an explicit, versioned board-quality policy rather than accepting every uniquely partitioned board.
2. Score valid-quartet count, maximum card overlap, unintended factually valid quartets, rule breadth, rule-family repetition, species familiarity/exposure, and recent-day similarity.
3. Initial acceptance targets:
   - exactly one accepted full partition;
   - `validQuartetCount` between 12 and 100;
   - maximum unintended-quartet overlap with an intended group no greater than 3 cards;
   - no consecutive species repeat and a 14-day predicate cooldown;
   - no duplicate board or exact group across the calendar;
   - at least 90% of boards fall in the calibrated easy/medium/hard ranges, with no uncontrolled extreme outliers.
4. Calibrate these thresholds through a large deterministic stress report. If a threshold is infeasible, change it only with recorded distributions and a business rationale, not merely to make tests pass.
5. Preserve all elapsed manifests. Regenerate only future dates using a secret production seed or secret precomputed input that never enters Git, logs, HTML, source maps, or client bundles.
6. Add a 30-day private ready buffer plus a minimum seven-day alert threshold.
7. Improve feedback for a quartet that shares a real canonical fact but is not part of the unique full solution: explain that it is a valid overlap that cannot complete the board instead of calling it factually unrelated.

Gate R2:

- elapsed manifests remain byte-stable;
- future buffer contains at least 30 accepted dates and no public copy;
- quality distribution and all rejection counts are emitted in a reviewable report;
- 365-day stress generation is bounded and deterministic for the same private input;
- no old board can be relabeled after generation exhaustion;
- browser tests cover intended, one-away, valid-overlap, invalid, win, reveal, and failure outcomes.

### R3 — Infinite diversity and copy integrity

Work:

1. Replace the current three-family anchor selection with a capacity-aware quota scheduler across type, exact dual type, generation, color, evolution stage, baby, legendary, and mythical rules.
2. Add rule-family, predicate, exact-group, species, and pair co-occurrence exposure counters.
3. Reject candidates that exceed configured repetition caps before accepting the next board.
4. Regenerate the 1,000-board Infinite pool and its shards only after R1 validation is active.
5. Produce a machine-readable diversity report and generate public copy from supported capability flags, so page claims cannot exceed the pool's measured coverage.

Initial Gate targets:

- all eight advertised rule families appear in intended groups;
- no single rule family exceeds 40% of the 4,000 intended groups;
- at least 80% of the 1,025 species appear in the pool;
- no species appears in more than 5% of the 1,000 boards;
- Daily boards/groups remain excluded;
- 1,000 board IDs and board signatures are unique;
- first 500 runtime selections remain unique;
- all 1,000 boards pass the canonical semantic verifier and unique-partition solver;
- visible copy exactly matches the measured rule families and finite 1,000-board behavior.

If capacity analysis proves one threshold harmful to solvability or quality, the execution ledger must show the before/after distribution and obtain a product decision before weakening the public claim.

### R4 — Private future storage and atomic UTC delivery

Repository work:

1. Add a Pages Function contract for `/api/daily/current` and `/api/daily/[date]` with a KV binding abstraction and local in-memory test adapter.
2. Calculate the authoritative date from server UTC, never from query parameters or client clock.
3. Reject future dates, invalid dates, hash failures, semantic failures, and dates without an accepted manifest.
4. Return explicit schema version, UTC date, puzzle ID, content hash, and cache policy. Ensure `/current` cannot retain yesterday across midnight; date-specific elapsed responses may be immutable.
5. Keep private keys date-addressed and immutable. A second write with different bytes must fail the preparation job.
6. Add a signed/admin-only preparation path or CI upload command; it must never return listings or future content publicly and must redact secrets/payloads from logs.
7. Keep static published history as the SEO/archive source of truth after each date elapses.

Cloudflare work requiring separate authorization:

- create production and preview KV namespaces;
- bind them to the Pages project;
- set encrypted upload/authentication secrets;
- configure the Function routes and, if chosen, a monitoring Cron Trigger;
- verify account quota/cost before activation.

Gate R4:

- simulated requests at `23:59:59.999Z` and `00:00:00.000Z` return the correct different puzzle IDs with no unavailable interval;
- requesting tomorrow returns `404` before and after cache priming;
- stale client clocks cannot select another date;
- active-key absence, invalid hash, and KV failure produce an honest unavailable response, never yesterday's board;
- preview and production namespaces are isolated;
- KV future values are preloaded at least seven days before activation, eliminating reliance on write-after-write consistency at midnight.

### R5 — Browser runtime and persistence state machine

Work:

1. Model Daily/Infinite loads explicitly as `idle → loading → ready | unavailable`.
2. Disable the old board, Submit, Hint, Reveal, and New Infinite immediately when a new request starts.
3. Abort superseded fetches and retain a monotonic request token so stale responses cannot render or write storage.
4. Bind saved state to `puzzleId + contentHash + mode`; discard incompatible/corrupt state without affecting streak history.
5. For Daily, fetch the server-authoritative current manifest and render only after R1 client-safe integrity checks; the client date is presentation context, not authority.
6. Add retry behavior that does not double-count wins, attempts, analytics, or streaks.

Gate R5:

- delayed, failed, reordered, duplicated, and aborted network tests pass;
- old boards are never interactive during loading;
- rapid New Infinite clicks render only the last accepted request;
- an UTC-boundary browser session moves to the new puzzle without reload-related corruption;
- storage recovery, Daily streak, share, keyboard, mobile, reveal, and failure regressions pass.

### R6 — Complete archive discovery and SEO truthfulness

Work:

1. Preserve the current latest-31 Archive cards as the primary recent view.
2. Add month/year archive navigation so every elapsed dated page is reachable through Home → Archive → Month → Date.
3. Keep future dates absent from HTML, APIs, sitemap, structured data, and link graphs.
4. Generate sitemap entries and `lastmod` only from immutable elapsed history.
5. Keep every dated page self-canonical and materially unique with its real board, hints, answers, explanations, ambiguity guidance, and adjacent-date navigation.
6. Update public copy and documentation to the measured Daily/Infinite capabilities produced by R2/R3.

Gate R6:

- every published date is reachable within three navigation levels from Home;
- no future URL is linked, indexed, or returns puzzle content;
- route count never drops below the elapsed baseline;
- title/H1/canonical/schema/sitemap uniqueness tests pass;
- no thin duplicate date page is indexable;
- mobile and desktop Archive navigation are browser-tested.

### R7 — Automation, security, observability, and release rehearsal

Work:

1. Replace the current single-purpose post-midnight workflow with three explicit jobs:
   - `prepare-private-buffer`: validate and preload future date keys without publishing them;
   - `publish-elapsed-history`: after UTC midnight, export only the elapsed manifest, verify immutability, rebuild static pages, and create the refresh commit;
   - `readiness-monitor`: verify current API response, buffer depth, semantic hash, archive lag, and latest successful static deployment.
2. Require the same `npm run build` Gate in local, CI, scheduled workflow, and Cloudflare build environments.
3. Add secret scanning rules for calendar seeds, future payloads, KV tokens, and admin credentials.
4. Add structured, non-sensitive diagnostics: active UTC date, puzzle ID, content hash, buffer count, oldest/newest private date, validation status, and deployment lag. Never log answers for future dates.
5. Define alerts:
   - critical: tomorrow missing or active puzzle invalid;
   - warning: private buffer below seven days;
   - warning: elapsed static archive more than one day behind;
   - critical: a future-date public response succeeds.
6. Run a local/preview release rehearsal including rollback.

Gate R7:

- tampered data, missing secret, absent binding, empty buffer, duplicate date, build failure, API failure, and deployment delay drills all fail closed;
- the active Daily remains available in the simulated post-midnight/static-deployment gap;
- no workflow log or artifact contains future answers or secrets;
- full `npm test`, production `npm run build`, vulnerability audit, leak scan, browser runtime, SEO validation, and baseline regression pass;
- a rollback restores the last valid Function/static deployment without changing or relabeling published manifests.

### R8 — Authorized rollout and post-release verification

This phase starts only after a separate explicit authorization to create/mutate Cloudflare resources and deploy.

Order:

1. Create preview KV/bindings/secrets and deploy the Function to preview.
2. Load synthetic non-production dates and run boundary/security/runtime tests.
3. Create production KV/bindings/secrets.
4. Preload and verify at least seven future dates before routing production Daily traffic to the Function.
5. Deploy the static/runtime code with a reversible feature flag.
6. Verify homepage, API date guard, Daily completion, Infinite, Archive, dated pages, sitemap, redirects, 404, mobile, and analytics privacy.
7. Observe one real UTC boundary before declaring the availability repair complete.
8. Only after the real boundary passes, enable the normal elapsed-history publication workflow.

Final release Gate:

- zero future-content exposure in black-box tests;
- correct puzzle transition across a real UTC boundary with no unavailable window;
- at least seven days of private buffer and passing readiness monitor;
- all R1–R7 Gates PASS on the exact deployed commit;
- Cloudflare deployment and Function health are directly verified;
- protected product/SEO baseline is preserved or expanded;
- execution ledger contains commit, deployment, evidence, rollback point, and remaining unverified field metrics.

## 6. Rollback policy

- Data rollback never overwrites an already-published date with different content.
- Runtime/Function rollback may return to the last valid code deployment, but it must continue reading the immutable date-addressed manifest.
- If the Function fails, show the explicit unavailable state and alert; do not serve yesterday under today's label.
- If static archive publication fails, gameplay continues from the current private manifest and the archive lag is visible to monitoring.
- If a generated future board is later rejected, replace it only while it is still private and record the old/new hashes in a private preparation receipt.
- Evidence failure blocks the affected publication claim; it does not authorize route, tool, content, or navigation deletion.

## 7. Definition of done

The remediation is complete only when:

1. future boards and production seeds are absent from public Git history and public endpoints;
2. a real UTC transition has been observed without an outage or stale board;
3. Daily and Infinite manifests pass canonical semantic validation inside production build;
4. Daily difficulty and Infinite diversity meet recorded quantitative Gates;
5. every elapsed page remains discoverable, unique, canonical, and truthfully described;
6. all protected game tasks and responsive/accessibility behavior pass regression;
7. automation, alerts, failure drills, rollback, and external Cloudflare health are verified;
8. no required Gate remains conditional, inferred, or unverified.
