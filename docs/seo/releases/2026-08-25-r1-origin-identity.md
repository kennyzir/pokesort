# PokeSort SEO Release R1 — Origin and site identity

Date: 2026-08-25

Branch: `codex/seo-r1-origin-identity`

Pre-release tag: `pre-seo-r1-20260825` → `1ee45dda914a5ddd6f38feee52aacf4716ad353e`

Implementation commit: `ba62cd8de67199883428b435267f34f55e72a608`

## Scope and baseline

This release is limited to canonical-origin normalization, site-name signals, and production monitoring. It does not implement R2, R3, Today, Dex, a title redesign, new routes, or content changes.

The supplied 24-hour baseline was 296 clicks / 1,416 impressions / 20.90% CTR / position 2.79. The `pokesort` query baseline was 248 clicks / 1,053 impressions / 23.55% CTR / position 2.18. GSC still attributed 31 clicks / 116 impressions to the HTTP homepage.

The homepage title, meta description, H1, body, and URL were not changed. The R1 static gate asserts the protected title, description, and H1, and the source diff changes only approved `<head>` identity fields and schemas.

## Modified files

- `.github/workflows/production-smoke.yml`
- `index.html`
- `manifest.webmanifest`
- `package.json`
- `scripts/build.mjs`
- `scripts/edge-worker.js`
- `scripts/pokelike/render-today.mjs`
- `scripts/seo/production-smoke.mjs`
- `scripts/seo/test-r1-static.mjs`
- `docs/seo/releases/2026-08-25-r1-origin-identity.md`

The pre-existing untracked file `docs/seo/SEO_RELEASE_RULES.md` was not modified or committed.

## Implemented behavior

- The Worker canonicalizes only `pokesort.org` and `www.pokesort.org` to `https://pokesort.org` with status 308, preserving path and query. Unapproved hosts pass through, including adversarial suffix/subdomain cases.
- Daily API routing, the legacy date redirect, and the legacy Infinite redirect retain their prior ordering and behavior.
- Site identity is `PokeSort 4×4` in `og:site_name`, `application-name`, WebSite JSON-LD, and the Today WebPage `isPartOf.name` field.
- The WebSite schema follows the WebApplication schema. Its URL remains the root homepage on Home, Infinite, and Daily builds, while each WebApplication URL and canonical point to the current page.
- The manifest name is `PokeSort 4×4 — Daily Pokémon Puzzle`; `short_name` remains `PokeSort`.
- Every generated HTML file receives exactly one `og:site_name`. The 404 output contains no WebApplication schema.
- Production smoke runs manually and at 00:25 / 12:25 UTC. It makes one initial attempt and at most six retries, waiting 60 seconds between attempts, and exits nonzero if any core check still fails.

## Test results

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | 2 packages installed; 0 vulnerabilities. |
| `npm run build` | FAIL (existing publication-date blocker) | The public Daily calendar ends at 2026-08-24, so the default 2026-08-25 build stops with `Immutable Daily calendar does not cover the 2026-08-25 publication window`. No Daily data was changed to conceal this failure. |
| `$env:POKESORT_BUILD_UTC_DATE='2026-08-24'; npm run build` | PASS | 31 persistent Daily pages, 31 Archive entries, 43 indexable routes, 1000 Infinite puzzles. |
| `npm run test:seo-r1` | PASS | 46 HTML files had exactly one `og:site_name`; Home/Infinite/Daily canonical and schema checks passed; 43 sitemap URLs used HTTPS apex; 3 redirect cases, 2 open-redirect cases, and redirect-loop checks passed; no `pokesort.example` remained in `dist`. |
| `npm test` | FAIL (same existing publication-date blocker) | All tests reached before `test:production-build-gate` passed. Its internal default build failed because 2026-08-25 is missing from the public calendar. |
| `$env:POKESORT_BUILD_UTC_DATE='2026-08-24'; npm run test:static` | PARTIAL / FAIL | Production build gate, Pokelike suites, validation, and R1 SEO static gate passed. `test:r5-runtime-state` then correctly rejected the embedded 2026-08-24 board as stale on 2026-08-25. |
| Controlled `test:r6-archive-seo` | FAIL (date-boundary mismatch) | A build pinned to 2026-08-24 still renders the held Today page using the real date 2026-08-25; R6 flags that as a future-date leak relative to the pinned build. Today behavior was not altered because it is outside R1. |
| Controlled `npm run test:r7-release` | PASS | Daily API, secret scan, workflow contract, Cloudflare automation, release rehearsal, tamper rejection, and byte-stable build gate passed. |
| Controlled `node scripts/regression.mjs` | FAIL (date-boundary mismatch) | The regression expects Archive to start on real UTC 2026-08-25, while the controlled build is pinned to 2026-08-24. Earlier Worker redirect/API and protected-surface checks passed before this assertion. |
| `node --check` on the new smoke/static scripts and Worker | PASS | No JavaScript syntax errors. |
| `npm run smoke:production` | FAIL (release not deployed / edge rule mismatch) | Full live results are recorded below. The command exited nonzero as required. |

