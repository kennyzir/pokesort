# R3A game fairness, progressive help, and product observability

IMPLEMENTATION COMPLETE

AWAITING REVIEW

NOT MERGED

NOT DEPLOYED

## Frozen baseline

- Base SHA: `2c7e1fbebed903fd5a86259fc9a288a005c68345`
- Recovery mode: `CONTINUE_EXISTING_R3A_BRANCH`
- Branch: `codex/r3a-game-fairness-observability`
- Pre-release tag: `pre-r3a-game-fairness-observability-20260901`
- Required ancestors verified: R1 `034a8ad6002d3f362043bcc61d78b2dff843bb8a`; R2-Lite `af063f14fe2e2a50b676af3faaa6499743f9636d`
- PR: `https://github.com/kennyzir/pokesort/pull/3`
- Cloudflare Pages branch Preview: pending for the second-round head

## Delivered scope

- Added a deterministic Infinite valid-overlap sidecar contract: 1,000 puzzle records in 20 source-aligned shards plus an index. The 21 existing Infinite source files remain byte-identical to the pre-R3A snapshot.
- Runtime validates the Infinite source index/shard and overlap index/shard hashes, versions, source identity, Puzzle ID, source content hash, board IDs, signature shape, uniqueness, and intended-group exclusion before `board_ready`. Contract failures stop the game and emit only `infinite_overlap_contract`.
- Submit classification is now correct intended group, authoritative valid overlap, then invalid. Valid overlaps do not increment mistakes, end the game, lock cards, or disclose a rule or answer.
- Added state schema v2 and mode/Puzzle-isolated keys, bounded Guess History with stable repeated-guess detection and newest-first rendering, safe legacy Daily/Infinite migration, per-group progressive Hint Levels 1–3, and an independent persistent `analyticsCompletionSent` marker.
- `pokesort_game_complete` now means only a genuine four-group solve. A fourth invalid submit is represented by `pokesort_guess_submit` with `outcome=invalid` and `mistakes=4`; Reveal uses only `pokesort_reveal`.
- Added a strict Analytics helper with 11 event names and 11 allowed parameter names. Unknown fields are removed; invalid enum/number values are rejected; no IDs, names, selected cards, group/rule data, payloads, URLs, raw errors, stacks, LocalStorage, or user identifiers are emitted.
- Current Daily is embedded-first with an independently verified `payloadHash`. Missing, stale, or invalid embedded data requests the current API; stale/invalid/API failures remain fail-closed. Archive never requests the current API.
- Replaced the unsupported Eeveelution example with the published 2026-08-25 `Only Bug type` group: Caterpie, Burmy, Shelmet, and Spidops.

## Baseline evidence before source changes

Detached Worktree logs: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-baseline-logs-2c7e1fbe`

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | PASS |
| `npm run build` | 1 | KNOWN_BASELINE_FAILURE: public immutable calendar did not contain 2026-09-01 |
| `npm test` | 1 | BASELINE FAILURE: detached Worktree has no ignored private `data/puzzles/daily` directory |
| `npm run test:seo-r1` | 1 | BASELINE FAILURE: prior failed build produced no `dist/index.html` in the detached Worktree |
| `npm run test:seo-r2-lite` | 1 | BASELINE FAILURE: prior failed build produced no `dist` in the detached Worktree |
| `npm run test:static` | 1 | BASELINE FAILURE: detached Worktree has no ignored private `data/puzzles/daily` directory |
| `npm run test:runtime` | 1 | KNOWN_BASELINE_FAILURE: `data/puzzles/public-daily/2026-09-01.json` was absent |
| `npm run build:cloudflare` | 0 | PASS; fetched the approved 2026-08-26 through 2026-09-01 public history into an isolated build input |
| `npm run smoke:production` | 0 | PASS; homepage and Infinite ready, Today unavailable/noindex, 52 sitemap URLs |

To compare the eventual ordinary-suite failure at its exact gate, a second detached BASE_SHA Worktree copied only the local ignored Daily test input and ran `npm run test:production-build-gate`. It exited 1 with the same `Immutable Daily calendar does not cover the 2026-09-01 publication window` assertion as the final branch. Log: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-baseline-gate-cb5b70c8169649218f0c378d7ea647d8.log`.

