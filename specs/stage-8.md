# Stage 8 — Public dashboard history cache

## Goal

Persist the public session-key history a browser has already observed so key
addresses and authorization logs remain discoverable after they fall outside
Calibration's ~24-hour RPC log window. The cache is never authoritative and
never contains a session private key, root private key, or reveal env block.

## Files to touch

- `dashboard/src/lib/sessionKeyCache.ts` — versioned, owner/chain-namespaced
  localStorage schema; safe bigint serialization, validation, and storage
  failure handling.
- `dashboard/src/lib/registry.ts` — include event log indexes and merge cached
  history below the freshly queried block window before rereading every key's
  live expirations from chain.
- `dashboard/src/hooks/useSessionKeys.ts` — load the public cache before each
  chain refresh and persist the successfully reconciled result.
- `dashboard/src/components/ActivityFeed.tsx` and `dashboard/src/App.tsx` —
  describe browser-observed history accurately and use log-index event keys.

## Cached public fields

- Calibration chain ID and owner address.
- Session key address, permissions, origin, and the earliest observed positive
  authorization's transaction hash/block as creation metadata.
- Full observed `AuthorizationsUpdated` events: identity, signer, expiry,
  permissions, origin, block/hash, transaction hash, and log index.

## Invariants

- Cache keys are namespaced by chain ID and lowercase owner address, so wallet
  account switches cannot mix histories.
- Fresh logs replace cached logs in the current RPC window; cached logs are
  retained only below that window. Events dedupe by transaction hash + log
  index.
- `getExpirations()` remains the source of truth for current status on every
  successful refresh. Cached event expiry is history only.
- Corrupt, mismatched, unavailable, or quota-limited localStorage degrades to
  an empty/no-op cache without breaking the dashboard.
- Payload, key, event, permission, and string limits prevent tampered cache
  data from causing unbounded RPC work.
- Writes are skipped when the serialized public history is unchanged.

## Acceptance checks

- [x] Cache round-trip/merge smoke passes, including bigint restoration,
      owner isolation, deduplication, and current-window replacement.
- [x] Dashboard `tsc --noEmit` passes.
- [x] Dashboard Vite production build passes (`✓ built in 9.55s`).
- [x] Manual: inspect the owner/chain-namespaced localStorage payload after a
      refresh, reload, and confirm the cache remains while status is reconciled
      from live chain reads.