## Production results at test time

| Check | Observed result |
| --- | --- |
| `http://pokesort.org/` | `301` → `https://pokesort.org/` (required 308, FAIL) |
| `https://www.pokesort.org/` | `308` → `https://pokesort.org/` (PASS) |
| `http://www.pokesort.org/archive/?source=production-smoke&check=origin` | `301` → same path/query on `https://www.pokesort.org` (required one-step 308 to apex, FAIL) |
| HTTPS homepage | `200` (PASS) |
| Homepage canonical | `https://pokesort.org/` (PASS) |
| Homepage `og:site_name` | Missing in the current deployment (FAIL) |
| Homepage WebSite schema | Missing in the current deployment (FAIL) |
| Sitemap | 44 live URLs; all parsed `<loc>` values use HTTPS apex (PASS) |
| robots sitemap | `https://pokesort.org/sitemap.xml` (PASS) |
| Homepage game runtime | `ready` (PASS) |
| Daily runtime dateKey | `2026-08-25`, equal to UTC current date (PASS) |

## Generated canonical and schema results

The locally generated R1 output passed these assertions:

- Home canonical and WebApplication URL: `https://pokesort.org/`
- Infinite canonical and WebApplication URL: `https://pokesort.org/infinite/`
- Daily canonical and WebApplication URL: `https://pokesort.org/daily/2026-08-24/`
- WebSite URL on all three pages: `https://pokesort.org/`
- WebSite ID: `https://pokesort.org/#website`
- WebSite name: `PokeSort 4×4`
- WebSite alternate names: `PokeSort`, `Poke Sort`, `pokesort.org`
- Exactly one WebSite schema per checked playable page
- No WebApplication schema on the generated 404 page

## Risks and release blockers

1. The release has not been pushed or deployed, so production correctly lacks the new site-name/schema signals.
2. Production HTTP is currently intercepted with a 301 before the tested Worker behavior. Deploying this commit alone may not produce HTTP 308 if a Cloudflare “Always Use HTTPS”, redirect rule, Bulk Redirect, or equivalent zone-level rule runs before the Worker. That edge configuration must be reconciled and the production smoke rerun.
3. The public Daily calendar does not contain 2026-08-25. This independently blocks the exact default `npm run build` and `npm test` commands. R1 did not alter Daily publication data or Today behavior.
4. The scheduled Workflow is intentionally fail-closed and will remain red until the R1 deployment and external HTTP redirect configuration satisfy all checks.
5. Search signals may take time to consolidate after deployment; GSC monitoring should compare HTTPS/apex and HTTP/www impressions without changing title/H1 during the R1 observation window.

## Rollback

The recoverable code rollback is:

```bash
git revert ba62cd8de67199883428b435267f34f55e72a608
```

The exact pre-release baseline is also preserved by the annotated tag `pre-seo-r1-20260825`. After rollback/deployment, rerun `npm run smoke:production`; do not claim a successful rollback until the live checks pass for the intended baseline behavior.
