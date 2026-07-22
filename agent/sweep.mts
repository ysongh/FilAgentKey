import { calibration } from '@filoz/synapse-core/chains'
import type { SessionKey } from '@filoz/synapse-core/session-key'
import { createPublicClient, formatEther, http } from 'viem'
import { sendTransaction } from 'viem/actions'

const RECEIPT_TIMEOUT_MS = 90_000

export async function sweepSessionBalance(
  sessionKey: SessionKey<'Secp256k1'>,
): Promise<void> {
  const publicClient = createPublicClient({
    chain: calibration,
    transport: http(),
  })
  const balance = await publicClient.getBalance({
    address: sessionKey.address,
  })
  if (balance === 0n) {
    console.log('nothing to return')
    return
  }

  const fees = await publicClient.estimateFeesPerGas()
  const gas = await publicClient.estimateGas({
    account: sessionKey.address,
    to: sessionKey.rootAddress,
    value: 1n,
  })
  const value = balance - (gas * fees.maxFeePerGas * 3n) / 2n
  if (value <= 0n) {
    console.log('nothing to return')
    return
  }

  const hash = await sendTransaction(sessionKey.client, {
    to: sessionKey.rootAddress,
    value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  })
  console.log(
    `↩️ returned ${Number(formatEther(value)).toFixed(3)} tFIL to owner (tx: ${hash})`,
  )

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: RECEIPT_TIMEOUT_MS,
  })
  if (receipt.status !== 'success') {
    throw new Error('sweep transaction reverted')
  }
}
