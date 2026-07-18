/**
 * Spike agent — holds ONLY the session private key + the owner's PUBLIC
 * address. Uploads checkpoints to Filecoin under the owner's identity and
 * shuts down live when the owner revokes the key on-chain.
 */
import process from 'node:process'
import { calibration } from '@filoz/synapse-core/chains'
import {
  AddPiecesPermission,
  CreateDataSetPermission,
  fromSecp256k1,
} from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { createClient, http, type Address, type Hex } from 'viem'

const SESSION_PRIVATE_KEY = process.env.SESSION_PRIVATE_KEY
const ROOT_ADDRESS = process.env.ROOT_ADDRESS
if (!SESSION_PRIVATE_KEY?.startsWith('0x') || !ROOT_ADDRESS?.startsWith('0x')) {
  console.error(
    'Set SESSION_PRIVATE_KEY and ROOT_ADDRESS (both 0x-prefixed).\n' +
      'The agent needs nothing else — never give it the root private key.',
  )
  process.exit(1)
}

const sessionKey = fromSecp256k1({
  privateKey: SESSION_PRIVATE_KEY as Hex,
  root: ROOT_ADDRESS as Address,
  chain: calibration,
})

console.log('FilAgentKey spike agent')
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

function shutdown(reason: string): never {
  console.log(`\n🔒 ${reason} — access lost, shutting down.`)
  process.exit(1)
}
// Live revocation arrives as an AuthorizationsUpdated log → expirationsUpdated
// event with expiry=0. ('disconnected' only fires when we call unwatch().)
sessionKey.addEventListener('expirationsUpdated', () => {
  if (!sessionKey.hasPermission(AddPiecesPermission)) {
    shutdown('SESSION KEY REVOKED ON-CHAIN')
  }
})
await sessionKey.watch()

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
let iteration = 0
for (;;) {
  iteration += 1
  const checkpoint = {
    agent: 'filagentkey-spike',
    iteration,
    at: new Date().toISOString(),
    // padding keeps the payload well above the 65-byte piece minimum
    note: 'checkpoint-padding '.repeat(64),
  }
  const bytes = encoder.encode(JSON.stringify(checkpoint))
  if (!sessionKey.hasPermission(AddPiecesPermission)) {
    shutdown('SESSION KEY EXPIRED')
  }
  const expiry = sessionKey.expirations[AddPiecesPermission] ?? 0n
  const remainingMin = Math.max(
    0,
    Math.round((Number(expiry) - Date.now() / 1000) / 60),
  )
  console.log(
    `\n[${iteration}] uploading checkpoint (${bytes.length} bytes, key expires in ~${remainingMin} min)…`,
  )
  try {
    const result = await synapse.storage.upload(bytes)
    console.log(`[${iteration}] stored ✓ PieceCID: ${result.pieceCid.toString()}`)
  } catch (error) {
    console.error(
      `[${iteration}] upload failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000))
}
