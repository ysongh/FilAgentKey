import { calibration } from '@filoz/synapse-core/chains'
import { loginSync, revokeSync } from '@filoz/synapse-core/session-key'
import { parseEther, type Address, type Chain, type Client, type Hex, type Transport } from 'viem'
import type { Account } from 'viem/accounts'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  sendTransaction,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from 'viem/actions'
import { registry } from './registry'

export const GAS_FUND = parseEther('0.3')
export const ORIGIN = 'filagentkey'

type WalletClient = Client<Transport, Chain, Account>
type PublicClient = Client<Transport, Chain>

export interface CreatedKey {
  privateKey: Hex
  address: Address
  expiresAt: bigint
}

export type CreateProgress =
  | 'simulating'
  | 'wallet-confirm'
  | 'confirming'
  | 'funding'

export async function createAgentKey(
  walletClient: WalletClient,
  publicClient: PublicClient,
  options: {
    permissions: Hex[]
    ttlSeconds: number
    onProgress?: (step: CreateProgress) => void
  },
): Promise<CreatedKey> {
  const privateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(privateKey)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + options.ttlSeconds)
  const created: CreatedKey = {
    privateKey,
    address: sessionAccount.address,
    expiresAt,
  }

  // Preferred: loginAndFund — authorize + gas-fund the key in one tx.
  options.onProgress?.('simulating')
  try {
    const { request } = await simulateContract(publicClient, {
      abi: registry.abi,
      address: registry.address,
      functionName: 'loginAndFund',
      args: [sessionAccount.address, expiresAt, options.permissions, ORIGIN],
      value: GAS_FUND,
      account: walletClient.account,
    })
    options.onProgress?.('wallet-confirm')
    const hash = await writeContract(walletClient, request)
    options.onProgress?.('confirming')
    await waitForTransactionReceipt(publicClient, { hash, timeout: 180_000 })
    return created
  } catch {
    // Fall back to login() + a plain gas transfer (two txs).
  }

  options.onProgress?.('wallet-confirm')
  await loginSync(walletClient, {
    address: sessionAccount.address,
    permissions: options.permissions,
    expiresAt,
    origin: ORIGIN,
    onHash: () => options.onProgress?.('confirming'),
  })
  options.onProgress?.('funding')
  const fundHash = await sendTransaction(walletClient, {
    chain: calibration,
    to: sessionAccount.address,
    value: GAS_FUND,
  })
  await waitForTransactionReceipt(publicClient, {
    hash: fundHash,
    timeout: 180_000,
  })
  return created
}

export async function revokeAgentKey(
  walletClient: WalletClient,
  signer: Address,
): Promise<void> {
  // permissions omitted ⇒ synapse-core revokes all DefaultFwssPermissions.
  await revokeSync(walletClient, { address: signer, origin: ORIGIN })
}
