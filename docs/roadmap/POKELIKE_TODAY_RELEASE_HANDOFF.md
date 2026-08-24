# Pokelike Today release handoff

Status at 2026-08-24 (Asia/Shanghai): **BLOCKED — do not publish or index**.

The repo-local readiness monitor reports `0/7` consecutive evidence-backed dates, no latest evidence, and `localGate: "BLOCKED"`. The two simulated failure drills pass, but simulations do not count as official observations. There is also no documented permission to automate or republish Pokelike's puzzle answers/data. Technical accessibility of the public client is not republication permission. The user has authorized repository-local implementation and testing only; no commit, push, Cloudflare change, deployment, GSC action, external message, or publication is authorized.

This runbook is a handoff, not a release approval. Keep `/pokelike-pokesort/today/` in its current honest unavailable, `noindex,follow`, sitemap-excluded state until every Gate below passes and the relevant external action is separately authorized.

## Current evidence state

| Item | State | Meaning |
| --- | --- | --- |
| Asia/Shanghai live shadow run | **BLOCKED: 0/7** | Seven consecutive natural local dates ending on the monitored date are required. |
| Acquisition-failure drill | PASS (simulated) | Controlled offline failure reaches `BLOCKED`; it is not first-party evidence. |
| Stale-record drill | PASS (simulated) | Controlled clock advance reaches `STALE`; it is not first-party evidence. |
| Manifest/verifier/renderer/runtime tests | Implemented locally | Re-run the matrix below against the final release candidate. |
| Automated-republication/source policy | **UNVERIFIED / risk unresolved** | No explicit permission is claimed. Resolve before public answer publication. |
| GA4 observed Today events | UNVERIFIED | Code contract exists; production observation requires separate analytics authorization. |
| GSC Query × Page / selected canonical | UNVERIFIED | Requires separate GSC access and action authorization. |
| Field performance | UNVERIFIED | Requires a production release and field data. |

Reproduce the status without network mutation:

```powershell
npm run monitor:pokelike-readiness -- --timezone Asia/Shanghai
```

The release Gate is determined by the JSON fields, not merely by the command's process exit code. Require `consecutiveVerifiedDays >= 7`, `endsOnExpectedDate: true`, `freshnessPass: true`, both valid failure drills, no invalid records, and `localGate: "PASS"`.

## Seven-natural-day shadow schedule

Owner: a named release operator with authority to make read-only requests to the public official page and to retain repo-local evidence. The current clean window is **2026-08-25 through 2026-08-31**, one capture per Asia/Shanghai natural date at **00:10 CST (UTC+08:00)**. This begins after the next local reset because the 2026-08-24 ledger is currently empty. Do not synthesize or backfill a missed date using a newer bundle; restart the seven-date run after any gap or invalid date.

At each scheduled time, from the repository root, run exactly:

```powershell
npm ci
npm run capture:pokelike-shadow -- --timezone Asia/Shanghai --samples 2 --interval-ms 2000 --retries 3 --retry-delay-ms 1000 --write
npm run monitor:pokelike-readiness -- --timezone Asia/Shanghai --expected-local-date YYYY-MM-DD --max-age-hours 26
```

Replace only `YYYY-MM-DD` with the row's date:

| Local execution time | Monitor date |
| --- | --- |
| 2026-08-25 00:10 Asia/Shanghai | `2026-08-25` |
| 2026-08-26 00:10 Asia/Shanghai | `2026-08-26` |
| 2026-08-27 00:10 Asia/Shanghai | `2026-08-27` |
| 2026-08-28 00:10 Asia/Shanghai | `2026-08-28` |
| 2026-08-29 00:10 Asia/Shanghai | `2026-08-29` |
| 2026-08-30 00:10 Asia/Shanghai | `2026-08-30` |
| 2026-08-31 00:10 Asia/Shanghai | `2026-08-31` |

`--write` creates an immutable file with `wx` under `data/pokelike/shadow/Asia__Shanghai/<local-date>/`. It will not overwrite evidence. A valid record retains two official samples, response and bundle hashes, a consistency hash, the complete state transitions, official/local solution counts of one, and the 720-permutation check.

