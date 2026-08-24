# PokeSort question-bank rebuild roadmap

Approved: 2026-08-24
Controller ledger: `docs/roadmap/EXECUTION_LEDGER.md`

## Product objective

Daily must publish a materially new, immutable, solvable 4×4 Pokémon grouping puzzle for each UTC date. Infinite must draw from a large validated space instead of rotating the Daily calendar. Existing routes, controls, local progress, Archive navigation, Pokelike guide, accessibility, and SEO safeguards remain protected.

## Confirmed starting fault

- `assets/puzzle-data.js` contains three complete packs.
- `assets/game.js` selects both Daily and Infinite with `GROUPS[hash(seed) % GROUPS.length]`.
- The rolling 31-date Archive therefore exposes only three semantic boards.
- Rebuilding or redeploying after midnight changes date labels and routes but does not create puzzle content.

The existing twelve authored groups remain valid editorial content and regression fixtures. Insufficient scale is a reason to replace the selection architecture, not to delete those groups or any user-facing surface.

## Target architecture

1. A versioned, locally cached Pokémon fact snapshot supplies deterministic IDs, names, types, generation, species classifications, color, and evolution relationships.
2. Machine-readable category predicates enumerate eligible Pokémon and produce a human-readable label, hint, explanation template, boundary, and provenance.
3. A deterministic generator selects four disjoint candidate groups and a solver enumerates valid four-group partitions over the 16 cards.
4. Only boards with exactly one accepted partition and complete evidence are published.
5. Accepted Daily manifests are stored by UTC date and become immutable once published.
6. Infinite uses a separate validated manifest pool; a future Cloudflare Worker/D1 service may replenish it, but the first release must work without a live data dependency.

## Required manifest fields

- stable `puzzleId`, UTC `date` when applicable, schema version, generator version, and content hash;
- 16 unique Pokémon cards with stable IDs and display names;
- four intended groups, each with a predicate signature, four members, label, hint, explanation, and provenance references;
- solver result, solution count, difficulty metrics, and rejection/audit metadata;
- generation timestamp for unpublished assets only; published date content must not receive synthetic freshness changes.

## Phase Gates

### QB1 — Facts and category model

- Broad Generation I–IX coverage from a reproducible, versioned source snapshot.
- Runtime and production builds require no live network request for facts.
- At minimum: type, exact dual type, generation, color, evolution stage, baby, legendary, and mythical predicates.
- Every category family declares source type and known boundaries.
- Schema and predicate enumeration tests pass.

### QB2 — Generator and uniqueness solver

- Deterministic output for a given seed and data/generator version.
- Exactly 16 unique Pokémon and four groups of four.
- Exactly one accepted full partition under the published category universe.
- Bounded retries and explicit failure; no fallback to an old board under a new ID.
- No duplicate full-board signature or exact group signature in an accepted batch.
- Batch stress test records attempted, accepted, ambiguous, duplicate, and exhausted counts.

### QB3 — Immutable Daily calendar

- At least 365 distinct accepted manifests.
- No full-board or exact group signature duplication across the calendar.
- No Pokémon repeats on consecutive Daily boards; category and member reuse is scored and cooled across a rolling window.
- Past manifests remain byte-stable across rebuilds.
- Archive and dated HTML read manifest data; future dates are not published or indexed.

### QB4 — Infinite

- At least 1,000 accepted Infinite manifests at release.
- Infinite selection is independent from the Daily date mapping.
- A 500-round runtime regression sees no repeated puzzle ID or full-board signature.
- Local progress, New Infinite, share, failure/reveal, and storage recovery continue to work.

### QB5 — SEO and release readiness

- Dated pages contain their real board, progressive hints, four answers, explanations, overlap guidance, and navigation in initial HTML.
- Only materially unique, 200, self-canonical pages may enter the sitemap.
- Static SEO, product regression, real-browser runtime, build, vulnerability, and dirty-tree checks pass.
- Route count, homepage depth, controls, navigation destinations, information depth, responsive behavior, and indexed surfaces are compared with the protected baseline.
- Push, deployment, Cloudflare resource creation, and GSC actions require separate authorization.

## Publication failure policy

Generation, evidence, ambiguity, or repetition failures block the affected manifest and release claim. They do not authorize deleting routes or reducing existing product functionality. A failed Daily preparation job must surface the missing-board state or use an already validated unpublished buffer; it must never relabel a previous puzzle as a new day.
