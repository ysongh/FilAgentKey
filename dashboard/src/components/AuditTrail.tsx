import type { ReactNode } from 'react'
import type { Address, Hex } from 'viem'
import {
  buildKeyAuditTrail,
  type AuditTrailEntry,
  type StorageAuditEvent,
} from '../lib/audit'
import { txExplorerUrl, type SessionKeyInfo } from '../lib/registry'

const actionStyles: Record<AuditTrailEntry['action'], string> = {
  stored: 'text-sky-400',
  authorized: 'text-emerald-400',
  renewed: 'text-amber-400',
  revoked: 'text-red-400',
}

function truncate(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function dateFromTimestamp(timestamp: number): Date | null {
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp * 1_000)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function TxLink({ hash }: { hash: Hex }) {
  return (
    <a
      href={txExplorerUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="ml-auto shrink-0 text-sky-500 hover:text-sky-400"
    >
      tx ↗
    </a>
  )
}

function AuditRow({
  entry,
  footer,
}: {
  entry: Pick<
    AuditTrailEntry,
    'action' | 'detail' | 'timestamp' | 'txHash'
  >
  footer?: ReactNode
}) {
  const date = dateFromTimestamp(entry.timestamp)
  return (
    <li className="flex flex-col gap-1 border-t border-zinc-800/60 py-2 first:border-t-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
        <time
          dateTime={date?.toISOString()}
          className="shrink-0 text-zinc-500"
        >
          {date === null ? 'time unavailable' : formatTimestamp(date)}
        </time>
        <span className="text-zinc-700">·</span>
        <span className={actionStyles[entry.action]}>{entry.action}</span>
        <span className="text-zinc-700">·</span>
        <span className="min-w-0 break-all text-zinc-300" title={entry.detail}>
          {entry.detail}
        </span>
        <TxLink hash={entry.txHash} />
      </div>
      {footer}
    </li>
  )
}

export function AuditTrail({
  info,
  storageEvents,
  storagePending,
  storageError,
}: {
  info: SessionKeyInfo
  storageEvents: readonly StorageAuditEvent[]
  storagePending: boolean
  storageError: Error | null
}) {
  let entries: AuditTrailEntry[] = []
  let renderError: string | null = null
  try {
    entries = buildKeyAuditTrail(info, storageEvents)
  } catch (cause) {
    renderError = cause instanceof Error ? cause.message : String(cause)
  }

  return (
    <details className="border-t border-zinc-800/80 pt-3">
      <summary className="cursor-pointer select-none text-xs font-medium text-zinc-400 hover:text-zinc-200">
        Audit trail{' '}
        <span className="font-normal text-zinc-600">({entries.length})</span>
      </summary>
      <div className="mt-2">
        {storagePending && (
          <p className="pb-2 text-xs text-zinc-600">
            Loading storage actions…
          </p>
        )}
        {storageError !== null && (
          <p className="pb-2 text-xs text-amber-400">
            Storage actions unavailable; registry history is still shown.
          </p>
        )}
        {renderError !== null && (
          <p className="pb-2 text-xs text-amber-400">
            Audit trail unavailable: {renderError}
          </p>
        )}
        {entries.length === 0 ? (
          <p className="py-2 text-xs text-zinc-600">
            No on-chain actions yet.
          </p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                footer={
                  <span
                    className={`self-start rounded-full px-1.5 py-0.5 text-[10px] ${
                      entry.badge === 'signature-verified'
                        ? 'bg-sky-500/10 text-sky-400'
                        : 'bg-zinc-500/10 text-zinc-500'
                    }`}
                  >
                    {entry.badge}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

function otherAttribution(event: StorageAuditEvent): {
  label: string
  className: string
} {
  if (event.attribution.kind === 'owner-direct') {
    return {
      label: 'owner (direct)',
      className: 'bg-violet-500/10 text-violet-400',
    }
  }
  if (event.attribution.kind === 'signature-recovered') {
    return {
      label: `${truncate(event.attribution.signer)} · unknown signer`,
      className: 'bg-amber-500/10 text-amber-400',
    }
  }
  return {
    label: `unattributed · ${event.attribution.reason}`,
    className: 'bg-zinc-500/10 text-zinc-500',
  }
}

export function OtherStorageActions({
  events,
}: {
  events: readonly StorageAuditEvent[]
}) {
  if (events.length === 0) return null
  const unattributedCount = events.filter(
    (event) => event.attribution.kind === 'unattributed',
  ).length

  return (
    <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <summary className="cursor-pointer select-none text-sm font-medium text-zinc-400 hover:text-zinc-200">
        Other dataset actions{' '}
        <span className="font-normal text-zinc-600">({events.length})</span>
      </summary>
      <ul className="mt-2">
        {events.map((event) => {
          const attribution = otherAttribution(event)
          return (
            <AuditRow
              key={`${event.txHash}:${event.logIndex}:${event.pieceIndex}`}
              entry={event}
              footer={
                <span
                  className={`self-start rounded-full px-1.5 py-0.5 text-[10px] ${attribution.className}`}
                >
                  {attribution.label}
                </span>
              }
            />
          )
        })}
      </ul>
      <p className="mt-2 border-t border-zinc-800/60 pt-2 text-xs text-zinc-600">
        {unattributedCount} unattributed{' '}
        {unattributedCount === 1 ? 'entry' : 'entries'} in this dataset
        window.
      </p>
    </details>
  )
}
