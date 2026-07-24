import { from as pieceCidFrom } from '@filoz/synapse-core/piece'
import {
  EIP712Types,
  getStorageDomain,
  signAddPiecesAbiParameters,
} from '@filoz/synapse-core/typed-data'
import { getClientDataSets } from '@filoz/synapse-core/warm-storage'
import {
  decodeAbiParameters,
  decodeFunctionData,
  getAbiItem,
  recoverTypedDataAddress,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type Transport,
} from 'viem'
import {
  getBlock,
  getBlockNumber,
  getLogs,
  getTransaction,
} from 'viem/actions'
import { calibration } from '@filoz/synapse-core/chains'
import { PermissionNames } from '@filoz/synapse-core/session-key'
import {
  eventTimestamp,
  type AuthorizationEvent,
  type SessionKeyInfo,
} from './registry'

const piecesAddedEvent = getAbiItem({
  abi: calibration.contracts.pdp.abi,
  name: 'PiecesAdded',
})

// An inclusive [latest - 2879, latest] range is exactly 2880 epochs.
const LOOKBACK_BLOCKS = 2879n
const RPC_CONCURRENCY = 6
const MAX_RPC_CACHE_ENTRIES = 2_000

interface TransactionEnvelope {
  input: Hex
  to: Address | null
}

const transactionInputCache = new Map<Hex, Promise<TransactionEnvelope>>()
const blockTimestampCache = new Map<Hex, Promise<number>>()
const debuggedTransactions = new Set<Hex>()

export type StorageAttribution =
  | { kind: 'signature-recovered'; signer: Address }
  | { kind: 'owner-direct'; signer: Address }
  | { kind: 'unattributed'; reason: string }

export interface StorageAuditEvent {
  action: 'stored'
  detail: string
  txHash: Hex
  blockHash: Hex
  blockNumber: bigint
  logIndex: number
  pieceIndex: number
  timestamp: number
  attribution: StorageAttribution
}

export interface StorageAuditPage {
  events: StorageAuditEvent[]
  fromBlock: bigint
  toBlock: bigint
}

export interface AuditTrailEntry {
  id: string
  action: 'stored' | 'authorized' | 'renewed' | 'revoked'
  detail: string
  txHash: Hex
  blockNumber: bigint
  logIndex: number
  subIndex: number
  timestamp: number
  badge: 'signature-verified' | 'registry'
}

interface RawPiecesAddedLog {
  setId: bigint
  pieceIds: readonly bigint[]
  pieceCids: readonly { data: Hex }[]
  txHash: Hex
  blockHash: Hex
  blockNumber: bigint
  logIndex: number
}

export type SignerRecovery =
  | { kind: 'recovered'; signer: Address }
  | { kind: 'unattributed'; reason: string }

function cachePromise<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  if (cache.size >= MAX_RPC_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest !== undefined) cache.delete(oldest)
  }

  const pending = load().catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

async function retryOnce<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    return operation()
  }
}

async function transactionEnvelope(
  client: Client<Transport, Chain>,
  hash: Hex,
): Promise<TransactionEnvelope> {
  return cachePromise(transactionInputCache, hash, async () => {
    const transaction = await getTransaction(client, { hash })
    return { input: transaction.input, to: transaction.to }
  })
}

async function timestampForBlock(
  client: Client<Transport, Chain>,
  blockHash: Hex,
  blockNumber: bigint,
): Promise<number> {
  try {
    return await retryOnce(() =>
      cachePromise(blockTimestampCache, blockHash, async () => {
        const block = await getBlock(client, { blockHash })
        const timestamp = Number(block.timestamp)
        if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
          throw new Error('invalid block timestamp')
        }
        return timestamp
      }),
    )
  } catch {
    // Filecoin epochs are fixed at 30 seconds; this fallback is already used
    // by the registry activity feed and keeps one block RPC failure local.
    return eventTimestamp(blockNumber)
  }
}

function metadataFromArrays(
  pieceCount: number,
  keys: readonly (readonly string[])[],
  values: readonly (readonly string[])[],
):
  | {
      pieceIndex: bigint
      metadata: { key: string; value: string }[]
    }[]
  | undefined {
  if (keys.length !== pieceCount || values.length !== pieceCount) {
    return undefined
  }

  const metadata = []
  for (let index = 0; index < pieceCount; index += 1) {
    const pieceKeys = keys[index]
    const pieceValues = values[index]
    if (
      pieceKeys === undefined ||
      pieceValues === undefined ||
      pieceKeys.length !== pieceValues.length
    ) {
      return undefined
    }
    metadata.push({
      pieceIndex: BigInt(index),
      metadata: pieceKeys.map((key, valueIndex) => ({
        key,
        value: pieceValues[valueIndex] as string,
      })),
    })
  }
  return metadata
}

