# Current site audit

Audit date: 2026-08-23 (UTC/Asia-Shanghai). Baseline: clean `main` worktree at `2150c42`. Production target: `https://pokesort.org/`.

## Baseline

- Stack: static HTML/CSS and browser JavaScript (ES modules); no framework, SSR, or hydration framework.
- Package manager: npm; package has no dependencies. Routes are directory `index.html` files plus build-generated routes.
- Rendering: static HTML/SSG. Interactive board hydrates from `assets/game.js`; Pokémon sprites are requested by National Pokédex ID from the PokeAPI GitHub sprite repository.
- Puzzle source: three hand-authored four-group packs. A stable FNV-style hash maps UTC date or Infinite round to a pack. Daily/Archive state and streaks use localStorage.
- History: the original product exposes a rolling 30-day Archive and accepts deterministic past-date query boards. The implementation preserves that product depth by generating today plus the previous 30 dates; it does not claim those dates prove historical publication traffic.
- Deployment: static `dist/`; README supports Cloudflare Pages, Vercel, or Netlify. Production response headers identify Cloudflare.
- Analytics/GSC: no analytics code, GSC export, API configuration, report, or matching environment-variable name found. **GSC data unavailable.**
- Tests before change: `npm install`, `npm test`, and production `npm run build` passed. No lint or typecheck scripts were configured.

| Severity | URL/Route | Problem | Evidence | Search Impact | Recommended Fix | Related File |
|---|---|---|---|---|---|---|
| Critical | all production routes | Canonical, OG URLs and schema pointed to `pokesort.example` | Live homepage HTML on 2026-08-23 returned the placeholder origin | Google may consolidate pages to a non-site host; social previews are wrong | Make production origin the safe build default and validate self-canonicals | `scripts/build.mjs`, `scripts/validate.mjs` |
| High | `/?mode=infinite` | Infinite had the Daily title, H1, description, canonical and initial HTML | Only client state read `mode=infinite` | Duplicate URL and no independently understandable mode page | Build `/infinite/`; use crawlable links and client replacement; configure a query-aware Cloudflare Redirect Rule because Pages `_redirects` cannot match query parameters | `scripts/build.mjs`, `index.html` |
| High | `/archive/` | Date links existed only after JS and targeted query state | Empty `#archive-grid` in source; 30 client-generated `/?date=` links | Crawlers cannot reliably discover dated boards | Output real anchors at build time | `scripts/build.mjs`, `archive/index.html` |
| High | daily history | No canonical date routes or answer/hint surface | Daily date was query-only; sitemap had no dates | No durable archive, unique metadata, or spoiler-controlled explanation | Preserve the rolling 30-day task with deterministic routes from the real pack data; index only distinct packs | `scripts/build.mjs`, `assets/puzzle-data.js` |
| High | unknown paths | No shipped 404 document | Original build tolerated missing `404.html` | Static hosts may produce inconsistent error handling | Generate a real `404.html`; keep future dates out of build | `scripts/build.mjs` |
| Medium | `/how-to-play/` | Useful but brief; lacks examples and data-method link | Source review | Limited task completion for overlap and category questions | Retain; link Category reference and dated examples; expand later with verified examples | `how-to-play/index.html` |
| Medium | `/pokesort-alternative/` | Comparison used generic “varies” claims and no dated testing matrix | Source review | Weak evidence and possible doorway impression | Retain as mechanic disambiguation; avoid unverified superlatives | `pokesort-alternative/index.html` |
| Medium | `/pokesort-down/` | No live status detector; keyword can imply outage | Page itself admits no permanent status claim | Freshness/trust risk | Keep as evergreen troubleshooting only; do not publish uptime claims | `pokesort-down/index.html` |
| Medium | game data | Three packs cycle, so Infinite is not endlessly unique | `GROUPS.length === 3` | User expectation and thin expansion risk | State the limitation honestly; add reviewed packs before claiming more variety | `assets/puzzle-data.js` |
| Medium | data trust | Category facts had no public methodology page | No About/Methodology route | Harder to correct errors or understand definitions | Add `/about/` and `/categories/` | `about/index.html`, `categories/index.html` |
| Low | CWV | 16 remote sprites load at board render; dimensions are stable | 68×68 attributes exist; third-party origin used | Network latency may affect image paint, but layout shift is constrained | Keep dimensions; measure field data after deployment; consider self-hosted reviewed sprites later | `assets/game.js` |

## Baseline regression review

The implementation preserves all six original page surfaces, Daily/Infinite/Archive game tasks, 12 groups, navigation destinations, local state, mobile grid, hints, reveal, keyboard controls, and visible content depth. It adds routes without removing a product surface. Automated markers alone were not treated as proof: route count, homepage sections, interactive controls, navigation, and indexed surfaces were compared.
