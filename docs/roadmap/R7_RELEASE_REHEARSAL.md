# R7 automation, security, and release rehearsal

Date: 2026-08-24

## Integrated repository behavior

The production build now composes the server-UTC Daily API handler into the existing Advanced Mode worker. Apex redirects, legacy query redirects, real static 404 handling, and `env.ASSETS.fetch` remain in that same worker. `DAILY_API_ENABLED` is reversible and defaults off; without it, `/api/daily/*` returns a non-cacheable 404 and the existing static Daily product remains independent of KV. Browser activation is separately gated by the build-time `POKESORT_EDGE_DAILY=1`, so routing and client adoption require two explicit switches. With the worker enabled, an absent/invalid binding fails closed with a non-cacheable unavailable response and never substitutes yesterday.

The Daily release workflow contains three ordered jobs:

1. `prepare-private-buffer` first stages only the new UTC day's manifest in the runner checkout so the shared release Gate remains runnable after midnight. It does not commit that staging. When external automation is enabled, it generates only into runner-temporary storage, uploads explicit date paths at least seven days before activation, and refuses a Cloudflare account mismatch.
2. `publish-elapsed-history` obtains only the server-current elapsed payload when external automation is enabled. While external activation is held, it deterministically generates a private runner-temporary buffer from the encrypted GitHub seed and publishes only the current manifest. Both paths perform full canonical/solver validation, append one immutable contiguous history file, rerun the release Gate, and stage at most that file plus the index.
3. `readiness-monitor` fetches and detaches at the just-pushed `origin/main`, requires the current UTC manifest, runs the same Gate and fail-closed drills, and—when external automation is enabled—checks the active UTC identity/hash, tomorrow's public 404, seven explicit private keys, validation status, and static archive lag. Diagnostics contain no future answers.

Private generation reserves every board, exact-group, and member-group signature in the tracked Infinite pool. The private receipt binds those exclusions to the canonical Infinite index hash and counts; validation fails if the pool changes or any collision appears. A bounded deterministic seed derivation retries only when the unchanged quality distribution Gate cannot be met, without recording seed material.

The Pokelike shadow workflow remains a separate file, schedule, concurrency group, evidence path, and commit scope. It has no call to the Daily publisher or Pokelike `mark-published` command.

## Alerts and failure policy

- Critical: current API unavailable/invalid; tomorrow returns anything except 404; target account mismatch.
- Critical: immutable KV/history conflict, semantic/hash failure, or production build Gate failure.
- Warning promoted to workflow failure: any of the next seven private keys missing/invalid.
- Warning promoted to workflow failure: static archive more than one UTC day behind.
- Every failure is fail closed. No job serves, commits, or relabels yesterday's board.

Rollback changes only code routing: clear `POKESORT_EDGE_DAILY`, set `DAILY_API_ENABLED=false`, or restore the last valid worker/static deployment. Date-addressed KV values and elapsed public history are never overwritten during rollback.

## Local evidence and external blocker

Local rehearsal covers an old public index crossing midnight, a current-only append, the post-append production Gate, a two-path commit scope, byte preservation for every older manifest, missing seed/API fail-closed behavior, deterministic replay, missing binding, empty buffer, future public success, immutable conflicts, archive lag tolerance, post-midnight/static-deployment gap, and code rollback without KV mutation. Secret/future-payload mutation fixtures and the shared production build Gate run separately.

External activation remains blocked. Audit evidence identifies the target Pages account as `decab20e…`, while the currently authenticated Wrangler account is `ce80f65f…`. No namespace, binding, secret, route, or deployment may be created under the mismatched account. Keep `POKESORT_DAILY_AUTOMATION_ENABLED` and `DAILY_API_ENABLED` unset/false until the target account, Pages project, preview/production namespace IDs, least-privilege token, separate preview/production HMAC envelope keys, quotas, and rollback deployment are verified. Local rehearsal cannot substitute for a preview deployment, real Cloudflare cache behavior, or a real UTC boundary.
