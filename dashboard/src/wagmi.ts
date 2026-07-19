import { calibration } from '@filoz/synapse-core/chains'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [calibration],
  connectors: [injected()],
  transports: {
    [calibration.id]: http(),
  },
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
