# Stage 10 — Web agent demo

## Goal

Add an isolated local web demo that holds only a session private key and the
owner's public address. A browser-selected image is narrated through Claude's
tool loop, uploaded under the owner's identity, and visibly locks out when the
session key is revoked.

## Files to touch

- `agent-web/` — the new Node/tsx package, inline page, isolated HTTP runtime,
  and route/protocol tests.
- `pnpm-workspace.yaml` and `pnpm-lock.yaml` — register the package and lock
  its two allowed additions (`express` and `@types/express`).
- `specs/stage-10.md` — this stage contract and its actual acceptance results.

`agent/`, `dashboard/`, and `spike/` must have no working-tree diff.

## Runtime and protocol invariants

- Startup constructs the verified Calibration session client with
  `fromSecp256k1`, then calls `syncExpirations()` and `watch()`. The root client
  has only `ROOT_ADDRESS`; `new Synapse` receives the session client and
  `source: 'filagentkey-agent'`.
- The server never receives, reads, or asks for the root private key.
- `/status` is a long-lived SSE stream. It sends public address, permission,
  and expiry state immediately, then sends `{ "revoked": true }` without
  closing the stream when AddPieces is revoked.
- `/upload` accepts only raw image bytes, enforces the exact 4 MiB boundary,
  checks AddPieces before invoking Claude, and flushes newline-delimited
  `{ type, text }` records as work advances.
- Claude uses `claude-opus-4-8`, one `store_image` tool, and at most five
  runner iterations. Tool results are surfaced through the runner's public
  cached `generateToolResponse()` path, so uploads are not executed twice.
- Storage-provider failures use the terminal agent's exact retryable result
  prefix. A successful provider transaction is captured through
  `onPiecesAdded` and linked with the same Calibration Blockscout base used by
  the dashboard.
- Browser-rendered assistant/tool text is inserted only with `textContent`.
  Revocation handling is idempotent and the elapsed timer stays live during
  quiet API/provider waits.

## Descope ladder

1. Full Claude loop, streamed assistant/tool results, PieceCID, transaction
   link, and live revoke UI.
2. Direct streamed upload without Claude.
3. Remove the package.

## Acceptance checks

- Implementation rung: **(a) full Claude/tool-streaming path**.
- Live acceptance status: **pending the fresh-key browser run below**.
- [x] `pnpm --filter filagentkey-agent-web typecheck` passes (exit 0).
- [x] Isolated HTTP/SSE/NDJSON tests pass (8 passed, 0 failed).
- [x] Workspace recursive typecheck passes for `agent`, `dashboard`, and
      `agent-web`.
- [x] Existing agent flag-off guard passes (2 passed, 0 failed).
- [x] `agent/`, `dashboard/`, and `spike/` have no diff.
- [x] Frozen lockfile install and `git diff --check` pass.
- [ ] Manual: a roughly 500 KiB image streams to a real PieceCID, and the
      dashboard attributes its piece event to the displayed valet key.
- [ ] Manual: dashboard revoke produces the SSE lockout UI within about
      60 seconds and prevents another upload.

The live checks were not fabricated: `agent-web/.env` is intentionally absent,
and the test requires a newly minted browser-wallet key plus human dashboard
revoke. The existing terminal-agent environment was not reused because the web
process must receive only the three Stage 10 variables and must never inherit a
root key.

## Stretch

Retrieval is intentionally deferred until the core acceptance path is proven.
The original MIME type would need to be retained alongside each in-process
PieceCID because `storage.download()` returns bytes without content-type
metadata.
