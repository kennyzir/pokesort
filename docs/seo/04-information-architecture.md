# Information architecture

```text
Home / (Daily game)
├── Infinite /infinite/
├── Archive /archive/
│   └── Published daily boards /daily/YYYY-MM-DD/
├── How to play /how-to-play/
├── Categories /categories/
├── Pokelike Daily Pokésort guide and worksheet /pokelike-pokesort/
│   ├── Future verified Today answer /pokelike-pokesort/today/ (HOLD)
│   └── Future complete solver /pokelike-pokesort/solver/ (HOLD)
├── About and data methodology /about/
├── Mechanic disambiguation /pokesort-alternative/
├── Troubleshooting /pokesort-down/
└── Privacy /privacy/
```

The homepage links the primary modes plus category/methodology assets and visibly routes users seeking Pokelike's six-Pokémon Daily Pokésort to its dedicated guide. That page explains the real parent/subgame relationship, satisfies evergreen rules and tips intent, and includes a local six-position/five-link worksheet. It does not claim to contain today's answer or an automatic solver. Archive anchors are present in static HTML and grouped by month. Dated 4×4 boards link previous/next, Archive, How to Play, and Categories and expose Breadcrumb UI plus BreadcrumbList JSON-LD. All playable dates are preserved. Because the current 31-date window cycles only three underlying packs, the dated index release is held: every date route remains playable and self-canonical but uses `noindex,follow`, and no date URL enters the sitemap. The Alternative route is also preserved with `noindex,follow` until its comparisons are evidence-backed. All indexable routes are within three clicks, and query URLs are excluded from the sitemap.

URL policy: HTTPS, non-www, lowercase, directory trailing slashes. `/infinite/` is canonical and the homepage immediately replaces the old mode query state as a JavaScript fallback. A legacy date query within the generated rolling window is likewise replaced with its static date route; older past-date queries remain playable in compatibility mode because no static route exists for them. Cloudflare Pages `_redirects` cannot match query parameters, so query-aware Cloudflare Redirect Rules or a Worker are required for true permanent redirects. Apex/www unification must also be configured and verified at the edge.
