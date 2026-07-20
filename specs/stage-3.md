# Stage 3 — Live polish

## Goal

Make the chain state legible in real time: an activity feed built from the
same `AuthorizationsUpdated` logs the key list uses (no extra RPC), explorer
links per event, and a branding/empty-state pass. Clean, not fancy.

## Files to touch

- `dashboard/src/lib/registry.ts` — event → approximate timestamp via
  `calibration.genesisTimestamp + blockNumber * 30` (Filecoin epochs are a
  fixed 30 s; no per-event `getBlock` calls). Explorer link helper from
  `calibration.blockExplorers` (verify runtime URL/path first).
- `dashboard/src/components/ActivityFeed.tsx` — flatten `events` from the
  already-fetched `SessionKeyInfo[]` (zero additional requests), newest
  first: **authorized** (expiry > 0) / **revoked** (expiry = 0n) rows with
  signer, permission names, origin, relative time, tx link. Own empty state.
- `dashboard/src/App.tsx` — mount feed under the key list; footer note
  (Calibration testnet · chain state is the only source of truth).
- `dashboard/src/components/KeyCard.tsx` — only if a branding tweak needs it.

## Acceptance checks

- [ ] `tsc --noEmit` and `pnpm --filter filagentkey-dashboard build` pass.
- [ ] Feed derives entirely from data already fetched by `useSessionKeys`
      (still exactly one `eth_getLogs` per refresh).
- [ ] Manual: feed shows the Stage 2 history (authorizations + the revocation
      of `0x99F5…436a`), tx links open the Calibration explorer, timestamps
      look sane (~minutes/hours ago).
