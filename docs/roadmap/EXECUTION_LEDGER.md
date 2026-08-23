# PokeSort SEO Roadmap Execution Ledger

Controller started: 2026-08-23 (Asia/Shanghai)

Authoritative roadmap: the eight-phase roadmap approved by the user in this Codex task. This ledger is updated only after main-worktree verification.

## Protected product baseline

Baseline commit: `2150c42` (`main`, aligned with `origin/main` at controller start).

- Six original public source pages: `/`, `/archive/`, `/how-to-play/`, `/pokesort-alternative/`, `/pokesort-down/`, `/privacy/`.
- Homepage keeps the playable Daily board before supporting content.
- Daily, Infinite query-state, and Archive selection tasks remain available.
- Twelve authored groups arranged as three complete four-by-four puzzle packs.
- Local progress, Infinite round, solved groups, mistakes, Daily wins, and streak state remain browser-local.
- Shuffle, Hint, Reveal, Submit, Deselect, Share, New Infinite, touch/click, keyboard arrows, focus state, and reduced-motion behavior are protected.
- Main navigation, responsive four-column board, visible information depth, and existing indexed surfaces must not be reduced without an explicit product decision.

## External-action limits

The original approval authorized repository-local implementation, review, tests, and integration. On 2026-08-24 the user separately authorized commit, push, and deployment after code/logic and SEO review passed. GSC mutation, paid services, unrelated DNS changes, and external messages remain outside scope.

## Phase ledger

