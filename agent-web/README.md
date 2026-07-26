# FilAgentKey web agent

A local browser demo of a Filecoin storage agent holding a scoped,
time-limited session key instead of the owner's root key.

Choose an image in the page and Claude invokes one `store_image` tool backed
by `synapse.storage.upload()`. Progress streams into the browser while the
upload runs. Revoke the key from the owner dashboard and the page locks out
live.

## What the process receives

The web agent requires exactly three environment variables:

```dotenv
SESSION_PRIVATE_KEY=0x...
ROOT_ADDRESS=0x...
ANTHROPIC_API_KEY=...
```

- `SESSION_PRIVATE_KEY` is the private key revealed once when the dashboard
  creates the valet key.
- `ROOT_ADDRESS` is the owner's **public** wallet address.
- `ANTHROPIC_API_KEY` is used by the Claude tool loop.

Never put `ROOT_PRIVATE_KEY` or any other owner signing credential in this
package. Do not reuse an environment file that contains one.

## Prerequisites

- Node.js 20 or newer and pnpm
- A Filecoin Calibration owner account with warm storage initialized
- A funded, unexpired session key authorized for `AddPieces`
- An Anthropic API key

The normal FilAgentKey dashboard flow creates and funds the session key. The
owner's browser wallet remains the only place that can authorize or revoke it.

## Setup

From the repository root:

```bash
pnpm install --frozen-lockfile
cp agent-web/.env.example agent-web/.env
```

Fill in only the three values shown in `.env.example`. The local `.env` file
is ignored by Git.

## Run

```bash
pnpm --filter filagentkey-agent-web start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). The server binds only to
localhost.

The header shows the valet address, owner address, live `AddPieces`
permission, and remaining authorization time. Select an image between 65
bytes and 4 MiB and click **Store image**.

Uploads on Calibration commonly take about two minutes. The page keeps a live
elapsed timer visible and renders each Claude message, tool update, and tool
result as it arrives. A successful run shows:

- the PieceCID;
- the successful on-chain transaction, linked to Calibration Blockscout; and
- storage events that the dashboard audit trail can attribute to this valet
  key through signature recovery.

## Revoke demo

1. Start the web agent with a fresh, active `AddPieces` key.
2. Upload an image of roughly 500 KiB and wait for its PieceCID.
3. Confirm the upload appears under the same key in the dashboard audit
   trail.
4. Click **Revoke** on that key in the dashboard and confirm the wallet
   transaction.
5. Within the event polling window, the web header turns red and the chat
   appends:

   ```text
   🔒 my key was revoked — I can no longer store anything.
   ```

6. The picker deliberately remains interactive and the button changes to
   **Try upload (revoked)**. Try the same image again.
7. The server refuses it with `my key has been revoked`; Claude and Synapse
   are not called. The enabled control is only a demo trigger—the server-side
   permission check is the enforcement.

The status event stream remains open after revocation so the page can stay
visible for the demo.

## HTTP interface

| Endpoint | Behavior |
| --- | --- |
| `GET /` | Serves one HTML page with inline CSS and JavaScript; there is no browser build step. |
| `GET /status` | Long-lived server-sent events stream. It sends `{ valetAddress, rootAddress, permissions, expiresAt }`, then `{ revoked: true }` when access is lost. |
| `POST /upload` | Accepts `application/octet-stream` image bytes up to 4 MiB and streams newline-delimited `{ type, text }` records. |

Only one upload can run at a time. A concurrent request receives HTTP `409`,
which avoids competing session-key transactions.

## Runtime construction

The server follows the same verified construction as the terminal agent:

1. Create the Calibration session key with `fromSecp256k1`.
2. Synchronize its on-chain expirations and start the registry watcher.
3. Create an address-only root client; it cannot sign.
4. Construct `Synapse` with the session client as the signer and
   `source: 'filagentkey-agent'`.
5. Run `claude-opus-4-8` with one `store_image` tool and at most five
   iterations.

Storage-provider failures are returned to Claude as retryable tool results.
The session permission is checked before Claude starts and again before the
storage tool runs.

## Verify

```bash
pnpm --filter filagentkey-agent-web typecheck
pnpm --filter filagentkey-agent-web test
```

The tests cover the static page, SSE status and revocation, the revoke
handshake race, immediate NDJSON flushing, permission refusal, the exact
4 MiB boundary, media-type handling, and streamed runtime failures.

To typecheck every workspace package:

```bash
pnpm typecheck
```

## Current limitations

- Calibration testnet only.
- Images only; maximum request size is 4 MiB.
- Storage-provider delays and intermittent timeouts are expected.
- Retrieval is not implemented yet, so the page does not download and render
  the image back from Filecoin.
- The dashboard audit window is approximately 24 hours because of the
  Calibration `getLogs` range cap.
- This is a localhost demo server, not an authenticated production service.
