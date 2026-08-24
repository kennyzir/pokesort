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

The homepage links the primary modes plus category/methodology assets and visibly routes users seeking Pokelike's six-Pokémon Daily Pokésort to its dedicated guide. That page explains the real parent/subgame relationship, satisfies evergreen rules and tips intent, and includes a local six-position/five-link worksheet. It does not claim to contain today's answer or an automatic solver. Archive anchors are present in static HTML and grouped by month. The Archive UI shows the latest 31 dates, while every immutable Daily manifest whose UTC date has arrived keeps a persistent `/daily/YYYY-MM-DD/` route and sitemap entry after leaving that rolling UI. Dated 4×4 boards link previous/next, Archive, How to Play, and Categories and expose playable cards, progressive hints, four reveals, a solver-backed board profile, Breadcrumb UI, BreadcrumbList JSON-LD, self-canonical metadata, and date-specific sitemap `lastmod`. Future stored manifests are neither routed nor indexed. The Alternative route remains `noindex,follow` until its comparisons are evidence-backed. All indexable routes are within three clicks, and query URLs are excluded from the sitemap.

URL policy: HTTPS, non-www, lowercase, directory trailing slashes. `/infinite/` is canonical and the homepage immediately replaces the old mode query state as a JavaScript fallback. A legacy date query within the current 31-date redirect window is likewise replaced with its persistent static date route. An unsupported query date is never labeled with a substituted legacy pack; the browser honestly falls back to today's immutable board. Cloudflare Pages `_redirects` cannot match query parameters, so the emitted Advanced Mode Worker owns permanent query and hostname redirects for supported routes and passes other requests to static assets.
