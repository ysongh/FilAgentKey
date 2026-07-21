# Stage 6 — Gas gauge + top-up

## Goal

Show each dashboard session key's live Calibration tFIL balance and let the
owner replenish gas for a still-live key without changing any existing key
creation, revocation, registry, or agent flow.

## Files to touch

- `dashboard/src/components/GasGauge.tsx` — isolated per-card balance query,
  threshold badge, and 0.2 tFIL top-up transaction with receipt-driven
  balance refresh.
- `dashboard/src/components/KeyCard.tsx` — mount the gas gauge for every key;
  enable its top-up action only while the key has a live permission.

## Balance and action rules

- Read the session key address with wagmi `useBalance`, polling every 15 s.
- Format the viem `formatEther` result to three decimals and label it tFIL.
- Badge thresholds are inclusive: green at or above 0.15 tFIL, yellow at or
  above 0.05 tFIL, and red below 0.05 tFIL.
- `active` and `expiring` keys are both live and get a **Top up** button.
  `expired` and `revoked` keys keep the gauge but have no button.
- A top-up sends exactly 0.2 tFIL from the connected wallet through wagmi
  `useSendTransaction`, after ensuring Calibration is selected. The action is
  disabled through wallet submission and receipt confirmation; receipt
  arrival triggers an immediate balance refetch in addition to the 15 s poll.

## Acceptance checks

- [x] Dashboard `tsc --noEmit` passes.
- [x] Dashboard Vite production build passes (`✓ built in 11.07s`).
- [ ] Manual: gauges render on existing cards with the expected threshold
      colors and three-decimal tFIL amounts.
- [ ] Manual: topping up a live key sends 0.2 tFIL and updates its gauge no
      later than the next 15 s refetch cycle.