After every capture:

1. Confirm the command prints one new path under the expected local-date directory.
2. Read the file and monitor JSON; do not edit either. Review `status`, `manifest.localDate`, `manifest.timezone`, `samples`, `consistencySha256`, `verification`, and `transitions`.
3. Require `status: "VERIFIED"`, exactly two mutually consistent retained samples, `officialSolutionCount: 1`, `localSolutionCount: 1`, and `permutationsChecked: 720`.
4. If the record is `BLOCKED`/`STALE`, the date is wrong, hashes differ, or a capture is missed, retain the evidence as-is and restart the consecutive window on the next successful natural date. Never hand-correct a record.
5. Review changes with `git diff -- data/pokelike/shadow` and `git status --short`; do not use an editor or formatter on evidence JSON.

Optional reset-boundary observation is read-only and must not replace the scheduled retained capture: run the capture command without `--write` shortly before local midnight, then perform the normal retained capture at 00:10. Preserve terminal output separately if the reset edge is part of the review record.

## Drills, tests, audits, and monitor

Generate the deterministic failure-drill files only if they do not already exist. The writer refuses overwrite:

```powershell
npm run generate:pokelike-drills -- --write
```

Routine local checks:

```powershell
npm run test:pokelike-manifest
npm run test:pokelike-capture
npm run test:pokelike-today
npm run test:pokelike-analytics
npm run test:pokelike-drills
npm run monitor:pokelike-readiness -- --timezone Asia/Shanghai
npm run validate:pokelike-intent
npm test
npm audit --audit-level=high
git status --short
```

`npm audit` contacts the npm registry but does not modify dependencies. Record its dated result; do not run `npm audit fix` as a release shortcut. `npm test` is the complete local Gate and launches real Chrome; `npm run test:static` is not a substitute.

## Explicit authorization checkpoints

Stop and obtain a specific approval at each checkpoint; one approval does not imply the next:

1. **Source/policy approval:** documented review of Pokelike terms, robots/source policy, trademark attribution, caching/evidence retention, answer republication, and automated daily access. If permission is absent or unclear, keep the held surface. Technical feasibility is insufficient.
2. **Record publication approval:** approval for one exact current `VERIFIED` evidence file, its date/timezone, and a durable publication evidence reference.
3. **Indexing code approval:** approval to make the small policy/test changes described below. This is separate from marking data `PUBLISHED`.
4. **Commit and push approval:** approval for the exact reviewed diff and target branch. Concurrent user-owned changes must not be swept into the commit.
5. **Cloudflare deployment/configuration approval:** approval for the exact Pages environment variables and deployment candidate.
6. **GSC approval:** approval to inspect Query × Page, submit the sitemap/URL, or request indexing.
7. **GA4 approval:** approval to inspect production events/reports. No worksheet or saved-game contents may be added to event payloads.

## VERIFIED to PUBLISHED transition

Only after checkpoints 1 and 2, and only for a record that is current at the execution instant, use the existing immutable transition command. Use explicit paths and a durable evidence reference; never overwrite the source file:

```powershell
$verifiedRecord = "data/pokelike/shadow/Asia__Shanghai/YYYY-MM-DD/<exact-file>.verified.json"
$publishedRecord = "data/pokelike/published/Asia__Shanghai/YYYY-MM-DD/<new-file>.published.json"
New-Item -ItemType Directory -Path (Split-Path -Parent $publishedRecord) -Force | Out-Null
npm run mark:pokelike-published -- --input $verifiedRecord --output $publishedRecord --evidence "<approved-policy-and-publication-record-reference>"
```

The command revalidates retained samples, hashes, transition order, freshness, exact reconstruction, official/local uniqueness counters, and the manifest before writing with `wx`. It fails closed if the input is stale, tampered, invalid, already published, or the output exists. Review the resulting file with the verifier/tests and `git diff`; do not hand-edit status or timestamps.

Because freshness is date-bound, the final transition, build, and deploy must happen while that record is still current for Asia/Shanghai. If it becomes stale, retain it for audit and use the next verified record.

