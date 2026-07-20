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

- [ ] `tsc --noEmit` and `pnpm --filter filagentkey-dashboard build` pass.
- [ ] Still no `@filoz/synapse-sdk` in the dashboard dependency tree.
- [ ] Manual (demo beats 1 + 4-ish): create AddPieces-only 15-min key →
      MetaMask prompts (chain switch if needed, then one tx if `loginAndFund`
      simulates, else two) → reveal screen shows env block once → new card
      appears active with countdown. Paste env into `agent/.env`, run
      `pnpm agent`, click **Revoke** → agent prints the lockout line within
      seconds and exits.