export async function recoverAddPiecesSigner(
  input: Hex,
  expectedSetId: bigint,
  clientDataSetId: bigint,
): Promise<SignerRecovery> {
  try {
    const decoded = decodeFunctionData({
      abi: calibration.contracts.pdp.abi,
      data: input,
    })
    if (decoded.functionName !== 'addPieces') {
      return {
        kind: 'unattributed',
        reason: 'non-standard submission',
      }
    }

    // Standard provider submissions may pass the zero listener even though
    // signAddPieces uses the FWSS EIP-712 domain, so listenerAddr is not an
    // attribution signal. The recovered signer + registry match is.
    const [setId, , pieceData, extraData] = decoded.args
    if (setId !== expectedSetId) {
      return {
        kind: 'unattributed',
        reason: 'dataset mismatch',
      }
    }

    const [nonce, metadataKeys, metadataValues, signature] =
      decodeAbiParameters(signAddPiecesAbiParameters, extraData)
    const pieceMetadata = metadataFromArrays(
      pieceData.length,
      metadataKeys,
      metadataValues,
    )
    if (pieceMetadata === undefined) {
      return {
        kind: 'unattributed',
        reason: 'metadata mismatch',
      }
    }

    const signer = await recoverTypedDataAddress({
      domain: getStorageDomain({ chain: calibration }),
      types: EIP712Types,
      primaryType: 'AddPieces',
      message: {
        clientDataSetId,
        nonce,
        pieceData,
        pieceMetadata,
      },
      signature,
    })
    return { kind: 'recovered', signer }
  } catch {
    return {
      kind: 'unattributed',
      reason: 'non-standard submission',
    }
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  limit: number,
  transform: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      output[index] = await transform(values[index] as T)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, values.length) },
      async () => worker(),
    ),
  )
  return output
}

function pieceDetail(
  pieceCid: { data: Hex } | undefined,
  pieceId: bigint | undefined,
): string {
  if (pieceCid !== undefined) {
    try {
      return pieceCidFrom(pieceCid.data).toString()
    } catch {
      // Fall through to the on-chain piece id.
    }
  }
  return pieceId === undefined ? 'piece added' : `piece #${pieceId}`
}

function compareAuditNewestFirst(
  a: Pick<StorageAuditEvent, 'blockNumber' | 'logIndex' | 'pieceIndex'>,
  b: Pick<StorageAuditEvent, 'blockNumber' | 'logIndex' | 'pieceIndex'>,
): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber > b.blockNumber ? -1 : 1
  }
  if (a.logIndex !== b.logIndex) return b.logIndex - a.logIndex
  return a.pieceIndex - b.pieceIndex
}

export async function fetchStorageAuditEvents(
  client: Client<Transport, Chain>,
  owner: Address,
): Promise<StorageAuditPage> {
  const [latest, dataSets] = await Promise.all([
    getBlockNumber(client),
    getClientDataSets(client, { address: owner }),
  ])
  const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n
  const dataSetById = new Map(
    dataSets.map((dataSet) => [dataSet.dataSetId.toString(), dataSet]),
  )
  const dataSetIds = [...dataSetById.values()].map(
    (dataSet) => dataSet.dataSetId,
  )
  if (dataSetIds.length === 0) {
    return { events: [], fromBlock, toBlock: latest }
  }

  const logs = await getLogs(client, {
    address: calibration.contracts.pdp.address,
    event: piecesAddedEvent,
    args: { setId: dataSetIds },
    fromBlock,
    toBlock: latest,
  })
  const parsedLogs: RawPiecesAddedLog[] = logs.flatMap((log) => {
    const { setId, pieceIds, pieceCids } = log.args
    if (
      setId === undefined ||
      pieceIds === undefined ||
      pieceCids === undefined
    ) {
      return []
    }
    return [
      {
        setId,
        pieceIds,
        pieceCids,
        txHash: log.transactionHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      },
    ]
  })

  const eventGroups = await mapWithConcurrency(
    parsedLogs,
    RPC_CONCURRENCY,
    async (log): Promise<StorageAuditEvent[]> => {
      const timestampPromise = timestampForBlock(
        client,
        log.blockHash,
        log.blockNumber,
      )
      const dataSet = dataSetById.get(log.setId.toString())
      let recovery: SignerRecovery
      if (dataSet === undefined) {
        recovery = {
          kind: 'unattributed',
          reason: 'dataset metadata unavailable',
        }
      } else {
        try {
          const transaction = await retryOnce(() =>
            transactionEnvelope(client, log.txHash),
          )
          recovery =
            transaction.to?.toLowerCase() ===
            calibration.contracts.pdp.address.toLowerCase()
              ? await recoverAddPiecesSigner(
                  transaction.input,
                  log.setId,
                  dataSet.clientDataSetId,
                )
              : {
                  kind: 'unattributed',
                  reason: 'non-standard submission',
                }
        } catch {
          recovery = {
            kind: 'unattributed',
            reason: 'RPC unavailable after retry',
          }
        }
      }

      let attribution: StorageAttribution
      if (recovery.kind === 'unattributed') {
        attribution = recovery
      } else if (recovery.signer.toLowerCase() === owner.toLowerCase()) {
        attribution = { kind: 'owner-direct', signer: recovery.signer }
      } else {
        attribution = {
          kind: 'signature-recovered',
          signer: recovery.signer,
        }
        if (!debuggedTransactions.has(log.txHash)) {
          console.debug(
            `[FilAgentKey audit] recovered ${recovery.signer} from ${log.txHash}`,
          )
          debuggedTransactions.add(log.txHash)
          if (debuggedTransactions.size > MAX_RPC_CACHE_ENTRIES) {
            debuggedTransactions.clear()
          }
        }
      }

      const timestamp = await timestampPromise
      const pieceCount = Math.max(
        log.pieceIds.length,
        log.pieceCids.length,
        1,
      )
      return Array.from({ length: pieceCount }, (_, pieceIndex) => ({
        action: 'stored' as const,
        detail: pieceDetail(
          log.pieceCids[pieceIndex],
          log.pieceIds[pieceIndex],
        ),
        txHash: log.txHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        pieceIndex,
        timestamp,
        attribution,
      }))
    },
  )

  return {
    events: eventGroups.flat().sort(compareAuditNewestFirst),
    fromBlock,
    toBlock: latest,
  }
}

