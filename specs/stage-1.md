# Stage 1 — Dashboard read layer

## Goal

Connect an injected browser wallet on Calibration and show that wallet's
session keys, read entirely from chain state: discovery via
`AuthorizationsUpdated` event logs, live per-permission status via
`getExpirations`. No writes yet (Stage 2).

## Files to touch

- `dashboard/src/wagmi.ts` — `createConfig`: chain = `calibration` from
  `@filoz/synapse-core/chains`, injected connector only (no WalletConnect),
  http transport.
- `dashboard/src/main.tsx` — WagmiProvider + QueryClientProvider.
- `dashboard/src/lib/registry.ts` — registry address/ABI from
  `calibration.contracts.sessionKeyRegistry`; fetch `AuthorizationsUpdated`
  logs filtered by indexed `identity` = connected address; group by `signer`;
  resolve live state per signer with `getExpirations`.
- `dashboard/src/hooks/useSessionKeys.ts` — React Query hook wrapping the
  above (15 s refetch; chain is the only source of truth).
- `dashboard/src/hooks/useNow.ts` — 1 s ticker for countdowns.
- `dashboard/src/components/KeyCard.tsx` — session address, `origin` label,
  per-permission expiry countdowns, status badge.
- `dashboard/src/App.tsx` — header + connect/disconnect + key card list with
  loading/empty/error states.

## Status badge rules (from live `getExpirations`, not logs)

- **active** — some permission expiry > now.
- **expiring soon** — active but max remaining < 5 min.
- **expired** — all expiries in the past, at least one nonzero.
- **revoked** — key seen in logs with permissions, but all live expiries = 0n.

## Known constraint

Filecoin RPC caps `eth_getLogs` ranges (Lotus `MaxFilterHeightRange` = 2880
epochs ≈ 24 h). Stage 1 queries the last ~2870 blocks, so the dashboard lists
keys authorized in the last ~24 h — fine for the demo; documented here rather
than worked around (no backend allowed).

## Acceptance checks

- [x] `tsc --noEmit` and `pnpm --filter filagentkey-dashboard build` pass
      (`✓ built in 9.79s`).
- [x] Dashboard still bundles only `@filoz/synapse-core` (session-key, chains
      modules) + viem/wagmi — never `@filoz/synapse-sdk`.
- [x] Reader verified against live chain from Node before the browser test:
      found `0x87DF…8fE1`, origin `filagentkey`, status `expired` (correct —
      the Stage 0 key had lapsed).
- [x] Manual check passed 2026-07-18: connected as `0x131c…0Dba`, key card
      renders with origin label, per-permission rows, `expired` badge.
