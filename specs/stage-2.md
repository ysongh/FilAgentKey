# Stage 2 — Dashboard writes (create / reveal / revoke)

## Goal

Owner mints and revokes agent keys entirely from the dashboard via the
connected browser wallet. Session private key is generated client-side,
revealed exactly once, never persisted. Root private key never appears —
MetaMask signs everything.

## Files to touch

- `dashboard/src/lib/write.ts` — tx helpers:
  - `createAgentKey(walletClient, publicClient, { permissions, ttlSeconds })`:
    generate keypair (`generatePrivateKey`), then **`loginAndFund`**
    (simulate first; args `[signer, expiresAt, permissions, 'filagentkey']`,
    value 0.3 tFIL) with **fallback** to `loginSync` + plain 0.3 tFIL
    transfer if simulation fails. Returns `{ privateKey, address, expiresAt }`.
  - `revokeAgentKey(walletClient, { signer })`: `revokeSync` with
    `origin: 'filagentkey'` (defaults would log `origin: 'synapse'`),
    permissions omitted ⇒ synapse-core revokes all four defaults (verified in
    source).
- `dashboard/src/hooks/useEnsureChain.ts` — wagmi `useSwitchChain`; before any
  write, switch/add Calibration in MetaMask (injected connector auto-adds via
  `wallet_addEthereumChain` when unknown).
- `dashboard/src/components/CreateKey.tsx` — "Create agent key" flow:
  permission checkboxes (default **AddPieces only**), expiry presets
  **15 min / 1 h / 24 h**, progress states (switch chain → wallet confirm →
  confirming tx), error surface, then the **one-time reveal screen**:
  `SESSION_PRIVATE_KEY` + `ROOT_ADDRESS` env block, copy button, "I've saved
  this — the key disappears forever" confirmation that wipes the state.
- `dashboard/src/components/KeyCard.tsx` — **Revoke** button (only for
  active/expiring keys) with pending state; on receipt, invalidate the
  session-keys query so the badge flips to `revoked`.
- `dashboard/src/App.tsx` — mount CreateKey.

## Key hygiene rules enforced

- Keypair generated in the browser; private key lives only in component
  state; reveal-once then wiped; no localStorage, no logging.
- All owner txs signed by MetaMask; dashboard never sees the root key.

## Acceptance checks

- [x] `tsc --noEmit` and `pnpm --filter filagentkey-dashboard build` pass.
- [x] Still no `@filoz/synapse-sdk` in the dashboard dependency tree.
- [x] Manual test passed 2026-07-19 — all five demo beats exercised live:
      dashboard minted `0x99F5…436a` (AddPieces-only, 15 min, one
      `loginAndFund` tx), reveal-once worked, agent printed AddPieces ✓ /
      CreateDataSet ✗ and uploaded (PieceCID returned), **Revoke click killed
      the agent mid-upload** (`🔒 SESSION KEY REVOKED ON-CHAIN`), and
      `check-status` confirms all permissions zeroed on-chain (revoked, not
      expired). Bonus from an earlier round: natural expiry lockout also
      proven (`🔒 SESSION KEY EXPIRED`, key `0xD97F…0203`).
