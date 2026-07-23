import { calibration } from '@filoz/synapse-core/chains'
import { isAddress, type Address, type Hex } from 'viem'
import type { AuthorizationEvent, SessionKeyInfo } from './registry'

const CACHE_VERSION = 1
const CACHE_PREFIX = 'filagentkey:session-keys'
const MAX_CACHE_BYTES = 1_000_000
const MAX_CACHED_KEYS = 200
const MAX_EVENTS_PER_KEY = 100
const MAX_TOTAL_EVENTS = 2_000
const MAX_PERMISSIONS = 32
const MAX_ORIGIN_LENGTH = 1_024

interface CachedAuthorizationEvent {
  identity: Address
  signer: Address
  expiry: string
  permissions: Hex[]
  origin: string
  blockNumber: string
  txHash: Hex
  blockHash: Hex
  logIndex: number
}

interface CachedSessionKey {
  address: Address
  permissions: Hex[]
  origin: string
  createdTxHash: Hex | null
  createdBlockNumber: string | null
  events: CachedAuthorizationEvent[]
}

interface SessionKeyCache {
  version: typeof CACHE_VERSION
  chainId: typeof calibration.id
  owner: Address
  keys: CachedSessionKey[]
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function sessionKeyCacheKey(owner: Address): string {
  return `${CACHE_PREFIX}:${calibration.id}:${owner.toLowerCase()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseBigInt(value: unknown): bigint | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function parsePermissions(value: unknown): Hex[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PERMISSIONS ||
    !value.every(isBytes32)
  ) {
    return undefined
  }
  return value as Hex[]
}

function parseEvent(
  value: unknown,
  owner: Address,
): AuthorizationEvent | undefined {
  if (!isRecord(value)) return undefined
  const expiry = parseBigInt(value.expiry)
  const blockNumber = parseBigInt(value.blockNumber)
  const permissions = parsePermissions(value.permissions)
  if (
    typeof value.identity !== 'string' ||
    !isAddress(value.identity) ||
    value.identity.toLowerCase() !== owner.toLowerCase() ||
    typeof value.signer !== 'string' ||
    !isAddress(value.signer) ||
    expiry === undefined ||
    permissions === undefined ||
    typeof value.origin !== 'string' ||
    value.origin.length > MAX_ORIGIN_LENGTH ||
    blockNumber === undefined ||
    !isBytes32(value.txHash) ||
    !isBytes32(value.blockHash) ||
    typeof value.logIndex !== 'number' ||
    !Number.isSafeInteger(value.logIndex) ||
    value.logIndex < 0
  ) {
    return undefined
  }
  return {
    identity: value.identity,
    signer: value.signer,
    expiry,
    permissions,
    origin: value.origin,
    blockNumber,
    txHash: value.txHash,
    blockHash: value.blockHash,
    logIndex: value.logIndex,
  }
}

function parseCache(value: unknown, owner: Address): AuthorizationEvent[] {
  if (
    !isRecord(value) ||
    value.version !== CACHE_VERSION ||
    value.chainId !== calibration.id ||
    typeof value.owner !== 'string' ||
    !isAddress(value.owner) ||
    value.owner.toLowerCase() !== owner.toLowerCase() ||
    !Array.isArray(value.keys) ||
    value.keys.length > MAX_CACHED_KEYS
  ) {
    return []
  }

  const events: AuthorizationEvent[] = []
  for (const key of value.keys) {
    if (!isRecord(key)) continue
    const createdBlockNumber = parseBigInt(key.createdBlockNumber)
    const hasCreation =
      isBytes32(key.createdTxHash) &&
      createdBlockNumber !== undefined
    const hasNoCreation =
      key.createdTxHash === null &&
      key.createdBlockNumber === null
    if (
      typeof key.address !== 'string' ||
      !isAddress(key.address) ||
      parsePermissions(key.permissions) === undefined ||
      typeof key.origin !== 'string' ||
      key.origin.length > MAX_ORIGIN_LENGTH ||
      (!hasCreation && !hasNoCreation) ||
      !Array.isArray(key.events) ||
      key.events.length > MAX_EVENTS_PER_KEY
    ) {
      continue
    }
    for (const event of key.events) {
      const parsed = parseEvent(event, owner)
      if (
        parsed !== undefined &&
        parsed.signer.toLowerCase() === key.address.toLowerCase()
      ) {
        events.push(parsed)
        if (events.length > MAX_TOTAL_EVENTS) return []
      }
    }
  }
  return events
}

export function loadCachedAuthorizationEvents(
  owner: Address,
  storage: Storage | undefined = browserStorage(),
): AuthorizationEvent[] {
  if (storage === undefined) return []
  try {
    const encoded = storage.getItem(sessionKeyCacheKey(owner))
    if (encoded === null || encoded.length > MAX_CACHE_BYTES) return []
    return parseCache(JSON.parse(encoded), owner)
  } catch {
    return []
  }
}

function serializeEvent(event: AuthorizationEvent): CachedAuthorizationEvent {
  return {
    identity: event.identity,
    signer: event.signer,
    expiry: event.expiry.toString(),
    permissions: [...event.permissions].slice(0, MAX_PERMISSIONS),
    origin: event.origin.slice(0, MAX_ORIGIN_LENGTH),
    blockNumber: event.blockNumber.toString(),
    txHash: event.txHash,
    blockHash: event.blockHash,
    logIndex: event.logIndex,
  }
}

function serializeCache(owner: Address, keys: SessionKeyInfo[]): SessionKeyCache {
  const cachedKeys: CachedSessionKey[] = []
  let remainingEvents = MAX_TOTAL_EVENTS
  for (const key of keys.slice(0, MAX_CACHED_KEYS)) {
    const events = key.events.slice(
      0,
      Math.min(MAX_EVENTS_PER_KEY, remainingEvents),
    )
    if (events.length === 0) continue
    const creation = [...key.events]
      .reverse()
      .find((event) => event.expiry > 0n)
    cachedKeys.push({
      address: key.signer,
      permissions: [...key.grantedPermissions]
        .slice(0, MAX_PERMISSIONS)
        .sort(),
      origin: key.origin.slice(0, MAX_ORIGIN_LENGTH),
      createdTxHash: creation?.txHash ?? null,
      createdBlockNumber: creation?.blockNumber.toString() ?? null,
      events: events.map(serializeEvent),
    })
    remainingEvents -= events.length
    if (remainingEvents === 0) break
  }
  cachedKeys.sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
  )

  return {
    version: CACHE_VERSION,
    chainId: calibration.id,
    owner,
    keys: cachedKeys,
  }
}

export function saveSessionKeyCache(
  owner: Address,
  keys: SessionKeyInfo[],
  storage: Storage | undefined = browserStorage(),
): void {
  if (storage === undefined) return
  try {
    const cacheKey = sessionKeyCacheKey(owner)
    const encoded = JSON.stringify(serializeCache(owner, keys))
    if (encoded.length > MAX_CACHE_BYTES) return
    if (storage.getItem(cacheKey) !== encoded) {
      storage.setItem(cacheKey, encoded)
    }
  } catch {
    // localStorage can be blocked, corrupt, or over quota; chain reads continue.
  }
}
