// Read-only status probe: balances + live authorization state for the
// session key configured in .env. Run: npx tsx --env-file=.env check-status.mts
import process from 'node:process'
import { calibration } from '@filoz/synapse-core/chains'
import { getExpirations, PermissionNames } from '@filoz/synapse-core/session-key'
import { createPublicClient, formatEther, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const SESSION_PRIVATE_KEY = process.env.SESSION_PRIVATE_KEY
const ROOT_ADDRESS = process.env.ROOT_ADDRESS
if (!SESSION_PRIVATE_KEY?.startsWith('0x') || !ROOT_ADDRESS?.startsWith('0x')) {
  console.error('Set SESSION_PRIVATE_KEY and ROOT_ADDRESS (e.g. via --env-file=.env).')
  process.exit(1)
}
const root = ROOT_ADDRESS as Address
const session = privateKeyToAccount(SESSION_PRIVATE_KEY as Hex).address

const client = createPublicClient({ chain: calibration, transport: http() })
const [rootBal, sessionBal] = await Promise.all([
  client.getBalance({ address: root }),
  client.getBalance({ address: session }),
])
console.log(`root:            ${root} (${formatEther(rootBal)} tFIL)`)
console.log(`session key:     ${session} (${formatEther(sessionBal)} tFIL)`)

const expirations = await getExpirations(client, {
  address: root,
  sessionKeyAddress: session,
})
const now = Math.floor(Date.now() / 1000)
for (const [permission, expiry] of Object.entries(expirations)) {
  const name = PermissionNames[permission as Hex] ?? permission
  const state =
    expiry === 0n
      ? 'not granted'
      : `${new Date(Number(expiry) * 1000).toISOString()} (${expiry > BigInt(now) ? 'ACTIVE' : 'expired'})`
  console.log(`${name}: ${state}`)
}
