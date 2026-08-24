# Pokelike Today first-party feasibility report

Observed: 2026-08-24 01:03–01:10 UTC
Scope: PT1 read-only source and reset investigation. No game answer was submitted and no external state was changed.

## Verified first-party surface

- Entry: `https://pokelike.xyz/pokesort` returned HTTP 200.
- HTML SHA-256 observed by the independent review: `ebff5e6f2820c9fe10621bdfd6531db70b766d29888a370268f44447066fceb2`.
- Versioned client: `https://pokelike.xyz/js/bundle.66f70857dc.js`.
- Bundle SHA-256: `66f70857dc1427270ca9e7787ba914bb07c29974fdb2d2b60786d724f5b49668`.
- The public client exposes `pcGeneratePuzzle`, `pcDayNumber`, `pcPuzzleNumber`, `pcCountSolutions`, `pcMon`, `POKECHAIN_CONDITIONS`, and the current `_pcState` containing `slots`, `conds`, and `solution`.
- No separate answer API was observed. The client deterministically generates and validates the puzzle from its bundled Pokédex and condition logic.

## Reset boundary

The client calibrates current time from a request to the official origin, then derives the puzzle day from the browser's local timezone offset. Reset is therefore local midnight, not a single worldwide UTC event.

At the same server-calibrated time:

| Browser timezone | Local date/time | Day | Puzzle |
|---|---|---:|---:|
| `Asia/Shanghai` | 2026-08-24 09:08 | 20689 | #54 |
| `UTC` | 2026-08-24 01:08 | 20689 | #54 |
| `America/Los_Angeles` | 2026-08-23 18:08 | 20688 | #53 |

A global static page cannot truthfully assume that every visitor means the same local date. The production design must retain adjacent local-date manifests and make the selected date/timezone explicit.

## Verified current puzzle state

For day 20689 / puzzle #54, the official client exposed:

- Start IDs: `299, 562, 679, 330, 107, 536`.
- Solution IDs: `562, 330, 107, 679, 536, 299`.
- Conditions: `stage_lt, stage_gt, color, stage_lt, gen_gt`.
- Five adjacent condition tests: all true.
- Official `pcCountSolutions`: exactly 1.
- Independently reported canonical state SHA-256: `f6cc0b83a2e4280041481e4b0bfc53de1a90d96a7d0dc4117323595f6e33d5c5`.

The solution facts observed from the same first-party client are: Yamask stage 0 < Flygon stage 2; Flygon stage 2 > Hitmonchan stage 1; Hitmonchan and Honedge are brown; Honedge stage 0 < Palpitoad stage 1; Palpitoad generation 5 > Nosepass generation 3.

## Historical reconstruction warning

The current bundle's deterministic reconstruction of puzzle #51 does not match the answer recorded by the dated third-party page from when #51 was live. This is evidence that an official client/bundle/data update can change retrospective generation. A current bundle must not be used to backfill historical answers as though it were the bundle observed on those days.

Production acquisition must capture, hash, and retain the official HTML/bundle/state while each local-date puzzle is current. Each record must include the target timezone, official server date, day/puzzle number, bundle URL/hash, start order, solution, conditions, candidate facts, uniqueness result, and canonical state hash.

## Access-policy boundary

The current official `robots.txt` allows the generic user agent and advertises reference use while disallowing several named AI/crawler agents. No documented answer API or explicit automated republication promise was found. Technical acquisition is feasible; long-term permission/terms interpretation remains unverified and must be treated as a release risk rather than silently assumed.

## PT1 conclusion

`CONDITIONAL PASS` for local engineering only:

- Verified: a repeatable first-party extraction and validation path exists; reset semantics and two simultaneously live local-date puzzles were directly observed.
- Unverified: three natural consecutive reset captures, CDN propagation behavior around midnight, seven-day shadow reliability, and explicit automated republication permission.
- Consequence: PT2 contract/verifier and a non-publishing shadow collector may proceed. Public Today answer publication remains blocked until the natural-cycle and release-policy Gates pass.
