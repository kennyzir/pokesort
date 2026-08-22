# PokeSort

A static, no-login daily Pokémon grouping puzzle designed to put the playable board before marketing copy.

## Local preview

```powershell
npm run dev
```

## Production build

Set the real public origin so canonical links, Open Graph URLs, structured data, `robots.txt`, and `sitemap.xml` point to the deployed domain:

```powershell
$env:SITE_URL = "https://your-domain.com"
npm run build
```

Deploy the generated `dist/` directory to Cloudflare Pages, Vercel, Netlify, or any static host. For Cloudflare Pages, use `npm run build` as the build command, `dist` as the output directory, and add `SITE_URL` as an environment variable.

## Included surfaces

- Daily and infinite 4×4 grouping game
- Local progress saving and keyboard/touch controls
- 30-day archive and complete how-to-play guide
- `/pokesort-alternative/` comparison landing page
- `/pokesort-down/` troubleshooting/search-intent page
- FAQ and WebApplication structured data
- Open Graph card, manifest, sitemap, robots, privacy page

This is an unofficial fan project. Review Pokémon trademark and content usage with counsel before commercial launch.
