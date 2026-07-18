/**
 * Spike owner script — CLI stand-in for the FilAgentKey dashboard.
 *
 * Grants a scoped, time-limited session key from the root wallet:
 *   1. generates a fresh session keypair locally
 *   2. login() on the SessionKeyRegistry (CreateDataSet + AddPieces)
 *   3. funds the session key with 0.3 tFIL so it can pay its own gas
 *   4. prints the SESSION_PRIVATE_KEY + ROOT_ADDRESS env block ONCE
 *
 * ROOT_PRIVATE_KEY comes from the environment for this spike only — the
 * dashboard replaces this with the connected browser wallet. It is never
 * printed or persisted.
 */
import process from 'node:process'
import { calibration } from '@filoz/synapse-core/chains'
import {
  AddPiecesPermission,
  CreateDataSetPermission,
  getExpirations,
  login,
  PermissionNames,
} from '@filoz/synapse-core/session-key'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const ROOT_PRIVATE_KEY = process.env.ROOT_PRIVATE_KEY
if (ROOT_PRIVATE_KEY === undefined || !ROOT_PRIVATE_KEY.startsWith('0x')) {
  console.error(
    'Set ROOT_PRIVATE_KEY (0x-prefixed) in the environment.\n' +
      'Spike only — the dashboard uses the connected browser wallet instead.',
  )
  process.exit(1)
}
const ttlMinutes = Number(process.env.SESSION_TTL_MINUTES ?? '60')

const root = privateKeyToAccount(ROOT_PRIVATE_KEY as Hex)
const walletClient = createWalletClient({
  account: root,
  chain: calibration,
  transport: http(),
})
const publicClient = createPublicClient({
  chain: calibration,
  transport: http(),
})

const sessionPrivateKey = generatePrivateKey()
const sessionAccount = privateKeyToAccount(sessionPrivateKey)
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + ttlMinutes * 60)

console.log('FilAgentKey spike — mint a valet key')
console.log(`  root:        ${root.address}`)
console.log(`  session key: ${sessionAccount.address}`)
console.log(
  `  expires:     ${new Date(Number(expiresAt) * 1000).toISOString()} (${ttlMinutes} min)`,
)

console.log('\n1/2 login() — authorizing session key on the registry…')
const loginTx = await login(walletClient, {
  address: sessionAccount.address,
  permissions: [CreateDataSetPermission, AddPiecesPermission],
  expiresAt,
  origin: 'filagentkey',
})
await publicClient.waitForTransactionReceipt({ hash: loginTx, timeout: 180_000 })
console.log(`    confirmed ${loginTx}`)

console.log('2/2 funding session key with 0.3 tFIL for gas…')
const fundTx = await walletClient.sendTransaction({
  to: sessionAccount.address,
  value: parseEther('0.3'),
})
await publicClient.waitForTransactionReceipt({ hash: fundTx, timeout: 180_000 })
console.log(`    confirmed ${fundTx}`)

const expirations = await getExpirations(publicClient, {
  address: root.address,
  sessionKeyAddress: sessionAccount.address,
})
console.log('\nOn-chain authorization state:')
for (const [permission, expiry] of Object.entries(expirations)) {
  const name = PermissionNames[permission as Hex] ?? permission
  const state =
    expiry === 0n ? 'none' : new Date(Number(expiry) * 1000).toISOString()
  console.log(`  ${name}: ${state}`)
}

console.log('\n========== AGENT CREDENTIALS — shown once, never stored ==========')
console.log(`SESSION_PRIVATE_KEY=${sessionPrivateKey}`)
console.log(`ROOT_ADDRESS=${root.address}`)
console.log('===================================================================')
console.log('Run the agent with only these two variables:')
console.log('  SESSION_PRIVATE_KEY=0x… ROOT_ADDRESS=0x… pnpm agent')
