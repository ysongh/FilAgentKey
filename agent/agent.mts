/**
 * FilAgentKey demo agent — holds ONLY the session private key + the owner's
 * PUBLIC address. Persists data to Filecoin under the owner's identity and
 * shuts down live when the owner revokes the key on-chain.
 *
 * Default mode: a minimal Anthropic tool-use loop — Claude writes short field
 * notes and persists each one via a single `save_checkpoint` tool backed by
 * `synapse.storage.upload`. Requires ANTHROPIC_API_KEY.
 *
 * `--plain`: the Stage 0 bare upload loop (no LLM, no API key needed).
 * `--sweep`: on revocation/expiry, return remaining session-key gas to the
 * owner before exiting (off by default).
 */
import process from 'node:process'
import Anthropic from '@anthropic-ai/sdk'
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { calibration } from '@filoz/synapse-core/chains'
import {
  AddPiecesPermission,
  CreateDataSetPermission,
  fromSecp256k1,
} from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { createClient, http, type Address, type Hex } from 'viem'
import { createLockoutShutdown } from './lockout.mjs'

const plainMode = process.argv.includes('--plain')
const sweepMode = process.argv.includes('--sweep')

const SESSION_PRIVATE_KEY = process.env.SESSION_PRIVATE_KEY
const ROOT_ADDRESS = process.env.ROOT_ADDRESS
if (!SESSION_PRIVATE_KEY?.startsWith('0x') || !ROOT_ADDRESS?.startsWith('0x')) {
  console.error(
    'Set SESSION_PRIVATE_KEY and ROOT_ADDRESS (both 0x-prefixed).\n' +
      'The agent needs nothing else — never give it the root private key.',
  )
  process.exit(1)
}
if (!plainMode && process.env.ANTHROPIC_API_KEY === undefined) {
  console.error(
    'Set ANTHROPIC_API_KEY for the Claude demo agent, or run `pnpm agent --plain` for the bare upload loop.',
  )
  process.exit(1)
}

const sessionKey = fromSecp256k1({
  privateKey: SESSION_PRIVATE_KEY as Hex,
  root: ROOT_ADDRESS as Address,
  chain: calibration,
})

console.log(`FilAgentKey demo agent ${plainMode ? '(plain loop)' : '(Claude tool-use loop)'}`)
console.log(`  valet key: ${sessionKey.address}`)
console.log(`  root:      ${sessionKey.rootAddress}`)

await sessionKey.syncExpirations()
const checks = [
  ['AddPieces', AddPiecesPermission],
  ['CreateDataSet', CreateDataSetPermission],
] as const
console.log('Permissions:')
for (const [name, permission] of checks) {
  console.log(`  ${name} ${sessionKey.hasPermission(permission) ? '✓' : '✗'}`)
}
if (!sessionKey.hasPermission(AddPiecesPermission)) {
  console.error('No AddPieces permission (expired or never granted) — exiting.')
  process.exit(1)
}

const lockout = createLockoutShutdown({
  sweep: sweepMode,
  sweepSessionBalance: async () => {
    const { sweepSessionBalance } = await import('./sweep.mjs')
    await sweepSessionBalance(sessionKey)
  },
})
// Live revocation arrives as an AuthorizationsUpdated log → expirationsUpdated
// event with expiry=0. ('disconnected' only fires when we call unwatch().)
sessionKey.addEventListener('expirationsUpdated', () => {
  if (!sessionKey.hasPermission(AddPiecesPermission)) {
    void lockout.shutdown('SESSION KEY REVOKED ON-CHAIN')
  }
})
await sessionKey.watch()
const initialShutdown = lockout.pending()
if (initialShutdown !== undefined) await initialShutdown

// Node + session-key construction (per the SDK's own session-keys test):
// Synapse.create() only accepts an address-only account over a browser
// (custom) transport, so build the read-only root client ourselves. The root
// account never signs — the session client signs everything.
const rootClient = createClient({
  chain: calibration,
  transport: http(),
  account: ROOT_ADDRESS as Address,
})
const synapse = new Synapse({
  client: rootClient,
  sessionClient: sessionKey.client,
  source: 'filagentkey-agent',
})

