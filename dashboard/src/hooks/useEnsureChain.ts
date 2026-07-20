import { calibration } from '@filoz/synapse-core/chains'
import { useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'

/**
 * Returns an async fn that makes sure MetaMask is on Calibration before a
 * write. The injected connector adds the chain (wallet_addEthereumChain)
 * if the wallet doesn't know it yet.
 */
export function useEnsureChain() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()

  return useCallback(async () => {
    if (chainId !== calibration.id) {
      await switchChainAsync({ chainId: calibration.id })
    }
  }, [chainId, switchChainAsync])
}
