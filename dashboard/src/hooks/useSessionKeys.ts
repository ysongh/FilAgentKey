import { calibration } from '@filoz/synapse-core/chains'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { fetchSessionKeys } from '../lib/registry'
import {
  loadCachedAuthorizationEvents,
  saveSessionKeyCache,
} from '../lib/sessionKeyCache'

export function useSessionKeys() {
  const { address } = useAccount()
  const client = usePublicClient()

  return useQuery({
    queryKey: ['sessionKeys', calibration.id, address?.toLowerCase()],
    enabled: address !== undefined && client !== undefined,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (address === undefined || client === undefined) {
        throw new Error('wallet not connected')
      }
      const cachedEvents = loadCachedAuthorizationEvents(address)
      const keys = await fetchSessionKeys(client, address, cachedEvents)
      saveSessionKeyCache(address, keys)
      return keys
    },
  })
}
