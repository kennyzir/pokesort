# Pokelike Today intent roadmap

Approved: 2026-08-24
Controller ledger: `docs/roadmap/EXECUTION_LEDGER.md`

## Objective

Make `/pokelike-pokesort/today/` complete the dominant Pokelike Daily Pokésort search task: identify the current official puzzle date, provide spoiler-controlled hints, reveal the verified six-Pokémon order, and explain all five adjacent links. Preserve the existing independent 4×4 Daily, Infinite, Archive, guide, worksheet, and indexed surfaces.

## Definition of done

- The current puzzle contains exactly six distinct Pokémon, five ordered link conditions, one verified solution permutation, an observed reset boundary, and auditable first-party evidence.
- A stale or unverified record is never labelled as today's answer.
- The answer and explanations are present in initial HTML and remain accessible behind user-controlled spoiler disclosure.
- Answer/hint queries route to `/pokelike-pokesort/today/`; evergreen rules remain at `/pokelike-pokesort/`; 4×4 intent remains on the existing product cluster.
- Failure of the Pokelike data pipeline blocks only the affected answer publication state and does not reduce existing product surfaces.

## Protected baseline

- Baseline commit: `9ad6ea9` on `main`, aligned with `origin/main` when this controller started.
- Nine indexable routes, 31 playable generated 4×4 date routes, three homepage sections, nine homepage game buttons, and all existing navigation destinations are protected.
- Daily, Infinite, Archive, hints, reveal, failure, share, keyboard, local storage, redirects, 404, Pokelike guide, and six-position worksheet tasks are protected.
- Existing user-owned working-tree changes, including the independent question-bank roadmap and implementation, GA4, favicon, privacy, and validation work, must be preserved and kept distinguishable from this roadmap.

## External-action limits

Approval covers repository-local research, implementation, tests, task coordination, and integration. It does not authorize commits, pushes, deployment, Cloudflare or GSC mutation, paid services, external messages, or publication.

## Authoritative phase order and Gates

### PT0 — Baseline and ownership

- Record protected routes, tasks, indexed surfaces, tests, active roadmap work, and dirty-tree ownership.
- Establish this file and a dedicated controller section in the execution ledger without replacing prior controllers.
- Gate: full current `npm test` passes and overlapping user work is enumerated and preserved.

### PT1 — Daily data feasibility

- Identify the official public puzzle surface, actual reset boundary, candidate Pokémon, five link conditions, accepted order, and evidence that can be retained for audit.
- Prefer a documented first-party endpoint or deterministic first-party state. Official rendered/client state plus an independent validator is acceptable. Third-party answer pages may only cross-check, never act as the sole production source.
- Observe at least three distinct official reset cycles before declaring the production source stable.
- Gate: three consecutive puzzles can be reconstructed with six candidates, five links, correct order, date/reset evidence, and a repeatable acquisition method. Failure blocks answer publication rather than weakening the product.

### PT2 — Contract and verifier

- Add a versioned manifest schema for date/reset, candidates, links, solution, progressive hints, provenance, observation timestamps, source hashes, and verification status.
- Validate exactly six unique candidates, exactly five supported links, a complete permutation, adjacent relation truth, and exactly one accepted solution over all 720 permutations.
- Reject missing, future, stale, zero-solution, multi-solution, or unsupported-relation records.
- Gate: positive fixtures and every rejection path pass deterministic tests without a live network dependency.

### PT3 — Acquisition and publication state machine

- Implement auditable acquisition or assisted import, normalization, retries, evidence capture, and the states `PENDING`, `EXTRACTED`, `VERIFIED`, `PUBLISHED`, `BLOCKED`, and `STALE`.
- A failed job must never relabel an earlier answer as today. The 4×4 build must remain healthy when Pokelike data is unavailable.
- Gate: at least seven consecutive shadow observations pass, including exercised acquisition-failure and validation-failure paths.

### PT4 — Today task page

- Build `/pokelike-pokesort/today/` with date, verification time, reset context, official-game CTA, no-spoiler hint, progressive hints, order reveal, and five link explanations.
- Pending/stale states must be explicit and contain no stale answer claim.
- Gate: the task is completable without a second navigation; initial HTML, 390px mobile, desktop, keyboard, screen-reader semantics, and no-JS content pass.

### PT5 — SEO and routing

- Give Today, evergreen guide, and 4×4 pages non-overlapping titles, H1s, descriptions, canonicals, navigation labels, internal anchors, and structured data.
- Add an index/sitemap route only when the verified publication policy is satisfied.
- Gate: answer-intent terms map only to Today, route/metadata/schema validators pass, and no protected indexed surface disappears.

### PT6 — Measurement and monitoring

- Add privacy-reviewed events for Today view, hint levels, answer reveal, official-game/Discord clicks, pending/stale states, and verification failures without transmitting puzzle worksheet or saved game contents.
- Record freshness and task-completion measurements; establish GSC Query × Page baselines after separately authorized access.
- Gate: event payload tests and privacy disclosures match actual behavior; unavailable external analytics evidence remains explicitly unverified.

### PT7 — Shadow and release readiness

- Require seven consecutive verified daily observations, zero stale-as-today incidents, failure drills, full static/runtime/SEO tests, visual/accessibility review, vulnerability audit, and protected-surface comparison.
- Gate: every required local Gate is PASS. External production, GSC, and field-performance evidence remain a handoff unless separately authorized.

### PT8 — Release handoff

- Prepare exact deploy, rollback, production verification, and GSC submission steps.
- Gate: no external action is performed without separate authorization.

## Publication failure policy

Missing evidence, an unknown reset boundary, an unsupported relation, ambiguity, or stale data blocks the Today answer claim. It does not authorize deleting routes, shrinking navigation, replacing the 4×4 game, or publishing a guessed answer. A blocked Today surface may show an honest unavailable state and the official Pokelike destination, but cannot be called a completed answer experience.
