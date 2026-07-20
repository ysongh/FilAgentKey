import { PermissionNames } from '@filoz/synapse-core/session-key'
import type { Hex } from 'viem'
import { useNow } from '../hooks/useNow'
import { useSessionKeys } from '../hooks/useSessionKeys'
import { eventTimestamp, txExplorerUrl } from '../lib/registry'

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ${m % 60} min ago`
  return `${Math.floor(h / 24)} d ago`
}

export function ActivityFeed() {
  const { data } = useSessionKeys()
  const now = useNow(30_000)

  if (data === undefined) return null

  const events = data
    .flatMap((key) => key.events)
    .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-zinc-400">
        Activity <span className="font-normal text-zinc-600">· last ~24 h, from chain logs</span>
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-zinc-600">No activity in the last ~24 h.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-zinc-900/40">
          {events.map((event) => {
            const revoked = event.expiry === 0n
            const names = event.permissions
              .map((p) => PermissionNames[p as Hex] ?? truncate(p))
              .join(', ')
            return (
              <li
                key={`${event.txHash}-${event.signer}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${revoked ? 'bg-red-400' : 'bg-emerald-400'}`}
                />
                <span className={revoked ? 'text-red-400' : 'text-emerald-400'}>
                  {revoked ? 'revoked' : 'authorized'}
                </span>
                <span className="font-mono text-xs text-zinc-300" title={event.signer}>
                  {truncate(event.signer)}
                </span>
                <span className="text-xs text-zinc-500">{names}</span>
                {event.origin !== '' && (
                  <span className="text-xs text-zinc-600">via {event.origin}</span>
                )}
                <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                  {formatAgo(now - eventTimestamp(event.blockNumber))}
                  <a
                    href={txExplorerUrl(event.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-500 hover:text-sky-400"
                  >
                    tx ↗
                  </a>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