## Build configuration

Default/held production build (current safe behavior):

```powershell
Remove-Item Env:POKELIKE_TODAY_MANIFESTS -ErrorAction SilentlyContinue
Remove-Item Env:POKELIKE_TODAY_PREVIEW -ErrorAction SilentlyContinue
$env:SITE_URL = "https://pokesort.org"
npm run build
```

This must emit an unavailable Today page with no answer payload, `noindex,follow`, and no Today sitemap entry.

Private local preview of a `VERIFIED` record:

```powershell
$env:SITE_URL = "https://pokesort.org"
$env:POKELIKE_TODAY_MANIFESTS = "data/pokelike/shadow/Asia__Shanghai/YYYY-MM-DD/<exact-file>.verified.json"
$env:POKELIKE_TODAY_PREVIEW = "1"
npm run build
npx serve dist
```

Preview must remain `PRIVATE PREVIEW` and `noindex,follow`. Never set `POKELIKE_TODAY_PREVIEW=1` in Cloudflare Pages.

Production data build, only after checkpoints 1–5 and the indexing implementation Gate:

```powershell
$env:SITE_URL = "https://pokesort.org"
$env:POKELIKE_TODAY_MANIFESTS = "data/pokelike/published/Asia__Shanghai/YYYY-MM-DD/<exact-file>.published.json"
Remove-Item Env:POKELIKE_TODAY_PREVIEW -ErrorAction SilentlyContinue
npm run build
```

`POKELIKE_TODAY_MANIFESTS` accepts a comma- or semicolon-separated list. Configure only reviewed `PUBLISHED` files needed for the intended timezone/date behavior. The browser hides an answer when its local date differs; never use an adjacent date as “Today.” A missing, unreadable, stale, future, tampered, or merely `VERIFIED` production record must render the unavailable state.

## Indexing changes held behind the Gate

Do **not** make these changes until the seven-day monitor passes, source/policy risk is resolved, and checkpoint 3 is approved. The current implementation intentionally keeps even a rendered `PUBLISHED` record `noindex` and out of the sitemap.

Make the eventual change as an explicit release policy, ideally `POKELIKE_TODAY_INDEX=1`, which is accepted only when the renderer state is `published` and the current readiness receipt is PASS. Then update together:

- `scripts/pokelike/render-today.mjs`: make the robots directive state-aware. `unavailable` and `preview` stay `noindex,follow`; only a current, validated `PUBLISHED` page under the explicit release policy omits `noindex` (or emits `index,follow`).
- `scripts/build.mjs`: render/evaluate Today before final sitemap generation and append `/pokelike-pokesort/today/` only when the same explicit index policy and `todayPage.state === "published"` both pass. Do not change or remove any existing route.
- `scripts/pokelike/validate-intent-routing.mjs`: retain the default held assertions and add a separate release-mode assertion for current published initial HTML, indexability, self-canonical URL, and exactly one Today sitemap entry.
- `scripts/validate.mjs`, `scripts/regression.mjs`, `scripts/pokelike/test-today-render.mjs`, and runtime tests: preserve fail-closed default tests and add release-mode tests. Replace hard-coded “always absent/noindex” assertions only with dual held-versus-approved-release assertions.
- `pokelike-pokesort/index.html` and its tests: only after release, replace the honest “publication currently held” label with an accurate current-answer label; keep evergreen guide metadata separate from answer intent.
- `docs/seo/02-keyword-intent-map.csv`, its Markdown companion, and `docs/seo/03-rejected-page-ideas.md`: change Today answer terms from `HOLD` to the reviewed release decision, with the Gate receipt. Do not rewrite unrelated keyword decisions.

The release diff must prove all protected routes, 4×4 tasks, guide/worksheet, Archive, Infinite, privacy, analytics, and navigation remain intact.

## Local preflight matrix

