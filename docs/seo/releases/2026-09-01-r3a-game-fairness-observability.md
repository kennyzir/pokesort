# R3A game fairness, progressive help, and product observability

IMPLEMENTATION COMPLETE

AWAITING REVIEW

NOT MERGED

NOT DEPLOYED

## Frozen baseline

- Start SHA: `2c7e1fbebed903fd5a86259fc9a288a005c68345`
- Branch: `codex/r3a-game-fairness-observability`
- Pre-release tag: `pre-r3a-game-fairness-observability-20260901`
- Required ancestors verified: R1 `034a8ad6002d3f362043bcc61d78b2dff843bb8a`; R2-Lite `af063f14fe2e2a50b676af3faaa6499743f9636d`
- PR and Preview: pending branch push and Cloudflare Pages Preview

## Delivered scope

- Added a deterministic Infinite valid-overlap sidecar contract: 1,000 puzzle records in 20 source-aligned shards plus an index. The 21 existing Infinite source files remain byte-identical to the pre-R3A snapshot.
- Runtime validates the Infinite source index/shard and overlap index/shard hashes, versions, source identity, Puzzle ID, source content hash, board IDs, signature shape, uniqueness, and intended-group exclusion before `board_ready`. Contract failures stop the game and emit only `infinite_overlap_contract`.
- Submit classification is now correct intended group, authoritative valid overlap, then invalid. Valid overlaps do not increment mistakes, end the game, lock cards, or disclose a rule or answer.
- Added state schema v2 and mode/Puzzle-isolated keys, bounded Guess History, safe legacy Daily/Infinite migration, per-group progressive Hint Levels 1–3, and an independent persistent Analytics completion marker.
- Added a strict Analytics helper with 11 event names and 11 allowed parameter names. Unknown fields are removed; invalid enum/number values are rejected; no IDs, names, selected cards, group/rule data, payloads, URLs, raw errors, stacks, LocalStorage, or user identifiers are emitted.
- Current Daily is embedded-first with an independently hashed embedded payload. Missing, stale, or invalid embedded data requests the current API; stale/invalid/API failures remain fail-closed. Archive never requests the current API.
- Replaced the unsupported Eeveelution example with the published 2026-08-25 `Only Bug type` group: Caterpie, Burmy, Shelmet, and Spidops.

## Baseline evidence before source changes

Logs: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-baseline-9ea422d2261b4ebeb953c25d3c234f93`

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | PASS |
| `npm run build` | 1 | KNOWN_BASELINE_FAILURE: public immutable calendar did not contain 2026-09-01 |
| `npm test` | 1 | KNOWN_BASELINE_FAILURE: production build gate reached the same missing 2026-09-01 publication window |
| `npm run test:seo-r1` | 0 | PASS |
| `npm run test:seo-r2-lite` | 0 | PASS |
| `npm run test:static` | 1 | KNOWN_BASELINE_FAILURE: production build gate reached the same missing 2026-09-01 publication window |
| `npm run test:runtime` | 1 | KNOWN_BASELINE_FAILURE: `data/puzzles/public-daily/2026-09-01.json` was absent |
| `npm run build:cloudflare` | 0 | PASS; fetched the approved 2026-08-26 through 2026-09-01 public history into an isolated build input |
| `npm run smoke:production` | 0 | PASS; homepage and Infinite ready, Today unavailable/noindex, 52 sitemap URLs |

## Final local evidence

Logs: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-final-e4a37ea563bc486eb45f41439d0b4adf`

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | PASS |
| `npm run build` | 1 | KNOWN_BASELINE_FAILURE unchanged: missing 2026-09-01 public immutable manifest |
| `npm run test:r3a` | 0 | PASS: 1,000 sidecars, static privacy/product gates, and 27 Chromium cases |
| `npm test` | 1 | KNOWN_BASELINE_FAILURE unchanged at the production build gate |
| `npm run test:seo-r1` | 0 | PASS |
| `npm run test:seo-r2-lite` | 0 | PASS |
| `npm run test:static` | 1 | KNOWN_BASELINE_FAILURE unchanged at the production build gate |
| `npm run test:runtime` | 1 | KNOWN_BASELINE_FAILURE unchanged: missing 2026-09-01 public manifest |
| `npm run build:cloudflare` | 0 | PASS |

The final failure set and error signatures match the unmodified baseline. No new general-suite failure was introduced.

## Browser and privacy evidence

- Chromium Desktop: 1440×900
- Chromium Mobile: 390×844
- Routes: `/`, `/infinite/`, `/daily/2026-08-25/`, `/archive/`, `/how-to-play/`, `/pokelike-pokesort/today/`
- Local evidence: `C:\Users\zire\AppData\Local\Temp\pokesort-r3a-browser-Ouw9H2`
- Covered embedded ready with zero current API requests; Daily/Archive/Infinite valid overlap; invalid and fourth-invalid failure; correct groups and completion; History cap/recovery/migration/isolation; Hint Levels 1–3; Reveal; clipboard share and cancelled native share; New Infinite; stale/missing/invalid embedded data; stale API data; missing/hash/Puzzle-ID sidecar failures; and all six mobile routes without horizontal overflow.
- Captured event parameter keys were limited to `elapsed_ms`, `error_stage`, `game_mode`, `groups_solved`, `guess_match_count`, `hint_level`, `load_ms`, `mistakes`, `outcome`, `round_number`, and `share_method`. Forbidden data found: NO.

## Protected-field comparison

The post-build comparison against the pre-change snapshot passed for homepage Title, Meta Description, H1, first-fold promise, canonical, `og:title`, `og:site_name`, WebSite Schema, WebApplication Schema and `isPartOf`, main navigation, `robots.txt`, sitemap URL set, Today `noindex,follow`, and Today held/unavailable state. SEO R1 and R2-Lite also passed after implementation.

## Risks and review focus

- Sidecars add approximately 2.18 MB of deterministic JSON to the built static assets. Review caching and Preview transfer behavior.
- Ordinary local builds remain date-coupled to a public current-day manifest. This is a pre-existing harness/publication-data issue; the approved Cloudflare build path succeeds with the public API history. A separate Test Harness Maintenance PR is required if ordinary local builds must pass on 2026-09-01 without changing publication data.
- Review the independent `analyticsCompletionRecorded` lifecycle, safe legacy migration boundaries, and fail-closed overlap contract before merge.

## Rollback

1. Use `pre-r3a-game-fairness-observability-20260901` to identify the pre-R3A baseline.
2. Before merge, close the PR.
3. After merge, use a normal revert PR.
4. Do not force-reset `main`.
5. Do not move the pre-release tag.
