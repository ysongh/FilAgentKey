export const pageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FilAgentKey web agent</title>
    <style>
      :root {
        color-scheme: dark;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        background: #09110e;
        color: #e9f4ed;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 15% -10%, rgba(72, 187, 120, 0.17), transparent 35rem),
          linear-gradient(180deg, #0b1511 0%, #08100d 100%);
      }

      header {
        position: sticky;
        z-index: 10;
        top: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        min-height: 4.5rem;
        padding: 1rem clamp(1rem, 4vw, 3rem);
        border-bottom: 1px solid rgba(115, 214, 153, 0.25);
        background: rgba(8, 18, 14, 0.94);
        box-shadow: 0 0.6rem 2rem rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(12px);
        transition:
          border-color 160ms ease,
          background 160ms ease;
      }

      header.revoked {
        border-color: rgba(255, 108, 108, 0.75);
        background: rgba(71, 18, 22, 0.96);
      }

      #status-text {
        min-width: 0;
        font-size: clamp(0.88rem, 2vw, 1rem);
        line-height: 1.45;
      }

      #connection {
        flex: none;
        color: #8da89a;
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      #connection.connected {
        color: #75d99b;
      }

      #connection.revoked {
        color: #ffc1c1;
      }

      main {
        width: min(54rem, calc(100% - 2rem));
        margin: 0 auto;
        padding: clamp(2rem, 6vw, 4rem) 0 5rem;
      }

      .eyebrow {
        margin: 0 0 0.55rem;
        color: #75d99b;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 7vw, 4.2rem);
        line-height: 0.98;
        letter-spacing: -0.05em;
      }

      .lede {
        max-width: 42rem;
        margin: 1rem 0 2rem;
        color: #abc0b2;
        font-size: 1rem;
        line-height: 1.65;
      }

      .panel {
        overflow: hidden;
        border: 1px solid rgba(129, 193, 153, 0.2);
        border-radius: 1.1rem;
        background: rgba(15, 29, 23, 0.84);
        box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.22);
      }

      form {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.8rem;
        padding: 1rem;
        border-bottom: 1px solid rgba(129, 193, 153, 0.15);
      }

      input[type="file"] {
        min-width: 0;
        padding: 0.72rem;
        border: 1px dashed rgba(141, 196, 161, 0.38);
        border-radius: 0.7rem;
        background: #0a1510;
        color: #cfe0d5;
      }

      input[type="file"]::file-selector-button,
      button {
        margin-right: 0.7rem;
        padding: 0.62rem 0.92rem;
        border: 0;
        border-radius: 0.55rem;
        background: #75d99b;
        color: #07110b;
        font: inherit;
        font-weight: 750;
        cursor: pointer;
      }

      button {
        min-width: 7.5rem;
        margin: 0;
      }

      button:disabled,
      input:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }

      .run-state {
        display: flex;
        min-height: 2.8rem;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.7rem 1rem;
        background: rgba(7, 17, 12, 0.62);
        color: #93aa9b;
        font-size: 0.82rem;
      }

      #elapsed {
        flex: none;
        color: #75d99b;
        font-variant-numeric: tabular-nums;
      }

      #chat {
        min-height: 18rem;
        max-height: 34rem;
        overflow-y: auto;
        padding: 0.75rem;
      }

      .line {
        margin: 0.55rem 0;
        padding: 0.72rem 0.82rem;
        border-left: 3px solid #5e7466;
        border-radius: 0.25rem 0.65rem 0.65rem 0.25rem;
        background: rgba(255, 255, 255, 0.035);
        color: #c9d9cf;
        line-height: 1.5;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }

      .line::before {
        display: block;
        margin-bottom: 0.22rem;
        color: #7f9b89;
        content: attr(data-label);
        font-size: 0.66rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .line.assistant {
        border-color: #75d99b;
        color: #effbf3;
      }

      .line.tool,
      .line.tool_result,
      .line.status {
        border-color: #d7b85b;
      }

      .line.error,
      .line.lockout {
        border-color: #ff737d;
        background: rgba(164, 40, 49, 0.15);
        color: #ffd6d9;
      }

      .line.piececid,
      .line.transaction {
        border-color: #69b8ff;
        background: rgba(49, 125, 184, 0.12);
      }

      code {
        color: #b9deff;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      }

      a {
        display: inline-block;
        margin-top: 0.45rem;
        color: #8ccaff;
        font-weight: 700;
        text-underline-offset: 0.2rem;
      }

      @media (max-width: 42rem) {
        header {
          align-items: flex-start;
          flex-direction: column;
          gap: 0.3rem;
        }

        form {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header id="status">
      <div id="status-text">connecting to this agent's session key…</div>
      <div id="connection">connecting</div>
    </header>

    <main>
      <p class="eyebrow">Filecoin Calibration · scoped storage agent</p>
      <h1>Hand it an image,<br>not your root key.</h1>
      <p class="lede">
        The browser sends image bytes to a local agent holding a revocable
        AddPieces session key. Claude invokes its one storage tool, and each
        message arrives here while the Filecoin upload runs.
      </p>

      <section class="panel" aria-label="Web agent">
        <form id="upload-form">
          <input
            id="image-file"
            name="image"
            type="file"
            accept="image/*"
            aria-label="Choose an image"
            disabled
          >
          <button id="store-button" type="submit" disabled>Store image</button>
        </form>
        <div class="run-state">
          <span id="selection">Choose an image up to 4 MiB.</span>
          <span id="elapsed" aria-live="polite">idle</span>
        </div>
        <div id="chat" role="log" aria-live="polite" aria-relevant="additions"></div>
      </section>
    </main>

    <script>
      (function () {
        "use strict";

        var MAX_BYTES = 4 * 1024 * 1024;
        var EXPLORER_BASE = "https://filecoin-testnet.blockscout.com";
        var statusHeader = document.getElementById("status");
        var statusText = document.getElementById("status-text");
        var connection = document.getElementById("connection");
        var form = document.getElementById("upload-form");
        var fileInput = document.getElementById("image-file");
        var storeButton = document.getElementById("store-button");
        var selection = document.getElementById("selection");
        var elapsed = document.getElementById("elapsed");
        var chat = document.getElementById("chat");

        var agentStatus = null;
        var locked = false;
        var uploading = false;
        var elapsedStartedAt = 0;
        var elapsedTimer = null;
        var latestTransaction = null;

        function shortAddress(address) {
          if (typeof address !== "string" || address.length < 12) return "unknown";
          return address.slice(0, 6) + "…" + address.slice(-4);
        }

        function formatDuration(totalSeconds) {
          var seconds = Math.max(0, Math.floor(totalSeconds));
          var minutes = Math.floor(seconds / 60);
          var remainder = seconds % 60;
          return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
        }

        function secondsRemaining() {
          if (!agentStatus) return 0;
          return Math.max(0, agentStatus.expiresAt - Math.floor(Date.now() / 1000));
        }

        function renderHeader() {
          if (!agentStatus) return;
          var allowed =
            agentStatus.permissions &&
            agentStatus.permissions.AddPieces === true &&
            !locked;
          statusText.textContent =
            "this agent holds session key " +
            shortAddress(agentStatus.valetAddress) +
            ", acting for " +
            shortAddress(agentStatus.rootAddress) +
            " · AddPieces " +
            (allowed ? "✓" : "✗") +
            " · expires in " +
            formatDuration(secondsRemaining());
          statusText.title =
            "session key " +
            agentStatus.valetAddress +
            " acting for " +
            agentStatus.rootAddress;
        }

        function syncControls() {
          var ready = agentStatus !== null && !locked;
          fileInput.disabled = !ready || uploading;
          storeButton.disabled =
            !ready || uploading || !fileInput.files || fileInput.files.length === 0;
        }

        function appendLine(type, text) {
          var labels = {
            assistant: "Claude",
            tool: "store_image",
            tool_result: "tool result",
            status: "status",
            transaction: "transaction",
            piececid: "success",
            error: "error",
            lockout: "lockout"
          };
          var safeType = Object.prototype.hasOwnProperty.call(labels, type) ? type : "status";
          var row = document.createElement("div");
          row.className = "line " + safeType;
          row.dataset.label = labels[safeType];

          if (safeType === "piececid") {
            var prefix = document.createTextNode("PieceCID: ");
            var code = document.createElement("code");
            code.textContent = text;
            row.appendChild(prefix);
            row.appendChild(code);
            if (latestTransaction) {
              var br = document.createElement("br");
              var link = document.createElement("a");
              link.href = EXPLORER_BASE + "/tx/" + latestTransaction;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.textContent = "view successful transaction ↗";
              row.appendChild(br);
              row.appendChild(link);
            }
          } else if (
            safeType === "transaction" &&
            /^0x[0-9a-fA-F]{64}$/.test(text)
          ) {
            latestTransaction = text;
            var txLink = document.createElement("a");
            txLink.href = EXPLORER_BASE + "/tx/" + text;
            txLink.target = "_blank";
            txLink.rel = "noopener noreferrer";
            txLink.textContent = text;
            row.appendChild(txLink);
          } else {
            row.textContent = text;
          }

          chat.appendChild(row);
          chat.scrollTop = chat.scrollHeight;
        }

        function lockAgent() {
          if (locked) return;
          locked = true;
          statusHeader.classList.add("revoked");
          connection.className = "revoked";
          connection.textContent = "revoked";
          renderHeader();
          syncControls();
          appendLine(
            "lockout",
            "🔒 my key was revoked — I can no longer store anything."
          );
        }

        function updateCountdown() {
          if (!agentStatus) return;
          renderHeader();
          if (secondsRemaining() === 0) lockAgent();
        }

        function startElapsed() {
          elapsedStartedAt = Date.now();
          if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
          function tick() {
            elapsed.textContent =
              "elapsed " + formatDuration((Date.now() - elapsedStartedAt) / 1000);
          }
          tick();
          elapsedTimer = window.setInterval(tick, 1000);
        }

        function stopElapsed(failed) {
          if (elapsedTimer !== null) {
            window.clearInterval(elapsedTimer);
            elapsedTimer = null;
          }
          var duration = formatDuration((Date.now() - elapsedStartedAt) / 1000);
          elapsed.textContent = (failed ? "stopped after " : "finished in ") + duration;
        }

        function updateSelection() {
          var file = fileInput.files && fileInput.files[0];
          if (!file) {
            selection.textContent = "Choose an image up to 4 MiB.";
          } else {
            selection.textContent =
              file.name + " · " + (file.size / 1024).toFixed(1) + " KiB";
          }
          syncControls();
        }

        async function renderNdjson(response) {
          if (!response.body) throw new Error("the server returned no response stream");
          var reader = response.body.getReader();
          var decoder = new TextDecoder();
          var pending = "";
          var sawError = false;
          var sawPieceCid = false;

          function consume(line) {
            if (!line.trim()) return;
            var record = JSON.parse(line);
            if (
              !record ||
              typeof record.type !== "string" ||
              typeof record.text !== "string"
            ) {
              throw new Error("the server sent an invalid progress record");
            }
            if (record.type === "error") sawError = true;
            if (record.type === "piececid") sawPieceCid = true;
            appendLine(record.type, record.text);
          }

          for (;;) {
            var result = await reader.read();
            if (result.done) break;
            pending += decoder.decode(result.value, { stream: true });
            var lines = pending.split("\n");
            pending = lines.pop() || "";
            lines.forEach(consume);
          }
          pending += decoder.decode();
          if (pending.trim()) consume(pending);
          if (!response.ok && !sawError) {
            throw new Error("upload failed with HTTP " + response.status);
          }
          if (!sawError && !sawPieceCid) {
            sawError = true;
            appendLine("error", "The upload stream ended without a PieceCID.");
          }
          return sawError;
        }

        fileInput.addEventListener("change", updateSelection);

        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          var file = fileInput.files && fileInput.files[0];
          if (!file || uploading || locked) return;

          if (!file.type || file.type.indexOf("image/") !== 0) {
            appendLine("error", "Choose an image file.");
            return;
          }
          if (file.size === 0) {
            appendLine("error", "The selected image is empty.");
            return;
          }
          if (file.size > MAX_BYTES) {
            appendLine("error", "The selected image exceeds the 4 MiB limit.");
            return;
          }
          if (file.size < 65) {
            appendLine("error", "The selected image must be at least 65 bytes.");
            return;
          }

          uploading = true;
          latestTransaction = null;
          syncControls();
          startElapsed();
          appendLine(
            "status",
            "Sending " + file.name + " to Claude and the scoped storage agent…"
          );

          var failed = false;
          try {
            var response = await fetch("/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-File-Name": encodeURIComponent(file.name),
                "X-Image-Type": file.type
              },
              body: file
            });
            var responseType = response.headers.get("content-type") || "";
            if (responseType.indexOf("application/x-ndjson") === -1) {
              var plainError = await response.text();
              throw new Error(plainError || "upload failed with HTTP " + response.status);
            }
            failed = await renderNdjson(response);
          } catch (error) {
            failed = true;
            appendLine(
              "error",
              error instanceof Error ? error.message : String(error)
            );
          } finally {
            uploading = false;
            stopElapsed(failed);
            syncControls();
          }
        });

        var statusEvents = new EventSource("/status");
        statusEvents.onopen = function () {
          if (locked) return;
          connection.className = "connected";
          connection.textContent = "live";
        };
        statusEvents.onmessage = function (event) {
          var update;
          try {
            update = JSON.parse(event.data);
          } catch (_error) {
            return;
          }
          if (update.revoked === true) {
            lockAgent();
            return;
          }
          if (
            typeof update.valetAddress === "string" &&
            typeof update.rootAddress === "string" &&
            typeof update.expiresAt === "number"
          ) {
            agentStatus = update;
            if (
              !update.permissions ||
              update.permissions.AddPieces !== true ||
              update.expiresAt <= Math.floor(Date.now() / 1000)
            ) {
              lockAgent();
            } else {
              renderHeader();
              syncControls();
            }
          }
        };
        statusEvents.onerror = function () {
          if (locked) return;
          connection.className = "";
          connection.textContent = "reconnecting";
        };

        window.setInterval(updateCountdown, 1000);
      })();
    </script>
  </body>
</html>
`
