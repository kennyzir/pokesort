# R6 Archive and SEO evidence

Date: 2026-08-24 UTC
Scope: repository-local implementation only; no commit, push, deploy, or external mutation.

## Public elapsed-history boundary

Production builds now read `data/puzzles/public-daily`, a tracked source containing only manifests whose UTC publication date has elapsed. The ignored `data/puzzles/daily` calendar remains a recoverable private candidate source and is not required by a clean CI build.

The 31 protected elapsed boards, group memberships, labels, hints, explanations, provenance, solver evidence, and board signatures are unchanged. Their private candidate files also remain byte-for-byte unchanged. The new public copies intentionally remove `sourceSeed`, then recompute `boardContentHash`, `contentHash`, and `puzzleId`. This narrow identifier migration is required to avoid committing the compromised deterministic calendar seed; it does not change any playable board or dated URL. Publication leak and semantic Gates reject future dates, seed fields, stale hashes, index mismatches, gaps, and non-unique solutions.

## Discovery and index policy

- `/archive/` retains the latest 31 cards as its primary view.
- Year pages group the immutable public history by year.
- Month pages link every elapsed dated route, giving `Home → Archive → Month → Date` discovery in three link transitions.
- Dated pages are self-canonical and contain the exact board, progressive hints, four answer explanations, solver-backed ambiguity guidance, and adjacent-date navigation.
- Sitemap Daily and Archive entries are derived only from the public elapsed-history index. Date and Archive `lastmod` values are immutable elapsed dates. Future routes remain absent from HTML and sitemap output.

## Capability-copy contract

Infinite copy consumes measurements returned by the R3 production-data Gate. Only measured pool size, no-repeat rounds, and covered advertised families can be rendered. If no passing diversity measurement is available, family claims fail closed. Unsupported or mismatched capability reports are rejected.

## Verification

- `npm run test:public-daily-history` — PASS (31 immutable elapsed manifests; future mutation rejected).
- `npm run test:public-capabilities` — PASS (fallback, measured capabilities, unsupported claim rejection).
- `npm run test:publication-leaks` — PASS, including tracked public-history future fixture.
- `node scripts/validate.mjs` — PASS for 43 unique canonical/indexable routes after R3 stabilization.
- `npm run test:r6-archive-seo` — PASS: all 31 dates reachable through two month pages; future HTML/sitemap dates absent.
- `node scripts/regression.mjs` — PASS before the last R3 pool refresh; the controller will rerun the unified Gate on the integrated tree.
