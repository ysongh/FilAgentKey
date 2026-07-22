# Stage 7 — Sweep on revoke

## Goal

Optionally return a session key's remaining gas balance to its owner when the
agent loses access through revocation or natural expiry. The feature is off by
default and must not change the verified plain or Claude demo paths unless
`--sweep` is present.

## Files to touch

- `agent/agent.mts` — parse `--sweep` and route the two existing lockout
  triggers through the opt-in sweep shutdown.
- `agent/lockout.mts` — preserve the immediate flag-off exit, serialize the
  sweep shutdown, normalize errors to one line, and enforce an overall
  fail-safe exit.
- `agent/sweep.mts` — read balance, estimate live FEVM gas and EIP-1559 fees,
  return the spendable balance with the session signer, and wait up to 90 s
  for its receipt.
- `agent/lockout.test.mts` — deterministic flag-off guard smoke using Node's
  built-in test/assert modules.
- `agent/package.json` — expose the flag-off guard command; no dependency
  changes.

## Rules

- Without `--sweep`, lockout output and immediate exit status remain exactly
  as before, with no balance, fee, gas, send, or receipt work.
- With `--sweep`, both `expirationsUpdated` revocation and the existing
  pre-upload natural-expiry check print the lockout line, attempt at most one
  sweep, and exit status 1 regardless of sweep success or failure.
- Gas is estimated for a nonzero plain EOA transfer; no hardcoded gas limit.
- Reserve is exactly `gas * maxFeePerGas * 3n / 2n`; a non-positive remainder
  prints `nothing to return`.
- A sent sweep prints exactly one `↩️ returned <X.XXX> tFIL to owner (tx: 0x…)`
  line and waits for its receipt for at most 90 s.
- Sweep errors are flattened to one log line. A separate overall fail-safe
  ensures no stalled RPC can prevent lockout exit.

## Acceptance checks

- [x] Agent `tsc --noEmit` passes.
- [x] Flag-off guard smoke passes with exact legacy lockout output, status 1,
      and zero sweep calls.
- [ ] Manual: mint a fresh 15-minute AddPieces key, run the agent with
      `--sweep`, revoke mid-run, observe the `🔒` line and one real `↩️` line,
      and see the dashboard gas gauge fall to approximately 0.000/red within
      one polling cycle.
