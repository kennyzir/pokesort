# GSC follow-up

GSC data was unavailable during implementation. After deployment:

1. Submit `https://pokesort.org/sitemap.xml` and confirm it contains only clean canonical URLs.
2. Use URL Inspection on `/`, `/infinite/`, `/archive/`, `/how-to-play/`, `/categories/`, and `/pokelike-pokesort/`; compare Google-selected canonical with the declared canonical. Inspect one current `/daily/YYYY-MM-DD/` only to confirm the intended `noindex,follow` hold.
3. Confirm Page Indexing excludes query parameters, future dates, and the 404 page.
4. Verify the deployed Pages Advanced Mode Worker returns a permanent status for `/?mode=infinite` → `/infinite/`; the client replacement remains only a fallback.
5. Verify the Worker redirects an in-window `/?date=YYYY-MM-DD` to `/daily/YYYY-MM-DD/`. Confirm that a date immediately outside the generated window remains playable at the compatibility query URL rather than redirecting to a 404.
6. Verify the Worker permanently redirects `www.pokesort.org` to `https://pokesort.org` while preserving path and query.
7. At 28 days, export Query × Page for 28 days, 90 days, and all available time. Review positions 4–20, high-impression/low-CTR queries, query-page mismatch, and cannibalization.
8. Keep dated 4×4 pages out of the sitemap until the generator has reviewed, materially unique daily packs and a stable retention policy. Never retitle them as Pokelike answers. Track Pokelike six-link demand against `/pokelike-pokesort/`; create `/pokelike-pokesort/today/` only after the verified daily-data Gate is met.
9. Expand or release held pages only when evidence crosses these gates: at least one relevant query has repeat impressions, its mechanic is confirmed from the top results, the page has unique data or interaction, and it will not duplicate an existing task.
10. Keep the rolling 30-day Archive unless a separately approved retention decision changes it. Add `/pokelike-pokesort/solver/` only after a complete, sourceable six-position relation model and working permutation engine are available; never relabel the worksheet as a solver.
11. Rebuild after UTC midnight whenever a fresh rolling Archive is required. The Worker uses build-injected oldest/newest constants and will not redirect to a date route absent from the deployed artifact.

## Deployment Gate

Before publication, run `npm ci`, `npm test`, and `SITE_URL=https://pokesort.org npm run build` from the candidate revision and retain the previous Pages deployment for rollback. Deploy only `dist/`. The query-aware edge logic must evaluate the UTC date: redirect valid `?date=YYYY-MM-DD` requests only when the date is from today through 30 days ago; pass older valid past dates through to the legacy browser-compatible game. A blanket date-query redirect would break preserved Archive compatibility and must not ship.

| Request | Required production result |
|---|---|
| `http://pokesort.org/` | permanent redirect to `https://pokesort.org/` |
| `https://www.pokesort.org/` | permanent redirect to apex HTTPS |
| `/?mode=infinite` | permanent redirect to `/infinite/` |
| `/?date=<within generated 31-day window>` | permanent redirect to `/daily/YYYY-MM-DD/` |
| `/?date=<valid past date outside window>` | 200 compatibility game at the query URL; do not redirect to 404 |
| `/`, `/infinite/`, `/archive/`, `/how-to-play/`, `/categories/`, `/pokelike-pokesort/`, `/about/`, `/pokesort-down/`, `/privacy/` | 200 with self-canonical apex URL |
| one current `/daily/YYYY-MM-DD/` | 200, self-canonical, `noindex,follow`, playable 16-card board |
| unknown route and future `/daily/` date | real HTTP 404 with no canonical and `noindex,follow` |
| `/sitemap.xml` | 200 with the exact nine approved clean URLs and no dated/query/noindex URL |
| `/robots.txt` | 200 and apex sitemap declaration |
| `/assets/social-card.png` | 200 PNG, 1200×630 |

Do not submit the sitemap or request indexing until every row passes from an external client. Roll back the Pages deployment if canonical, 404, gameplay, Archive, or metadata checks regress. Roll back or disable only the edge rule if query/hostname behavior is wrong; do not delete product routes as a redirect repair. After rollback, rerun `npm test`, correct the failing layer, redeploy, and repeat the entire matrix.
