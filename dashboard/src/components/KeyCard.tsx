import { PermissionNames } from '@filoz/synapse-core/session-key'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Hex } from 'viem'
import { useWalletClient } from 'wagmi'
import { useEnsureChain } from '../hooks/useEnsureChain'
import { useNow } from '../hooks/useNow'
import { keyStatus, type KeyStatus, type SessionKeyInfo } from '../lib/registry'
import { revokeAgentKey } from '../lib/write'

const statusStyles: Record<KeyStatus, { label: string; className: string }> = {
  active: { label: 'active', className: 'bg-emerald-500/15 text-emerald-400' },
  expiring: { label: 'expiring soon', className: 'bg-amber-500/15 text-amber-400' },
  expired: { label: 'expired', className: 'bg-zinc-500/15 text-zinc-400' },
  revoked: { label: 'revoked', className: 'bg-red-500/15 text-red-400' },
}

function formatRemaining(seconds: bigint): string {
  const total = Number(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function KeyCard({ info }: { info: SessionKeyInfo }) {
  const now = useNow()
  const status = keyStatus(info, now)
  const badge = statusStyles[status]
  const { data: walletClient } = useWalletClient()
  const ensureChain = useEnsureChain()
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const revoke = async () => {
    if (walletClient === undefined) return
    setRevokeError(null)
    setRevoking(true)
    try {
      await ensureChain()
      await revokeAgentKey(walletClient, info.signer)
      await queryClient.invalidateQueries({ queryKey: ['sessionKeys'] })
    } catch (cause) {
      setRevokeError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm" title={info.signer}>
            {truncate(info.signer)}
          </span>
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => void navigator.clipboard.writeText(info.signer)}
            title="Copy session key address"
          >
            copy
          </button>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {info.origin !== '' && (
        <div className="text-xs text-zinc-500">
          origin <span className="text-zinc-300">{info.origin}</span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {info.grantedPermissions.map((permission) => {
          const expiry = info.expirations[permission] ?? 0n
          const name = PermissionNames[permission as Hex] ?? truncate(permission)
          const remaining = expiry - BigInt(now)
          let state: string
          let stateClass = 'text-zinc-500'
          if (expiry === 0n) {
            state = 'revoked'
            stateClass = 'text-red-400'
          } else if (remaining > 0n) {
            state = formatRemaining(remaining)
            stateClass = remaining < 300n ? 'text-amber-400' : 'text-emerald-400'
          } else {
            state = 'expired'
          }
          return (
            <li
              key={permission}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-zinc-300">{name}</span>
              <span className={`font-mono text-xs ${stateClass}`}>{state}</span>
            </li>
          )
        })}
      </ul>

      {(status === 'active' || status === 'expiring') && (
        <button
          type="button"
          onClick={() => void revoke()}
          disabled={revoking || walletClient === undefined}
          className="self-start rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      )}
      {revokeError !== null && (
        <p className="break-all text-xs text-red-400">{revokeError}</p>
      )}
    </div>
  )
}