| Phase | Status | Reviewed/integrated scope | Verified evidence | Inferred / unverified | Blockers / rerun |
|---|---|---|---|---|---|
| 0 — Baseline and change ownership | PASS — 2026-08-23 | Independent review found and drove repair of an initial 30→2 Archive regression. Final candidate preserves today plus 30 prior deterministic boards, legacy `?date=` play, all original routes/tasks, and all game data. The later Phase 4 publication policy preserves every date route while holding all dated pages at `noindex,follow` until packs are unique. | `npm test`; 31 Archive cards/routes; puzzle data exact-match at 3 packs/12 groups/48 Pokémon; homepage remains 3 sections/9 buttons; six original pages and all handlers/localStorage markers preserved; independent re-review | Browser interaction and deployed behavior intentionally deferred to later Gates | No Phase 0 blocker; do not reintroduce Archive shrinkage |
| 1 — Search intent and opportunities | CORRECTED PASS — 2026-08-23 | The first review correctly detected a 4×4/6-link mechanic mismatch but incorrectly converted it into blanket Pokelike exclusion. Corrective research established that Pokésort is the Daily six-Pokémon minigame inside Pokelike. The map now targets evergreen entity/rules/tips intent at `/pokelike-pokesort/`, holds one future verified Today URL and a complete solver, and keeps 4×4 tasks on their own pages. | Official Pokelike product copy; current Pokelike guide/FAQ; r/Pokelike policy, tips, and dated hint threads; public working solver; corrected CSV and opportunity scores; independent correction review | GSC volume/Query × Page data remains unavailable; daily answer data is not yet ingested or independently verified | Monitor the new guide after authorized release; do not publish `/today/` until six names, five links, order, date, and reset boundary are auditable; do not call the worksheet a solver |
| 2 — Crawl and index foundations | PASS — 2026-08-24 | Production now serves clean apex canonicals/OG URLs, 9 sitemap routes including the distinct Pokelike guide, 31 playable but held date routes, robots, explicit noindex policy, and a truthful 404. | Local `npm test` plus external production matrix: HTTP→HTTPS 301; www→apex 308; legacy Infinite and in-window date 308; 9 routes 200/self-canonical/one H1/no placeholder; unknown and future date real 404; sitemap clean; social asset 200; dated page self-canonical and `noindex,follow` | Cloudflare injects managed Content-Signal directives before the generated robots policy; search remains allowed and the apex sitemap declaration is preserved | Monitor Google-selected canonicals and coverage in GSC when separately authorized |
| 3 — Daily and Infinite separation | PASS — 2026-08-23 | Repaired reveal/win boundaries, four-mistake lockout, canonical mode navigation, mode-specific completion/share, New Infinite visibility, accessible mistake count and mode state, and focus restoration | Real headless Chrome at 390×844: 16-card Daily/Infinite boards; correct group, One Away, hint, Arrow/focus, valid Daily win/streak/share; Reveal no win; four failures no win and 16 disabled cards; Infinite navigation/solve/share; dated board render; zero page errors. `npm test` and independent final re-review PASS | Visual screenshot review and field INP remain deferred; code/browser interaction Gate is complete | Preserve localStorage key families and never allow Reveal/failure to create Daily wins |
| 4 — Archive and dated pages | CONDITIONAL PASS — 2026-08-24 | Preserved a static, month-grouped 31-date Archive with exact content, navigation, breadcrumbs, progressive hints, and `noindex,follow` publication hold. The edge redirect window is pinned to the actual build artifact. | `npm test`; 31 exact cards/routes; production in-window query 308 to an existing static route; outside-window query 200 compatibility; newest+1/oldest−1 and invalid date edge regressions; production Chrome Archive count 31 | The Archive is as fresh as the last deployment. No daily UTC rebuild credential or schedule is present; GSC evidence for an index release is unavailable | Rebuild after UTC midnight when a fresh rolling window is required; keep dated index release held until packs are materially unique |
| 5 — Core content and trust | PASS — 2026-08-23 | Preserved every content surface while clarifying 4×4 intent and actual mechanics. Added third-party sprite privacy disclosure and a 12-group fact-evidence register; marked pseudo-legendary as a community convention; retained Alternative at `noindex,follow` and troubleshooting as evergreen rather than live status. | `npm test`; all evidence rows match exact pack/group/four-member sets; validator enforces parity; privacy matches `raw.githubusercontent.com` behavior; How-to title/H1 identify 4×4; no analytics/cookie/beacon code found; trademark/non-affiliation and three-pack limitations visible; independent final re-review PASS | Sources include structured PokeAPI data and community references, not an official data license; deployment-platform integrations remain unknown until release | Re-review the register and privacy disclosure whenever packs, image hosting, analytics, ads, or external services change |
| 6 — Automated SEO and regression | PASS — 2026-08-24 | Expanded `npm test` into static SEO, protected-product/data, real-Chrome runtime, corrupted-storage, legacy-share, strict-date, and build-pinned edge Gates. | Static + Playwright 1.62.1 Chrome at 390×844 pass; independent code/logic PASS; production Chrome smoke passes Daily, Infinite, Archive, worksheet, and real 404; npm audit reports 0 vulnerabilities | Field CWV remains unavailable; local runtime requires an installed Chrome channel or configured executable | Rerun full `npm test` on every change and perform the external matrix after every production deployment |
| 7 — Release readiness and GSC handoff | PRODUCTION PASS — 2026-08-24; MONITORING PENDING | Commit `0bcc3db` was pushed to `main`; Cloudflare Pages check completed successfully and the candidate is live at `https://pokesort.org`. Product baseline is preserved and expanded. | Git push `2150c42..0bcc3db`; Cloudflare Pages `completed/success`; external HTTP matrix; 9 self-canonical production routes; clean sitemap; production Chrome smoke; independent code/logic and Technical SEO PASS | GSC Query × Page, Google-selected canonical, field CWV, and automatic daily UTC rebuild are not configured/available | No deployment blocker remains. Separately authorize GSC actions if desired; rebuild after UTC midnight for a fresh Archive window |

## Commit and integration policy

Commit, push, and deployment were authorized on 2026-08-24 after final review. Existing user work will not be reset, cleaned, or overwritten; GSC submission remains a separate follow-up action.

## Production release record — 2026-08-24

- Release commit: `0bcc3db` (`main`).
- Cloudflare Pages Git check: `completed / success`.
- Production: `https://pokesort.org`.
- Verified redirects: HTTP→HTTPS `301`; www→apex `308`; `?mode=infinite`→`/infinite/` `308`; generated-window date query→static date route `308`.
- Verified compatibility/status: outside-window date query `200`; unknown and future date routes `404`; all nine sitemap routes `200` and self-canonical.
- Verified browser tasks at 390×844: 16-card Daily selection, 16-card Infinite navigation, 31-card Archive, six-position/five-link Pokelike worksheet, and real 404.
