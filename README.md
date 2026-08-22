# MonSort

A static, no-login Pokémon grouping puzzle built as a resilient alternative for daily puzzle players. The working brand is **MonSort** and should be changed before launch if a final brand already exists.

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
- `/pokesort-alternative/` comparison landing page
- `/pokesort-down/` troubleshooting/search-intent page
- FAQ and WebApplication structured data
- Open Graph card, manifest, sitemap, robots, privacy page

This is an unofficial fan project. Review Pokémon trademark and content usage with counsel before commercial launch.
