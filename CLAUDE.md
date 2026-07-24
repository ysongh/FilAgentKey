# FilAgentKey — valet keys for AI agents on Filecoin

Hackathon entry (Filecoin Onchain Cloud, tool/adapter/dev-utility track).
**Bias every decision toward a working end-to-end demo over completeness or polish.**

The mechanic: an **owner** mints a scoped, time-limited, on-chain-revocable
session key from a web dashboard; an **AI agent** holding only that key (plus
the owner's *public* address) stores data on Filecoin under the owner's
identity; the owner clicks **Revoke** and the agent is locked out live,
mid-run. The root wallet key never touches the agent.

## Layout

pnpm workspace (`pnpm-workspace.yaml`); install with `pnpm install` at the
root. Native install scripts are allowlisted via `pnpm.onlyBuiltDependencies`
in the root `package.json`.

- `dashboard/` — Vite + React + TS + Tailwind (+ shadcn/ui allowed). Owner
  creates/monitors/revokes agent keys.
- `agent/` — Node + tsx demo agent: uploads via session key, reacts live to
  revocation.
- `spike/` — working, typechecked reference scripts. **Ground truth for API
  usage.** If missing, STOP and ask the human.
- `specs/` — per-stage spec files.

## Non-negotiable constraints

- **Calibration testnet only.**
- Deps: `@filoz/synapse-sdk@^1.1.0`, `@filoz/synapse-core@^0.7.0`, `viem`,
  `wagmi` (dashboard only), Vite + React + TS + Tailwind. **No ethers.js
  anywhere.** Ask before adding anything else.
- Dashboard bundles **only `@filoz/synapse-core`** (verified session-key,
  chains, abis, warm-storage, typed-data, and piece subpaths) + viem/wagmi —
  never the full `@filoz/synapse-sdk`. Agent uses the full SDK.
- **No backend, no database.** Chain state is the only source of truth:
  `getExpirations()` for live key status, `AuthorizationsUpdated` event logs
  for registry history, and PDP `PiecesAdded` logs for storage history.
  Dashboard must build to a fully static site. Browser localStorage may retain
  only already-observed public registry history; it is never authoritative.
- Online tutorials/blog posts about the SDK are stale (pre-1.0 breakage).
  **When any doc disagrees with the `.d.ts` files in `node_modules`, the types
  win.** Verify import paths and signatures against installed types before
  use; never invent API surface. Known example: `getExpirations` takes
  `{ address, sessionKeyAddress }`, not `signer`.
- Brand strings: `origin: 'filagentkey'` in every `login()` call (stored
  on-chain); `source: 'filagentkey-agent'` in `Synapse.create()`.
- Key hygiene: session private key generated **client-side**, displayed
  **once**, never persisted. Root private key never appears in dashboard code,
  agent code, logs, or the repo — all owner txs go through the connected
  browser wallet.

## Verified API cheat sheet

These shapes typecheck against the installed packages (see `spike/`). Do not
deviate without checking the types.

```ts
// Permissions & chain
import {
  AddPiecesPermission, CreateDataSetPermission,
  SchedulePieceRemovalsPermission, TerminateServicePermission,
  login, revoke, getExpirations, fromSecp256k1,
} from '@filoz/synapse-core/session-key'
import { calibration } from '@filoz/synapse-core/chains'

// OWNER (viem wallet client from the connected wallet):
const txHash = await login(walletClient, {
  address: sessionKeyAddress,
  permissions: [AddPiecesPermission],   // each permission gets its own on-chain expiry
  expiresAt: BigInt(unixSeconds),
  origin: 'filagentkey',
})
await revoke(walletClient, { address: sessionKeyAddress })  // optional: permissions?: [...]
const expirations = await getExpirations(publicClient, {
  address: rootAddress,
  sessionKeyAddress,
})                                       // => { [permissionHex]: bigint }

// AGENT (holds SESSION_PRIVATE_KEY + ROOT_ADDRESS only):
const sessionKey = fromSecp256k1({ privateKey, root: ROOT_ADDRESS, chain: calibration })
await sessionKey.syncExpirations()
sessionKey.hasPermission(AddPiecesPermission)   // boolean
await sessionKey.watch()                        // then:
// LIVE REVOCATION arrives as expirationsUpdated (expiry → 0n). The
// 'disconnected' event only fires when *we* call unwatch() — verified in
// synapse-core source; the original kickoff doc was wrong about this.
sessionKey.addEventListener('expirationsUpdated', () => {
  if (!sessionKey.hasPermission(AddPiecesPermission)) onRevoked()
})

// Node agent construction — per the SDK's own session-keys test.
// Synapse.create({ account: <address string> }) THROWS on http transport
// ("Transport must be a custom transport") — that path is for browser
// wallets. In Node use the constructor:
import { Synapse } from '@filoz/synapse-sdk'
const rootClient = createClient({ chain: calibration, transport: http(), account: ROOT_ADDRESS })
const synapse = new Synapse({
  client: rootClient,                // root ADDRESS only — payer identity, never signs
  sessionClient: sessionKey.client,  // signs everything
  source: 'filagentkey-agent',
})
const result = await synapse.storage.upload(bytes)  // result.pieceCid
```

More verified surface (confirmed against installed `.d.ts` / source):

- Registry address + ABI: use `calibration.contracts.sessionKeyRegistry`
  (`.address` / `.abi`) — no separate abis import needed. (The abis-module
  export is named `sessionKeyRegistry`, not `sessionKeyRegistryAbi`.)
- `PermissionNames` (session-key module): `Record<Hex, string>` for
  human-readable permission labels.
- `loginSync` / `revokeSync`: wait-for-receipt variants, useful for the
  dashboard's post-tx status flips.
- `Synapse.create` is synchronous; `storage.upload()` returns `UploadResult`
  with `pieceCid` field. Minimum payload 65 bytes.
- Root dataset discovery: `getClientDataSets(client, { address: root })` from
  `@filoz/synapse-core/warm-storage` returns both the global `dataSetId` and
  per-root `clientDataSetId`. PDP events/functions use `dataSetId`; the
  `AddPieces` EIP-712 message uses `clientDataSetId`. Never interchange them.
- PDPVerifier address + ABI: use `calibration.contracts.pdp` (`.address` /
  `.abi`; the chain key is `pdp`, not `pdpVerifier`). Installed declarations
  expose `PiecesAdded(setId indexed, pieceIds[], pieceCids[])` and
  `addPieces(setId, listenerAddr, pieceData, extraData)`.
- AddPieces attribution helpers are public exports from
  `@filoz/synapse-core/typed-data`: `EIP712Types`, `getStorageDomain`, and
  `signAddPiecesAbiParameters`. Piece CID parsing is
  `from()` from `@filoz/synapse-core/piece`.

Activity feed: query `AuthorizationsUpdated` logs with viem `getLogs`,
filtered by indexed `identity` = connected address. Fields: `identity`,
`signer`, `expiry`, `permissions[]`, `origin`. `expiry = 0n` across
permissions ⇒ revoked. **Calibration RPC caps `eth_getLogs` ranges at 2880
epochs (~24 h)** — the dashboard queries the last ~2870 blocks
(`dashboard/src/lib/registry.ts`). It replaces the current-window portion of
the browser's public owner/chain-scoped cache and retains older logs already
observed by that browser. The cache cannot recover never-observed old logs and
never supplies current status; `getExpirations()` is reread from chain.

Per-key storage audit: query PDP `PiecesAdded` for all of the root's
`dataSetId`s over the inclusive `[latest - 2879, latest]` range (exactly 2880
epochs). For a standard `addPieces` transaction, decode `extraData` with
`signAddPiecesAbiParameters`, rebuild the exact message from `clientDataSetId`,
nonce, calldata `pieceData`, and positionally zipped metadata, then call
`recoverTypedDataAddress()` with `getStorageDomain({ chain: calibration })`
and `EIP712Types`. **Never attribute by `transaction.from` /
`receipt.from`: the storage provider submits the on-chain transaction.** A
standard provider submission may also use the zero `listenerAddr`; that field
is not an attribution signal. Only a recovered address matching a known
registry signer gets the `signature-verified` key row. Owner, unknown, decode
failure, and RPC-failure rows stay in the separate read-only dataset section.

Registry also has payable `loginAndFund(signer, expiry, permissions, origin)`
(authorize + gas-fund in one tx) — prefer it if simulation succeeds; else fall
back to `login()` + plain 0.3 tFIL transfer (the session key signs its own
txs, so it needs gas).

## Process

Spec-driven, staged, stop-and-report. Per stage:

1. Write `specs/stage-N.md` (goal, files to touch, acceptance checks).
2. Implement.
3. `tsc --noEmit` in every touched package; `pnpm --filter
   filagentkey-dashboard build` for the dashboard.
4. **Stop and report with actual command output** — no expected counts, real
   output only. One commit per stage.
5. Never fake or mock a demo beat that doesn't work; report it instead.

Stages: 0 scaffold+spike (⛔ human checkpoint: delegated upload returns
PieceCID) · 1 dashboard read layer · 2 dashboard writes (create/reveal/revoke)
· 3 live polish (activity feed, countdowns) · 4 demo agent (Anthropic tool-use
loop, `--plain` flag for bare loop) · 5 README + 90s demo script (⛔ human
checkpoint) · 6 gas gauge + top-up · 7 opt-in sweep-on-lockout · 8 public
registry-history cache · 9 signature-attributed per-key audit trail.

**Status: stages 0–3 and 8 complete; stages 4–7 are implemented, with the live
Claude-mode run, recording rehearsal, and Stage 7 real sweep receipt/gauge
check still pending. Stage 6 top-up was reported working. Stage 9 shipped the
full-trail rung and passes typecheck/build, deterministic isolation/recovery
smoke, and a real public Calibration signature-recovery probe; its fresh-key
A/B browser run is still pending because the configured root had zero
`PiecesAdded` logs in the active window.** All five core demo beats have run
live on Calibration with the plain agent: dashboard create (one
`loginAndFund` tx) → reveal-once → scoped agent (AddPieces ✓ /
CreateDataSet ✗) uploads with PieceCIDs → Revoke click → agent locked out
mid-upload within the poll window. Natural-expiry lockout also proven. See
`specs/stage-0.md` for API deviations discovered from source and
`specs/stage-9.md` for the audit attribution proof.

Note: the spike grants CreateDataSet + AddPieces; the first successful run
creates the root's dataset — done 2026-07-18 for root `0x131c…0Dba`, so demo
keys can now be AddPieces-only. Faucet funding, USDFC deposit, and
warm-storage operator approval are human-side operations (done for that
root).

Field notes from the live runs:

- Agent scripts auto-load `agent/.env` (`tsx --env-file-if-exists=.env`);
  `agent/.env.example` is the tracked template. `agent/check-status.mts` is a
  read-only probe: balances + live authorization state for the key in `.env`.
- Calibration uploads take ~2 min each (piece confirmation); SPs
  intermittently fail pings or time out on-chain commits. The demo script
  must tolerate a failed iteration.
- Wallet reads work regardless of MetaMask's selected network (dashboard uses
  its own transport); writes (Stage 2+) need MetaMask on Calibration — prompt
  chain add/switch from the dashboard.
