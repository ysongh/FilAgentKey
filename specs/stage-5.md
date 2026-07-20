# Stage 5 — README + 90-second demo script

## Goal

A README that sells the mechanic in one screen (what/why, architecture,
quickstart for both halves) and an exact, timed, shot-by-shot 90-second demo
script the human can record from. No new code.

## Files to touch

- `README.md` (repo root) — pitch, security model, mermaid architecture
  diagram, quickstart (dashboard + agent), demo script, constraints/limits.
- `CLAUDE.md` — status line update.

## Constraints honored in the script

- Calibration uploads take ~2 min: the script records continuously and
  jump-cuts the wait (editing, not faking — the PieceCID really lands).
- SP flakiness: Claude reacts to a failed upload as a retryable tool result,
  which is itself demoable; `--plain` is the fallback mode.
- Revocation propagates in ~30–60 s (30 s epochs + event poll) — the script
  allots real time for it.

## Acceptance checks

- [ ] README quickstart is reproducible from a clean clone (matches actual
      package scripts and env names).
- [ ] Demo script hits all five acceptance beats with realistic timings.
- [ ] ⛔ HUMAN CHECKPOINT: owner rehearses the script end-to-end (this also
      closes Stage 4's outstanding live-run box), then records.
