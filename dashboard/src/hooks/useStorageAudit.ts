import { calibration } from '@filoz/synapse-core/chains'
import { useQuery } from '@tanstack/react-query'
import { useAccount, usePublicClient } from 'wagmi'
import { fetchStorageAuditEvents } from '../lib/audit'

export function useStorageAudit() {
  const { address } = useAccount()
  const client = usePublicClient()

  return useQuery({
    queryKey: ['storageAudit', calibration.id, address?.toLowerCase()],
    enabled: address !== undefined && client !== undefined,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: async () => {
      if (address === undefined || client === undefined) {
        throw new Error('wallet not connected')
      }
      return fetchStorageAuditEvents(client, address)
    },
  })
}
