import { useEffect, useMemo, useRef } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { ActivityFeed } from './components/ActivityFeed'
import { OtherStorageActions } from './components/AuditTrail'
import { CreateKey } from './components/CreateKey'
import { KeyCard } from './components/KeyCard'
import { useSessionKeys } from './hooks/useSessionKeys'
import { useStorageAudit } from './hooks/useStorageAudit'
import { partitionStorageAudit } from './lib/audit'

function ConnectScreen() {
  const { connect, connectors, isPending, error } = useConnect()
  const injectedConnector = connectors[0]

  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="text-zinc-400 max-w-md">
        Mint scoped, time-limited, on-chain-revocable session keys for your AI
        agents. Connect your Calibration wallet to see your keys.
      </p>
      <button
        type="button"
        disabled={injectedConnector === undefined || isPending}
        onClick={() =>
          injectedConnector !== undefined &&
          connect({ connector: injectedConnector })
        }
        className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
      >
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {injectedConnector === undefined && (
        <p className="text-sm text-zinc-500">
          No injected wallet found — install MetaMask (or similar) and reload.
        </p>
      )}
      {error !== null && (
        <p className="text-sm text-red-400">{error.message}</p>
      )}
    </div>
  )
}

function KeyList() {
  const { data, isPending, error } = useSessionKeys()
  const storageAudit = useStorageAudit()
  const debuggedTransactions = useRef(new Set<string>())
  const partitioned = useMemo(
    () =>
      partitionStorageAudit(
        storageAudit.data?.events ?? [],
        data ?? [],
      ),
    [data, storageAudit.data],
  )

  useEffect(() => {
    if (data === undefined || storageAudit.data === undefined) return
    const expectedBySigner = new Map(
      data.map((key) => [key.signer.toLowerCase(), key.signer]),
    )
    for (const event of storageAudit.data.events) {
      if (event.attribution.kind !== 'signature-recovered') continue
      const expected = expectedBySigner.get(
        event.attribution.signer.toLowerCase(),
      )
      if (
        expected === undefined ||
        debuggedTransactions.current.has(event.txHash)
      ) {
        continue
      }
      console.debug(
        `[FilAgentKey audit] signature-verified recovered=${event.attribution.signer} expected=${expected} tx=${event.txHash}`,
      )
      debuggedTransactions.current.add(event.txHash)
    }
  }, [data, storageAudit.data])

  if (isPending) {
    return <p className="text-zinc-500 py-12 text-center">Loading session keys…</p>
  }
  if (error !== null) {
    return (
      <p className="text-red-400 py-12 text-center text-sm">
        Failed to read the registry: {error.message}
      </p>
    )
  }
  if (data.length === 0) {
    return (
      <>
        <p className="text-zinc-500 py-12 text-center">
          No recent or cached session keys. Create one to get started.
        </p>
        <OtherStorageActions events={partitioned.other} />
      </>
    )
  }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {data.map((info) => (
          <KeyCard
            key={info.signer}
            info={info}
            storageEvents={
              partitioned.bySigner[info.signer.toLowerCase()] ?? []
            }
            storagePending={storageAudit.isPending}
            storageError={storageAudit.error}
          />
        ))}
      </div>
      <OtherStorageActions events={partitioned.other} />
    </>
  )
}

export default function App() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">FilAgentKey</h1>
            <p className="text-xs text-zinc-500">
              valet keys for AI agents on Filecoin · Calibration
            </p>
          </div>
          {isConnected && address !== undefined && (
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-zinc-400" title={address}>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
              <button
                type="button"
                onClick={() => disconnect()}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                disconnect
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
        {isConnected ? (
          <>
            <CreateKey />
            <KeyList />
            <ActivityFeed />
          </>
        ) : (
          <ConnectScreen />
        )}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-8">
        <p className="text-center text-xs text-zinc-700">
          Calibration testnet · no backend — chain state is the only source of
          truth · root keys never leave your wallet
        </p>
      </footer>
    </div>
  )
}
