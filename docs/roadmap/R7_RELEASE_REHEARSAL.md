# R7 automation, security, and release rehearsal

Date: 2026-08-24

## Integrated repository behavior

The production build now composes the server-UTC Daily API handler into the existing Advanced Mode worker. Apex redirects, legacy query redirects, real static 404 handling, and `env.ASSETS.fetch` remain in that same worker. `DAILY_API_ENABLED` is reversible and defaults off; without it, `/api/daily/*` returns a non-cacheable 404 and the existing static Daily product remains independent of KV. Browser activation is separately gated by the build-time `POKESORT_EDGE_DAILY=1`, so routing and client adoption require two explicit switches. With the worker enabled, an absent/invalid binding fails closed with a non-cacheable unavailable response and never substitutes yesterday.

The GitHub Daily release workflow is retained as a manual-only emergency fallback with three ordered jobs. Its scheduled trigger is removed; the primary 00:10 UTC trigger is a Cloudflare Cron Worker that calls a secret Pages Deploy Hook:

1. `prepare-private-buffer` first stages only the new UTC day's manifest in the runner checkout so the shared release Gate remains runnable after midnight. It does not commit that staging. When external automation is enabled, it generates only into runner-temporary storage, uploads explicit date paths at least seven days before activation, and refuses a Cloudflare account mismatch.
2. `publish-elapsed-history` obtains only the server-current elapsed payload when external automation is enabled. While external activation is held, it deterministically generates a private runner-temporary buffer from the encrypted GitHub seed and publishes only the current manifest. Both paths perform full canonical/solver validation, append one immutable contiguous history file, rerun the release Gate, and stage at most that file plus the index.
3. `readiness-monitor` fetches and detaches at the just-pushed `origin/main`, requires the current UTC manifest, runs the same Gate and fail-closed drills, and—when external automation is enabled—checks the active UTC identity/hash, tomorrow's public 404, seven explicit private keys, validation status, and static archive lag. Diagnostics contain no future answers.

Private generation reserves every board, exact-group, and member-group signature in the tracked Infinite pool. The private receipt binds those exclusions to the canonical Infinite index hash and counts; validation fails if the pool changes or any collision appears. A bounded deterministic seed derivation retries only when the unchanged quality distribution Gate cannot be met, without recording seed material.

The Cloudflare Pages build reconstructs only elapsed history in an operating-system temporary directory. Starting on the 2026-08-25 edge activation date, it fetches each missing authenticated server-UTC endpoint and appends only elapsed manifests before running the ordinary production build. Future candidates never enter Git, build logs, or the static artifact. The Pokelike shadow workflow remains a separate file, schedule, concurrency group, evidence path, and commit scope. It has no call to the Daily publisher or Pokelike `mark-published` command.

KV storage dates lead public dates by exactly seven days. For example, the public 2026-08-25 request verifies the signed `daily:v2:2026-09-01` envelope, then recomputes the public manifest identity for 2026-08-25 while preserving the authenticated board content. This keeps the already generated logical sequence immediately after 2026-08-24, provides a genuine seven-day preload window, and avoids inserting an incompatible transition calendar. The configured 358 storage slots from 2026-09-01 through 2027-08-24 therefore cover public dates 2026-08-25 through 2027-08-17. Before `POKESORT_EDGE_DAILY_ACTIVATION_DATE`, the API returns a non-cacheable 404 even when its routing switch is already armed; it becomes eligible on that UTC date without a boundary-time configuration write. The edge rejects invalid activation or lead values, future public dates, bad signatures, missing active slots, and any rebound manifest that fails the canonical contract.

## Alerts and failure policy

- Critical: current API unavailable/invalid; tomorrow returns anything except 404; target account mismatch.
- Critical: immutable KV/history conflict, semantic/hash failure, or production build Gate failure.
- Warning promoted to workflow failure: any of the next seven private keys missing/invalid.
- Warning promoted to workflow failure: static archive more than one UTC day behind.
- Every failure is fail closed. No job serves, commits, or relabels yesterday's board.

Rollback changes only code routing: clear `POKESORT_EDGE_DAILY`, set `DAILY_API_ENABLED=false`, or restore the last valid worker/static deployment. Date-addressed KV values and elapsed public history are never overwritten during rollback.

## Local and target-account evidence

Local rehearsal covers an old public index crossing midnight, a current-only append, the post-append production Gate, a two-path commit scope, byte preservation for every older manifest, missing seed/API fail-closed behavior, deterministic replay, missing binding, empty buffer, future public success, immutable conflicts, archive lag tolerance, post-midnight/static-deployment gap, and code rollback without KV mutation. Secret/future-payload mutation fixtures and the shared production build Gate run separately.

The user authorized the target Pages account `decab20e…` and supplied a rotated token through the local secure-input flow. Separate preview and production KV namespaces, bindings, HMAC secrets, the seven-day storage lead, a Pages Deploy Hook, and the `pokesort-daily-refresh` Cron Worker at 00:10 UTC are configured. Both namespaces independently passed a full authenticated readback of all 358 slots. The Pages build command is `npm run build:cloudflare`; no scheduled GitHub Action is required, and the old workflow remains manual-only fallback.

`DAILY_API_ENABLED` remains false until the exact reviewed commit deploys successfully. A real production UTC transition, the first real Cron invocation, and post-activation cache/browser behavior remain field evidence, not local claims. Cloudflare's documented Free limits were checked before upload: the 716 namespace writes and 46 cleanup deletes remained below the documented 1,000 writes/day and 1,000 deletes/day limits; Pages' documented 500 builds/month and 20-minute build timeout cover one daily build. Account-specific cost and quota enforcement remain unverified; billing state and future plan changes must be monitored rather than inferred from documentation.