- `loginAndFund` **simulates OK against the deployed Calibration registry**
  (verified from the funded root via `eth_call`), so the dashboard's create
  flow is one tx; the `login` + 0.3 tFIL transfer fallback stays in
  `dashboard/src/lib/write.ts`.
- Every key card polls its session-key tFIL balance every 15 s. Gauge
  thresholds are green ≥ 0.15, yellow ≥ 0.05, red < 0.05 tFIL. Live keys can
  receive a 0.2 tFIL owner top-up; revoked/expired keys show the gauge without
  the action. Balance refreshes after the transfer receipt.
- Agent `--sweep` is opt-in and off by default. On revoke or natural expiry it
  reads balance, estimates live FEVM transfer gas and EIP-1559 fees, reserves
  a 1.5x fee buffer, sends the remainder to `ROOT_ADDRESS`, and exits cleanly
  on success, nothing-to-return, error, or the 90 s receipt timeout. Never
  hardcode 21,000 gas on FEVM. The flag-off guard preserves the verified demo
  lockout path.
- Public registry cache key:
  `filagentkey:session-keys:<chainId>:<lowercase-owner>`. It may contain owner
  and session addresses, permissions, origin, creation tx/block, and observed
  `AuthorizationsUpdated` logs. It must never contain a private key, reveal
  env block, balance, or authoritative live expiration. Fresh current-window
  logs replace cached overlap; events dedupe by transaction hash + log index.