| Scenario | Build input | Required result |
| --- | --- | --- |
| Default held | no Pokelike env vars | unavailable; no answer names/payload; `noindex,follow`; absent from sitemap |
| Bad configured path | nonexistent manifest path | `build_failed` unavailable; no answer payload; noindex |
| VERIFIED private preview | verified path + `POKELIKE_TODAY_PREVIEW=1` | complete six-order/five-link HTML; `PRIVATE PREVIEW`; noindex |
| VERIFIED production attempt | verified path, no preview flag | rejected/unavailable; no answer payload; noindex |
| Current PUBLISHED, release flag off | published path | rendered data may be reviewed, but remains held from indexing under current policy |
| Current PUBLISHED, approved release flag on (future implementation) | published path + explicit index flag | published initial HTML; self-canonical; indexable; exactly one sitemap entry |
| Stale/future/tampered PUBLISHED | invalid test fixture | unavailable; no leaked answer; noindex; no sitemap entry |
| Browser local-date mismatch | valid page viewed in another local date | answer replaced with explicit unavailable state; official CTA remains |
| 390px / desktop / keyboard / no-JS | preview/release candidate | readable, disclosures operable, six order and five explanations accessible; no silent other-date substitution |
| Protected baseline | all builds | nine protected indexable routes plus existing dated 4×4 routes remain; no route/task deletion |

For each scenario, archive the command, env values with secrets omitted, monitor output, test output, and relevant generated HTML diff. Do not archive GA identifiers as proof of event delivery.

## Cloudflare Pages Git deployment (not executed)

The current workflow is Git-driven: Cloudflare Pages builds `main`; `npm run build` produces `dist`; `SITE_URL=https://pokesort.org`; Pages Advanced Mode serves `_worker.js`. The daily archive workflow at `.github/workflows/daily-archive-refresh.yml` runs at 00:05 UTC, tests, then pushes an empty `main` commit that triggers Pages. A Pokelike release must account for this automatic rebuild and ensure the configured PUBLISHED record cannot become stale-as-today on the next build.

After checkpoints 1–5 only:

1. Freeze and enumerate the exact release diff. Attribute concurrent question-bank, GA4, favicon, privacy, and validation work to their owners; exclude unrelated work from the release commit unless explicitly included.
2. Run the full local matrix and record the Asia/Shanghai readiness PASS receipt.
3. In Cloudflare Pages, set `SITE_URL=https://pokesort.org`, set `POKELIKE_TODAY_MANIFESTS` to the reviewed repo-relative PUBLISHED file(s), ensure `POKELIKE_TODAY_PREVIEW` is absent, and set the future explicit index flag only after its code Gate passes. This is an external mutation requiring approval.
4. Commit only the reviewed paths and push the approved commit to `main`. This triggers the Pages Git integration. Do not manually run the daily archive workflow as a substitute for release review.
5. Wait for the exact Cloudflare Pages deployment associated with that commit to complete successfully. Record commit SHA, deployment ID/URL, start/end time, environment configuration names (not secret values), and build logs.
6. Run the production verification below before treating the release as healthy.

The capture/publish lifecycle is not yet automated in the existing daily workflow. Do not add automatic live capture/publication without a separately reviewed source-policy decision, evidence retention design, and fail-closed deployment design.

## Production verification

Against `https://pokesort.org/pokelike-pokesort/today/`, verify:

- HTTP 200 and the expected `data-today-state`; no CDN copy from an earlier date.
- One self-canonical URL and matching `og:url`.
- Published state has no `noindex`; unavailable/preview/mismatch states remain noindex. `robots.txt` does not block the route.
- `sitemap.xml` contains exactly one Today URL only for the approved published/indexed state; protected routes remain present.
- The initial HTML contains exactly six `data-answer-position` items and five `data-link-explanation` items only for the current approved date.
- `data-puzzle-date`, visible date, record timezone, and the official game's displayed local date agree in Asia/Shanghai. Test at least Asia/Shanghai, UTC, and America/Los_Angeles browser timezones; a different local date must hide the answer, never show stale content as Today.
- 390×844 mobile and desktop layouts, keyboard disclosure controls, focus visibility, screen-reader labels/status, and no-JS warning.
- Official-game link works; non-affiliation and date/reset limitations are visible.
- Existing Daily, Infinite, Archive, dated route, Pokelike guide/worksheet, privacy, redirects, 404, and navigation still work.
- Events contain only the reviewed low-cardinality contract: `pokelike_today_view`, `pokelike_today_hint_open`, `pokelike_today_answer_reveal`, `pokelike_today_official_click`, `pokelike_today_community_click`, and `pokelike_today_unavailable`. Confirm no Pokémon names/order, worksheet values, saved game, query string, or free text is transmitted.

