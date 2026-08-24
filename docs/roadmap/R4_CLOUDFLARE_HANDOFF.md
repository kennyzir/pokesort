# R4 Cloudflare handoff

Repository contract date: 2026-08-24. No Cloudflare resource was created or changed by R4.

## Required resources

Create two Workers KV namespaces in the authorized Cloudflare account: one preview namespace and one production namespace. Bind only the matching namespace to Pages Functions as `DAILY_MANIFESTS`. Set `DAILY_ENVIRONMENT=preview` for preview deployments and `DAILY_ENVIRONMENT=production` for production. Create a different encrypted `DAILY_ENVELOPE_HMAC_KEY` secret (at least 32 random bytes) in each environment. Use `wrangler.toml.example` as the non-secret shape; replace IDs and secrets through Cloudflare environment configuration rather than committing them.

Create a least-privilege CI API token that can read and write only those namespaces. Store it as `CLOUDFLARE_DAILY_KV_API_TOKEN`; also store `CLOUDFLARE_ACCOUNT_ID`, `POKESORT_PREVIEW_DAILY_KV_NAMESPACE_ID`, `POKESORT_PRODUCTION_DAILY_KV_NAMESPACE_ID`, `POKESORT_PREVIEW_DAILY_ENVELOPE_HMAC_KEY`, and `POKESORT_PRODUCTION_DAILY_ENVELOPE_HMAC_KEY` as encrypted CI values. The token is only for `prepare:daily-kv-upload` and must not be a Pages Function binding. The matching HMAC key is needed by both the CI upload job and its own Pages environment; preview and production keys must never be shared.

The production build composes the Daily handler and its edge-safe contract into the existing Advanced Mode `dist/_worker.js`. That single worker retains apex/legacy redirects and static asset forwarding while owning `/api/daily/current` and `/api/daily/:date`; repository `functions/` files remain the Pages Function contract and source modules, not a second production router. `DAILY_API_ENABLED` is a reversible activation flag and defaults off.

## Upload contract

The CI command accepts explicit manifest paths only; it intentionally has no key-listing or directory-listing behavior. It performs the full R1 canonical semantic verification, rejects seed/derivation fields, requires a consecutive buffer with every activation at least seven UTC days after preparation, signs a v2 envelope with HMAC-SHA-256, writes `daily:v2:YYYY-MM-DD`, verifies the write, and rejects a later different value observed by the same serialized writer. Logs contain only environment, date, puzzle ID, content hash, and result.

Cloudflare KV does not provide atomic compare-and-swap. The read-before-write guard is therefore not a concurrency lock. Run exactly one upload writer per environment, use CI concurrency control to serialize preparation/upload jobs, and treat any overlapping-writer rehearsal as a release blocker. Do not claim atomic KV immutability; midnight availability comes from preloading date keys, not from a midnight write.

Example after secrets and namespaces exist:

```powershell
npm run prepare:daily-kv-upload -- --environment preview --manifest <private-manifest-1> --manifest <private-manifest-2> --manifest <more-explicit-paths> --write
```

At least seven consecutive explicit manifests are required. Because KV is eventually consistent, preload seven or more days ahead; activation is only a server-UTC read of an already existing key. The edge verifies the environment-bound authentication tag before returning a manifest, so recomputing public SHA-256 fields cannot authorize altered category, member, provenance, or solver claims.

## Local private-input evidence

The ignored local buffer was regenerated after reciprocal Daily/Infinite exclusions and the capacity-aware scheduler correction. It contains 30 R1/quality-validated v2 manifests for `2026-08-25` through `2026-09-23`; receipt hash `b2f6f1eae6016187c94aae9c6a263d39a2f1d421ef5a8ab941643694d803267e`. The rejected v1-labelled buffer was preserved at `data/puzzles/private/daily-pre-r4-legacy-model-backup-20260824`; the pre-correction v2 buffer was also retained locally. Neither backup may be uploaded.

With a preparation time of exactly `2026-08-24T00:00:00Z`, the 24 manifests from `2026-08-31` through `2026-09-23` satisfy the exact seven-day Gate. The scheduled workflow runs at 00:10 UTC, so it conservatively starts uploads at UTC date +8; for this local buffer that would be `2026-09-01`, not `2026-08-31`. A local in-memory upload of eligible explicit paths passed full R1 validation and envelope signing. Ineligible dates are intentionally rejected; never backdate `preparedAt`. Keep the API flag off before the first genuinely preloaded activation date, and regenerate the rolling buffer if external setup happens too late for the current window.

## Remaining production evidence

- Cloudflare account ID, Pages project, two namespace IDs, and least-privilege token are not present in the repository.
- Preview and production bindings have not been created or black-box tested.
- The environment-specific HMAC secrets have not been created or bound.
- Single-writer CI concurrency has not been exercised against real KV; read-before-write is not atomic CAS.
- The composed Advanced Mode worker still requires preview black-box verification against a real binding.
- A real UTC boundary and Cloudflare cache behavior remain unverified until R8.
