import { calibration } from '@filoz/synapse-core/chains'
import { useEffect, useState } from 'react'
import { formatEther, parseEther, type Address } from 'viem'
import {
  useBalance,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { useEnsureChain } from '../hooks/useEnsureChain'

const HEALTHY_BALANCE = parseEther('0.15')
const LOW_BALANCE = parseEther('0.05')
const TOP_UP_AMOUNT = parseEther('0.2')

interface GaugeStyle {
  badge: string
  dot: string
  level: string
}

function gaugeStyle(value: bigint | undefined): GaugeStyle {
  if (value === undefined) {
    return {
      badge: 'border-zinc-700 bg-zinc-800/60 text-zinc-400',
      dot: 'bg-zinc-500',
      level: 'unknown',
    }
  }
  if (value >= HEALTHY_BALANCE) {
    return {
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
      dot: 'bg-emerald-400',
      level: 'healthy',
    }
  }
  if (value >= LOW_BALANCE) {
    return {
      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
      dot: 'bg-amber-400',
      level: 'low',
    }
  }
  return {
    badge: 'border-red-500/30 bg-red-500/10 text-red-400',
    dot: 'bg-red-400',
    level: 'critical',
  }
}

function displayBalance(value: bigint): string {
  return `${Number(formatEther(value)).toFixed(3)} tFIL`
}

export function GasGauge({
  address,
  canTopUp,
}: {
  address: Address
  canTopUp: boolean
}) {
  const {
    data: balance,
    error: balanceError,
    isPending: balancePending,
    refetch: refetchBalance,
  } = useBalance({
    address,
    query: { refetchInterval: 15_000 },
  })
  const {
    data: topUpHash,
    isPending: sendPending,
    reset: resetTopUp,
    sendTransactionAsync,
  } = useSendTransaction()
  const {
    error: receiptError,
    isLoading: receiptPending,
    isSuccess: receiptReceived,
  } = useWaitForTransactionReceipt({
    hash: topUpHash,
  })
  const ensureChain = useEnsureChain()
  const [preparing, setPreparing] = useState(false)
  const [topUpError, setTopUpError] = useState<string | null>(null)

  useEffect(() => {
    if (receiptReceived) {
      void refetchBalance()
    }
  }, [receiptReceived, refetchBalance])

  const topUp = async () => {
    setTopUpError(null)
    resetTopUp()
    setPreparing(true)
    try {
      await ensureChain()
      await sendTransactionAsync({
        chainId: calibration.id,
        to: address,
        value: TOP_UP_AMOUNT,
      })
    } catch (cause) {
      setTopUpError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreparing(false)
    }
  }

  const style = gaugeStyle(balance?.value)
  const balanceLabel =
    balance !== undefined
      ? displayBalance(balance.value)
      : balancePending
        ? 'reading…'
        : 'unavailable'
  const pending = preparing || sendPending || receiptPending
  const transactionError = topUpError ?? receiptError?.message

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          Gas balance
        </span>
        <div className="flex items-center gap-2">
          <span
            aria-live="polite"
            aria-label={`Gas balance ${balanceLabel}, ${style.level}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs ${style.badge}`}
            title={
              balanceError === null
                ? `Session key balance: ${balanceLabel}`
                : `Balance read failed: ${balanceError.message}`
            }
          >
            <span className={`size-1.5 rounded-full ${style.dot}`} />
            {balanceLabel}
          </span>
          {canTopUp && (
            <button
              type="button"
              onClick={() => void topUp()}
              disabled={pending}
              className="rounded-md border border-sky-500/40 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/10 disabled:opacity-50"
              title="Send 0.2 tFIL from the connected wallet"
            >
              {receiptPending ? 'Confirming…' : pending ? 'Confirm in wallet…' : 'Top up'}
            </button>
          )}
        </div>
      </div>
      {transactionError !== undefined && transactionError !== null && (
        <p className="break-all text-xs text-red-400" role="alert">
          {transactionError}
        </p>
      )}
    </div>
  )
}
