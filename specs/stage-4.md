# Stage 4 — Demo agent (Anthropic tool-use loop)

## Goal

Make the agent legible as an *AI* agent for the demo: a minimal Anthropic
tool-use loop where Claude writes short research notes and persists each one
to Filecoin via a single `save_checkpoint` tool (→ `synapse.storage.upload`).
The Stage 0 bare loop stays available behind `--plain`. All demo beats keep
their loud terminal lines: valet + root addresses, AddPieces ✓ /
CreateDataSet ✗, every PieceCID, and the 🔒 shutdown on revocation/expiry.

## Files to touch

- `agent/agent.mts` — refactor into shared setup (env guard, session key,
  watcher, Synapse, `uploadCheckpoint`) + two modes:
  - default: Anthropic tool-use loop — system prompt frames Claude as a
    field-notes agent whose only persistence is `save_checkpoint(content)`;
    each tool call uploads the content and returns the PieceCID as the tool
    result; hard cap on turns (cost guard); clear error if
    `ANTHROPIC_API_KEY` missing (points at `--plain`).
  - `--plain`: the existing 15 s checkpoint loop, unchanged behavior.
- `agent/package.json` — add `@anthropic-ai/sdk` (sanctioned by the kickoff's
  Stage 4; the only new dependency), script `agent:plain`.
- `agent/.env.example` — document `ANTHROPIC_API_KEY`.
- `spike/` — NOT synced this time: the spike stays the Stage 0 reference; the
  demo agent diverges from here on.

## Revocation behavior (unchanged mechanics, new demo beat)

The `expirationsUpdated` watcher calls `process.exit` from its listener, so
the kill fires even while awaiting the Anthropic API or an upload — that's
the money shot: the model is mid-thought when the owner pulls the key.

## Acceptance checks

- [x] `tsc --noEmit` passes in `agent/` (exit 0).
- [x] `pnpm agent --plain` keeps the Stage 0/2 behavior (guard verified).
- [x] Missing `ANTHROPIC_API_KEY` → one-line error pointing at `--plain`, exit 1.
- [ ] Manual: with a fresh dashboard key + API key, `pnpm agent` shows
      Claude narrating, `save_checkpoint` calls returning PieceCIDs, and the
      🔒 line on dashboard Revoke.

## Implementation notes

- SDK: `@anthropic-ai/sdk@0.112.3`; loop via the SDK's beta tool runner
  (`client.beta.messages.toolRunner` + `betaTool` with raw JSON schema — no
  zod dependency), `max_iterations: 10` as the cost guard.
- Model: `claude-opus-4-8` (override with `ANTHROPIC_MODEL` in `.env`).
- The `save_checkpoint` run function returns upload errors as tool-result
  text ("safe to retry once") instead of throwing, so SP flakiness becomes
  something Claude reacts to on camera rather than a crash.