Useful read-only HTTP checks after deployment:

```powershell
$today = Invoke-WebRequest -Uri "https://pokesort.org/pokelike-pokesort/today/" -UseBasicParsing
$robots = Invoke-WebRequest -Uri "https://pokesort.org/robots.txt" -UseBasicParsing
$sitemap = Invoke-WebRequest -Uri "https://pokesort.org/sitemap.xml" -UseBasicParsing
$today.StatusCode
($today.Content | Select-String 'data-today-state|data-puzzle-date|canonical|robots|data-answer-position|data-link-explanation')
($robots.Content | Select-String 'pokelike-pokesort/today|Sitemap')
($sitemap.Content | Select-String '/pokelike-pokesort/today/')
```

These string checks supplement, not replace, the real-browser and protected-surface regression tests.

## Rollback / fail closed

Any wrong date, stale-as-today result, hash/verification issue, missing answer elements, unexpected indexing state, broken protected surface, or policy objection triggers rollback. Do not delete the Today route, evergreen guide, 4×4 game, navigation, or evidence.

With explicit Cloudflare authorization, choose the fastest recoverable action:

1. Roll back the Pages production alias to the last known-good held deployment, **or** clear `POKELIKE_TODAY_MANIFESTS` and the future index flag and deploy a reviewed held build.
2. Confirm Today renders `data-today-state="unavailable"`, contains no answer payload, is `noindex,follow`, and is absent from the sitemap.
3. Retain the failed evidence and deployment receipt; mark the incident in the release ledger. Never edit or delete evidence to make the monitor pass.
4. Re-run protected-product regression and production verification. The independent 4×4 and evergreen Pokelike surfaces must remain available.

A data-source or freshness failure rolls back the claim/publication state only. It never authorizes shrinking the product.

## GSC and GA4 follow-up (separate authorization)

After a stable, authorized indexed deployment:

- GSC: inspect URL status and Google-selected canonical for Today; submit the existing sitemap or request indexing only with checkpoint 6 approval. Save a pre/post Query × Page export for answer/hint variants and confirm they consolidate on Today without cannibalizing `/pokelike-pokesort/` or 4×4 routes. Do not claim ranking improvement before data exists.
- GA4: with checkpoint 7 approval, verify Today events in DebugView/Realtime and then standard reporting. Compare Today views, progressive hint use, answer reveals, official handoffs, and unavailable states. Validate payload cardinality/privacy; do not add puzzle content or local storage to events.
- Field data: review mobile performance and errors only after enough real traffic exists; retain `UNVERIFIED` until then.

## Ownership and handoff conclusion

No commit, push, deployment, Cloudflare/GSC/GA4 mutation, external message, or public release was performed by PT8. The working tree contains concurrent user-owned question-bank, GA4, favicon, privacy, validation, and prior roadmap work; preserve it and assign every changed path before any commit.

Verified: the current monitor is BLOCKED at 0/7; deterministic failure drills exist; the repo has fail-closed manifest, capture, publication, renderer, event-contract, monitor, and test commands; the present default build holds Today noindex and outside the sitemap; Cloudflare Pages is connected through the documented Git workflow.

Inferred: a seven-day live run plus policy approval can make the technical release candidate reviewable, but that does not establish legal/source permission or production correctness.

Unverified: explicit republication/automation permission, seven natural reset cycles, final indexed release code, Cloudflare production configuration for Today, deployed behavior, GA4 delivery, GSC Query × Page/canonical selection, and field performance.

**PT8 Gate recommendation: PASS for handoff completeness; overall Pokelike Today release remains BLOCKED.**