const encoder = new TextEncoder()
let uploadCount = 0

/** Uploads bytes under the owner's identity; prints the demo beat lines. */
async function uploadCheckpoint(content: string): Promise<string> {
  if (!sessionKey.hasPermission(AddPiecesPermission)) {
    await lockout.shutdown('SESSION KEY EXPIRED')
  }
  uploadCount += 1
  const n = uploadCount
  const bytes = encoder.encode(content)
  const expiry = sessionKey.expirations[AddPiecesPermission] ?? 0n
  const remainingMin = Math.max(
    0,
    Math.round((Number(expiry) - Date.now() / 1000) / 60),
  )
  console.log(
    `\n[${n}] uploading checkpoint (${bytes.length} bytes, key expires in ~${remainingMin} min)…`,
  )
  const result = await synapse.storage.upload(bytes)
  const pieceCid = result.pieceCid.toString()
  console.log(`[${n}] stored ✓ PieceCID: ${pieceCid}`)
  return pieceCid
}

if (plainMode) {
  for (;;) {
    const checkpoint = {
      agent: 'filagentkey-plain',
      iteration: uploadCount + 1,
      at: new Date().toISOString(),
      // padding keeps the payload well above the 65-byte piece minimum
      note: 'checkpoint-padding '.repeat(64),
    }
    try {
      await uploadCheckpoint(JSON.stringify(checkpoint))
    } catch (error) {
      console.error(
        `upload failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000))
  }
}

// ---------------------------------------------------------------- tool-use loop

const saveCheckpoint = betaTool({
  name: 'save_checkpoint',
  description:
    'Permanently store a completed note on Filecoin under the owner’s identity, ' +
    'using the scoped session key. This is your ONLY form of persistence — ' +
    'anything not checkpointed is lost when you shut down. Storage takes about ' +
    'two minutes per call; that is normal. Returns the PieceCID of the stored data.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title for this note' },
      content: {
        type: 'string',
        description: 'The full text of the note to store (at least 100 characters)',
      },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  run: async ({ title, content }) => {
    try {
      const pieceCid = await uploadCheckpoint(
        JSON.stringify({ agent: 'filagentkey-demo', title, content, at: new Date().toISOString() }),
      )
      return `Stored permanently on Filecoin. PieceCID: ${pieceCid}`
    } catch (error) {
      return `Upload failed (storage provider issue, safe to retry once): ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  },
})

const anthropic = new Anthropic()
const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
console.log(`\nStarting Claude (${model}) — field-notes task, 3 checkpoints…`)

const runner = anthropic.beta.messages.toolRunner({
  model,
  max_tokens: 16000,
  max_iterations: 10,
  tools: [saveCheckpoint],
  system:
    'You are the FilAgentKey demo agent. You hold a scoped, time-limited, ' +
    'owner-revocable session key (a "valet key") to your owner’s Filecoin ' +
    'storage: you may add data under their identity, but you cannot manage ' +
    'their account, and the owner can revoke your access on-chain at any ' +
    'moment. Work diligently and be concise — a sentence or two of narration ' +
    'between checkpoints is plenty.',
  messages: [
    {
      role: 'user',
      content:
        'Write a three-entry field journal on why AI agents should hold scoped, ' +
        'revocable credentials instead of root keys. One entry at a time: compose ' +
        'the entry (under 120 words), save it with save_checkpoint, wait for its ' +
        'PieceCID, then write the next. After the third confirmed save, list the ' +
        'three PieceCIDs and finish.',
    },
  ],
})

for await (const message of runner) {
  for (const block of message.content) {
    if (block.type === 'text' && block.text.trim() !== '') {
      console.log(`\n🤖 ${block.text.trim()}`)
    }
  }
  if (message.stop_reason === 'max_tokens') {
    console.error('(response truncated by max_tokens)')
  }
}

console.log('\nDemo run complete — all checkpoints persisted. Valet key still active until expiry or revocation.')
