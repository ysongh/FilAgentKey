import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { fetchSessionKeys } from '../lib/registry'

export function useSessionKeys() {
  const { address } = useAccount()
  const client = usePublicClient()

  return useQuery({
    queryKey: ['sessionKeys', address],
    enabled: address !== undefined && client !== undefined,
    refetchInterval: 15_000,
    queryFn: () => {
      if (address === undefined || client === undefined) {
        throw new Error('wallet not connected')
      }
      return fetchSessionKeys(client, address)
    },
  })
}