## Final local evidence

Logs: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-round2-final-b8635352c9144d87b5d7b93a72712d0c`

Fixed-date gate (`POKESORT_BUILD_UTC_DATE=2026-08-25`, `POKESORT_EDGE_DAILY=1`):

| Command | Exit | Result |
| --- | ---: | --- |
| `npm run build:infinite-overlaps` | 0 | PASS; 1,000 records, 20 shards |
| `npm run test:infinite-overlaps` | 0 | PASS; deterministic and source pool byte-identical |
| `npm run build` | 0 | PASS |
| `npm run test:r3a` | 0 | PASS; sidecars, static privacy/product gates, and 33 deterministic Chromium cases |
| `npm run test:seo-r1` | 0 | PASS |
| `npm run test:seo-r2-lite` | 0 | PASS |
| `npm run test:runtime` | 0 | PASS |

Ordinary current-date commands:

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | PASS |
| `npm run build` | 1 | KNOWN_BASELINE_FAILURE unchanged: missing 2026-09-01 public immutable manifest |
| `npm test` | 1 | KNOWN_BASELINE_FAILURE unchanged at the production build gate |
| `npm run test:seo-r1` | 0 | PASS |
| `npm run test:seo-r2-lite` | 0 | PASS |
| `npm run test:static` | 1 | KNOWN_BASELINE_FAILURE unchanged at the production build gate |
| `npm run test:runtime` | 1 | KNOWN_BASELINE_FAILURE unchanged: missing 2026-09-01 public manifest |
| `npm run build:cloudflare` | 0 | PASS |
| `npm run smoke:production` | 0 | PASS; current production baseline only |

The final failure set and error signatures match the unmodified baseline. No new general-suite failure was introduced.

## Browser and privacy evidence

- Chromium Desktop: 1440×900
- Chromium Mobile: 390×844
- Routes: `/`, `/infinite/`, `/daily/2026-08-25/`, `/archive/`, `/how-to-play/`, `/pokelike-pokesort/today/`
- Local evidence: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-browser-tzAkUZ`
- Covered embedded ready with zero current API requests; valid current API fallback; Daily/Archive/Infinite valid overlap; invalid and fourth-invalid failure without `game_complete`; correct groups and solved-only completion; History cap/recovery/migration/isolation/repeated state; malformed field-local recovery; unavailable LocalStorage; Hint Levels 1–3; Reveal without completion; clipboard/native share and cancelled native share; missing/throwing `gtag`; New Infinite; stale/missing/hash-invalid embedded data; stale API data; damaged Archive without current API; missing/hash/Puzzle-ID/source-content-hash sidecar failures; no page errors; and all six mobile routes without horizontal overflow.
- Captured event parameter keys were limited to `elapsed_ms`, `error_stage`, `game_mode`, `groups_solved`, `guess_match_count`, `hint_level`, `load_ms`, `mistakes`, `outcome`, `round_number`, and `share_method`. Forbidden data found: NO.
- Cloudflare Pages Preview acceptance for the second-round head: PENDING.

## Protected-field comparison

The post-build comparison against the pre-change snapshot passed for homepage Title, Meta Description, H1, first-fold promise, canonical, `og:title`, `og:site_name`, WebSite Schema, WebApplication Schema and `isPartOf`, main navigation, `robots.txt`, sitemap URL set, Today `noindex,follow`, and Today held/unavailable state. SEO R1 and R2-Lite also passed after implementation.

## Risks and review focus

- Sidecars add approximately 2.18 MB of deterministic JSON to the built static assets. Review caching and Preview transfer behavior.
- Ordinary local builds remain date-coupled to a public current-day manifest. This is a pre-existing harness/publication-data issue; the approved Cloudflare build path succeeds with the public API history. A separate Test Harness Maintenance PR is required if ordinary local builds must pass on 2026-09-01 without changing publication data.
- Review the independent `analyticsCompletionSent` lifecycle, safe legacy migration boundaries, and fail-closed overlap contract before merge.

## Rollback

1. Use `pre-r3a-game-fairness-observability-20260901` to identify the pre-R3A baseline.
2. Before merge, close the PR.
3. After merge, use a normal revert PR.
4. Do not force-reset `main`.
5. Do not move the pre-release tag.
