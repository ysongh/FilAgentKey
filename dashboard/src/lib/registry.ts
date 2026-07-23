import { calibration } from '@filoz/synapse-core/chains'
import { getExpirations } from '@filoz/synapse-core/session-key'
import {
  getAbiItem,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type Transport,
} from 'viem'
import { getBlockNumber, getLogs } from 'viem/actions'

export const registry = calibration.contracts.sessionKeyRegistry

export const authorizationsUpdatedEvent = getAbiItem({
  abi: registry.abi,
  name: 'AuthorizationsUpdated',
})

// Lotus caps eth_getLogs ranges at 2880 epochs (~24 h at 30 s/epoch); stay
// just under it. Chain state via getExpirations stays authoritative anyway.
const LOOKBACK_BLOCKS = 2870n

export interface AuthorizationEvent {
  identity: Address
  signer: Address
  expiry: bigint
  permissions: readonly Hex[]
  origin: string
  blockNumber: bigint
  txHash: Hex
  blockHash: Hex
  logIndex: number
}

export interface AuthorizationEventPage {
  events: AuthorizationEvent[]
  fromBlock: bigint
}

export interface SessionKeyInfo {
  signer: Address
  /** last non-empty origin seen in the logs */
  origin: string
  /** live per-permission expiry (unix seconds; 0n = not granted / revoked) */
  expirations: Record<Hex, bigint>
  /** union of permissions ever named in this key's events */
  grantedPermissions: readonly Hex[]
  /** newest first */
  events: AuthorizationEvent[]
}

export async function fetchAuthorizationEvents(
  client: Client<Transport, Chain>,
  owner: Address,
): Promise<AuthorizationEventPage> {
  const latest = await getBlockNumber(client)
  const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n
  const logs = await getLogs(client, {
    address: registry.address,
    event: authorizationsUpdatedEvent,
    args: { identity: owner },
    fromBlock,
    toBlock: latest,
  })
  const events = logs
    .filter((log) => log.args.signer !== undefined)
    .map((log) => ({
      identity: owner,
      signer: log.args.signer as Address,
      expiry: log.args.expiry ?? 0n,
      permissions: (log.args.permissions ?? []) as readonly Hex[],
      origin: log.args.origin ?? '',
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      blockHash: log.blockHash,
      logIndex: log.logIndex,
    }))
    .sort(compareEventsNewestFirst)
  return { events, fromBlock }
}

function compareEventsNewestFirst(
  a: AuthorizationEvent,
  b: AuthorizationEvent,
): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber > b.blockNumber ? -1 : 1
  }
  return b.logIndex - a.logIndex
}

function eventId(event: AuthorizationEvent): string {
  return `${event.txHash.toLowerCase()}:${event.logIndex}`
}

export function mergeAuthorizationEvents(
  cached: AuthorizationEvent[],
  recent: AuthorizationEventPage,
): AuthorizationEvent[] {
  const merged = new Map<string, AuthorizationEvent>()
  for (const event of cached) {
    if (event.blockNumber < recent.fromBlock) {
      merged.set(eventId(event), event)
    }
  }
  for (const event of recent.events) {
    merged.set(eventId(event), event)
  }
  return [...merged.values()].sort(compareEventsNewestFirst)
}

export async function fetchSessionKeys(
  client: Client<Transport, Chain>,
  owner: Address,
  cachedEvents: AuthorizationEvent[] = [],
): Promise<SessionKeyInfo[]> {
  const recentEvents = await fetchAuthorizationEvents(client, owner)
  const events = mergeAuthorizationEvents(cachedEvents, recentEvents)

  const bySigner = new Map<
    string,
    { signer: Address; events: AuthorizationEvent[] }
  >()
  for (const event of events) {
    const id = event.signer.toLowerCase()
    const entry = bySigner.get(id)
    if (entry === undefined) {
      bySigner.set(id, { signer: event.signer, events: [event] })
    } else {
      entry.events.push(event)
    }
  }

  return Promise.all(
    [...bySigner.values()].map(async ({ signer, events: keyEvents }) => {
      const expirations = await getExpirations(client, {
        address: owner,
        sessionKeyAddress: signer,
      })
      const grantedPermissions = [
        ...new Set(keyEvents.flatMap((event) => event.permissions)),
      ]
      const origin =
        keyEvents.find((event) => event.origin !== '')?.origin ?? ''
      return {
        signer,
        origin,
        expirations: expirations as Record<Hex, bigint>,
        grantedPermissions,
        events: keyEvents,
      }
    }),
  )
}

/** Filecoin epochs are a fixed 30 s, so block → wall time needs no getBlock. */
const EPOCH_SECONDS = 30

export function eventTimestamp(blockNumber: bigint): number {
  return calibration.genesisTimestamp + Number(blockNumber) * EPOCH_SECONDS
}

export function txExplorerUrl(txHash: Hex): string {
  const base =
    calibration.blockExplorers?.default.url ??
    'https://filecoin-testnet.blockscout.com'
  return `${base}/tx/${txHash}`
}

export type KeyStatus = 'active' | 'expiring' | 'expired' | 'revoked'

export function keyStatus(key: SessionKeyInfo, nowSeconds: number): KeyStatus {
  const expiries = key.grantedPermissions.map(
    (permission) => key.expirations[permission] ?? 0n,
  )
  const now = BigInt(nowSeconds)
  const live = expiries.filter((expiry) => expiry > now)
  if (live.length > 0) {
    const maxRemaining = live.reduce((a, b) => (a > b ? a : b)) - now
    return maxRemaining < 300n ? 'expiring' : 'active'
  }
  return expiries.some((expiry) => expiry > 0n) ? 'expired' : 'revoked'
}