function compareAuthorizationOldestFirst(
  a: AuthorizationEvent,
  b: AuthorizationEvent,
): number {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1
  }
  return a.logIndex - b.logIndex
}

function permissionDetail(event: AuthorizationEvent): string {
  if (event.permissions.length === 0) return 'all permissions'
  return event.permissions
    .map((permission) => PermissionNames[permission] ?? permission)
    .join(', ')
}

export function buildKeyAuditTrail(
  key: SessionKeyInfo,
  storageEvents: readonly StorageAuditEvent[],
): AuditTrailEntry[] {
  let previouslyAuthorized = false
  const lifecycleEntries = [...key.events]
    .sort(compareAuthorizationOldestFirst)
    .map((event): AuditTrailEntry => {
      const revoked = event.expiry === 0n
      const action = revoked
        ? 'revoked'
        : previouslyAuthorized
          ? 'renewed'
          : 'authorized'
      if (!revoked) previouslyAuthorized = true
      return {
        id: `registry:${event.txHash}:${event.logIndex}`,
        action,
        detail: permissionDetail(event),
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        logIndex: event.logIndex,
        subIndex: 0,
        timestamp: eventTimestamp(event.blockNumber),
        badge: 'registry',
      }
    })

  const signer = key.signer.toLowerCase()
  const storageEntries = storageEvents.flatMap(
    (event): AuditTrailEntry[] => {
      if (
        event.attribution.kind !== 'signature-recovered' ||
        event.attribution.signer.toLowerCase() !== signer
      ) {
        return []
      }
      return [
        {
          id: `storage:${event.txHash}:${event.logIndex}:${event.pieceIndex}`,
          action: event.action,
          detail: event.detail,
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          logIndex: event.logIndex,
          subIndex: event.pieceIndex,
          timestamp: event.timestamp,
          badge: 'signature-verified',
        },
      ]
    },
  )

  return [...lifecycleEntries, ...storageEntries].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber > b.blockNumber ? -1 : 1
    }
    if (a.logIndex !== b.logIndex) return b.logIndex - a.logIndex
    return a.subIndex - b.subIndex
  })
}

export interface PartitionedStorageAudit {
  bySigner: Record<string, StorageAuditEvent[]>
  other: StorageAuditEvent[]
}

export function partitionStorageAudit(
  events: readonly StorageAuditEvent[],
  keys: readonly SessionKeyInfo[],
): PartitionedStorageAudit {
  const knownSigners = new Set(keys.map((key) => key.signer.toLowerCase()))
  const bySigner: Record<string, StorageAuditEvent[]> = {}
  const other: StorageAuditEvent[] = []

  for (const event of events) {
    if (
      event.attribution.kind === 'signature-recovered' &&
      knownSigners.has(event.attribution.signer.toLowerCase())
    ) {
      const signer = event.attribution.signer.toLowerCase()
      ;(bySigner[signer] ??= []).push(event)
    } else {
      other.push(event)
    }
  }
  return { bySigner, other }
}
