import {
  AddPiecesPermission,
  CreateDataSetPermission,
  PermissionNames,
  SchedulePieceRemovalsPermission,
  TerminateServicePermission,
} from '@filoz/synapse-core/session-key'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Hex } from 'viem'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { useEnsureChain } from '../hooks/useEnsureChain'
import {
  createAgentKey,
  type CreatedKey,
  type CreateProgress,
} from '../lib/write'

const ALL_PERMISSIONS: Hex[] = [
  AddPiecesPermission,
  CreateDataSetPermission,
  SchedulePieceRemovalsPermission,
  TerminateServicePermission,
]

const TTL_PRESETS = [
  { label: '15 min', seconds: 15 * 60 },
  { label: '1 h', seconds: 60 * 60 },
  { label: '24 h', seconds: 24 * 60 * 60 },
] as const

const PROGRESS_LABELS: Record<CreateProgress, string> = {
  simulating: 'Preparing transaction…',
  'wallet-confirm': 'Confirm in your wallet…',
  confirming: 'Waiting for on-chain confirmation…',
  funding: 'Funding the key with 0.3 tFIL — confirm in your wallet…',
}

function Reveal({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  const { address } = useAccount()
  const [copied, setCopied] = useState(false)
  const envBlock = `SESSION_PRIVATE_KEY=${created.privateKey}\nROOT_ADDRESS=${address ?? ''}`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-zinc-900 p-4">
      <h3 className="font-semibold text-amber-400">
        Agent credentials — shown once, never stored
      </h3>
      <p className="text-sm text-zinc-400">
        Give these two variables to your agent (e.g.{' '}
        <span className="font-mono text-zinc-300">agent/.env</span>). The
        private key exists only on this screen; once you dismiss it, it is
        gone forever.
      </p>
      <pre className="overflow-x-auto rounded-md bg-black/60 p-3 font-mono text-xs text-zinc-200">
        {envBlock}
      </pre>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-400"
          onClick={() => {
            void navigator.clipboard.writeText(envBlock)
            setCopied(true)
          }}
        >
          {copied ? 'Copied ✓' : 'Copy env block'}
        </button>
        <button
          type="button"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          onClick={onDone}
        >
          I've saved this — dismiss forever
        </button>
      </div>
    </div>
  )
}

export function CreateKey() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Hex[]>([AddPiecesPermission])
  const [ttl, setTtl] = useState<number>(TTL_PRESETS[0].seconds)
  const [progress, setProgress] = useState<CreateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedKey | null>(null)

  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const ensureChain = useEnsureChain()
  const queryClient = useQueryClient()

  if (created !== null) {
    return (
      <Reveal
        created={created}
        onDone={() => {
          setCreated(null)
          setOpen(false)
        }}
      />
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400"
        onClick={() => setOpen(true)}
      >
        Create agent key
      </button>
    )
  }

  const busy = progress !== null

  const submit = async () => {
    if (walletClient === undefined || publicClient === undefined) return
    setError(null)
    try {
      await ensureChain()
      const result = await createAgentKey(walletClient, publicClient, {
        permissions: selected,
        ttlSeconds: ttl,
        onProgress: setProgress,
      })
      setCreated(result)
      void queryClient.invalidateQueries({ queryKey: ['sessionKeys'] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Create agent key</h3>
        <button
          type="button"
          className="text-xs text-zinc-500 hover:text-zinc-300"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          cancel
        </button>
      </div>

      <fieldset className="flex flex-col gap-1.5" disabled={busy}>
        <legend className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
          Permissions
        </legend>
        {ALL_PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(permission)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, permission]
                    : selected.filter((entry) => entry !== permission),
                )
              }
            />
            {PermissionNames[permission] ?? permission}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex items-center gap-2" disabled={busy}>
        <legend className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
          Expires in
        </legend>
        {TTL_PRESETS.map((preset) => (
          <button
            key={preset.seconds}
            type="button"
            onClick={() => setTtl(preset.seconds)}
            className={`rounded-md border px-3 py-1 text-sm ${
              ttl === preset.seconds
                ? 'border-sky-500 text-sky-400'
                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || selected.length === 0}
          className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {busy ? PROGRESS_LABELS[progress] : 'Mint key (0.3 tFIL gas included)'}
        </button>
      </div>
      {error !== null && (
        <p className="break-all text-sm text-red-400">{error}</p>
      )}
    </div>
  )
}
