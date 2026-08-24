# R5 browser runtime and state-machine evidence

Date: 2026-08-24 UTC
Scope: repository-local implementation and tests only.

## Runtime contract

- Puzzle loading follows `idle → loading → ready | unavailable` and exposes the current state on `#puzzle-grid[data-load-state]`.
- Starting a request immediately disables the existing board, Submit, Shuffle, Deselect, Reveal, Hint, and New Infinite controls.
- Every load receives a monotonic token and an `AbortController`. Superseded requests are aborted, and a late response cannot render or mutate storage.
- Saved state is accepted only when `mode`, `puzzleId`, and `contentHash` all match the active verified puzzle. Corrupt or incompatible state is discarded without changing the wins history.
- Completion side effects are guarded by `completionRecorded`; reloads and retries cannot write a second Daily win.
- An unavailable request renders an explicit Retry control and never substitutes another board.

## Reversible edge-Daily feature flag

The browser edge path is enabled only when a build runs with `POKESORT_EDGE_DAILY=1`, which emits `<meta name="pokesort-edge-daily" content="enabled">`. The default build emits no flag and continues using the validated embedded Daily manifest without requesting `/api/daily/current`.

When enabled on the homepage, the runtime loads `/api/daily/current` with `cache: no-store`, accepts the server UTC date, validates schema/cardinality/partition/unique-solution/quality/private-material boundaries, recomputes the canonical SHA-256 manifest hash, and schedules a reload just after the next UTC midnight. Archived dated routes always retain their immutable embedded manifest.

This default-off policy is required because the authenticated Wrangler account cannot currently create or bind KV in the target Cloudflare account. A deployment without the binding therefore cannot make the homepage unavailable.

## Test evidence

- Feature flag OFF: embedded Daily reaches `ready`, with zero Daily API requests.
- Feature flag ON: delayed, failed, reordered, duplicated, aborted, retry, deep manifest tamper, storage hash mismatch, and UTC date transition scenarios pass.
- A superseded request is observed aborted and only the last monotonic request renders.
- Rapid Infinite requests settle on the final round.
- Two reloads after completion leave the Daily win-write count at exactly one.
- `npm test` passes the complete static, semantic, build, SEO, R5/R6, regression, and Chrome 390×844 suites.