- `revoke()` source facts: omitting `permissions` revokes all
  `DefaultFwssPermissions`; the default `origin` is `'synapse'` — always pass
  `origin: 'filagentkey'` explicitly. Prefer `loginSync`/`revokeSync`
  (receipt + decoded event, `onHash` callback) for dashboard status flips.
- wagmi gotcha: `useChainId()` returns the app config's chain, not the
  wallet's — read the wallet's live chain from `useAccount().chainId`
  (`dashboard/src/hooks/useEnsureChain.ts`).
- Registry block → wall time needs no `getBlock`: Filecoin epochs are a fixed
  30 s and the chain object carries `calibration.genesisTimestamp`
  (1667326380), so `timestamp = genesisTimestamp + blockNumber * 30`
  (validated against a known event; `dashboard/src/lib/registry.ts`). The
  Stage 9 storage audit reads and caches actual block timestamps as requested,
  with the epoch formula as its per-row RPC-failure fallback.
- `calibration.blockExplorers.default` is Blockscout
  (`https://filecoin-testnet.blockscout.com`, `/tx/<hash>` paths); Filfox /
  Beryx / Glif exist as named entries.
- The activity feed reuses the key-list query's events (React Query dedupes)
  — keep it at exactly one `eth_getLogs` per refresh.
- The storage audit is a separate owner/chain-scoped React Query so an audit
  RPC failure cannot blank key cards or interrupt balance/revoke flows.
  Transaction inputs and block timestamps are bounded in-memory promise
  caches; rejected entries are evicted, per-row RPC reads retry once, and
  failures render as unattributed. Plain transfers (top-ups and `--sweep`)
  emit no relevant log and therefore never appear in the audit trail.
- Real Stage 9 probe: transaction `0x6027…ad19` recovered
  `0xe0cD…Fab7`, which had four nonzero registry grants, while
  `transaction.from` matched the storage provider. A stricter
  `listenerAddr == fwss` check was tested and rejected: this standard
  submission used the zero listener while signing the FWSS domain.

## Acceptance = the demo beats

1. Dashboard: connect wallet → create key (AddPieces only, 15 min) → env
   block revealed once.
2. Terminal: agent boots with only those two env vars → prints AddPieces ✓ /
   CreateDataSet ✗ → uploads → PieceCID printed.
3. Dashboard: key card live with counting-down expiry; activity feed shows
   the authorization.
4. Dashboard: click **Revoke** → tx confirms.
5. Terminal: within seconds the agent prints the locked-out line and exits;
   any manual retry fails.

If a beat can't be made real, stop and report — descope together, never fake.
