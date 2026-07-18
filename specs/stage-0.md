# Stage 0 — Scaffold + spike verification

## Goal

Stand up the repo skeleton (dashboard, agent, specs, spike), distill the kickoff
document into `CLAUDE.md`, and port the working `spike/` scripts into `agent/`
with FilAgentKey brand strings, so the human can run the end-to-end delegated
upload against Calibration.

## Files to touch

- `CLAUDE.md` — distilled project constraints, API cheat sheet, process.
- `.gitignore` — node_modules, dist, .env.
- `specs/stage-0.md` — this file.
- `dashboard/` — Vite + React + TS + Tailwind scaffold. Deps: `viem`, `wagmi`,
  `@tanstack/react-query` (wagmi peer), `@filoz/synapse-core` **only** (never
  the full SDK). Placeholder App shell, no chain logic yet (that's Stage 1).
- `agent/` — Node + tsx package. Deps: `@filoz/synapse-sdk`, `@filoz/synapse-core`,
  `viem`. Scripts ported from `spike/owner.mts` + `spike/agent.mts` with
  `origin: 'filagentkey'` and `source: 'filagentkey-agent'`.
- `spike/` — originally expected from the human, but it existed nowhere; the
  two scripts were authored in-repo instead, written against the installed
  `.d.ts` files (every symbol read and verified before use) and typechecked.
  `agent/` is the live copy; `spike/` holds the reference snapshot.

## Acceptance checks

- [x] `tsc --noEmit` passes in `agent/`.
- [x] `tsc --noEmit` and `pnpm build` pass in `dashboard/`.
- [x] `dashboard/` bundles only `@filoz/synapse-core` modules, not
      `@filoz/synapse-sdk` (enforced structurally by pnpm's strict layout).
- [x] Installed `.d.ts` files confirm the cheat-sheet API surface
      (`login`, `revoke`, `getExpirations({ address, sessionKeyAddress })`,
      `fromSecp256k1`, permission exports, `calibration` chain, registry ABI export).
- [x] ⛔ HUMAN CHECKPOINT passed 2026-07-18: `owner:create` minted + funded a
      session key (login tx confirmed on Calibration), and the agent —
      holding only SESSION_PRIVATE_KEY + ROOT_ADDRESS — uploaded checkpoints,
      e.g. PieceCID bafkzcibd3mcqmkt5fex732xn4byj3vavmv6vwqrec5o2b7qcqwsnad7wlplu42bp.

## Deviations discovered from source (types/source win over docs)

- `Synapse.create({ account: <address> })` throws on an http transport — that
  path is browser-wallet only. Node agents use
  `new Synapse({ client, sessionClient: sessionKey.client, source })`
  (pattern from the SDK's own `session-keys.test.ts`).
- The `disconnected` event does NOT fire on revocation — it fires only from
  `unwatch()`. Live revocation arrives as `expirationsUpdated` with expiry
  `0n`; the agent watches for that.
- Calibration SP reliability: uploads take ~2 min; providers intermittently
  fail pings or time out on-chain commits ("data is stored but not
  on-chain"). Expect retries in the live demo.

## Notes

- Spike grants CreateDataSet + AddPieces; after the first successful run creates
  the root's dataset, demo keys can be AddPieces-only.
- Faucet funding, USDFC deposit, warm-storage operator approval are human-side.
- No root private key anywhere in the repo, logs, or code.
