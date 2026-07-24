# Stage 9 — Per-key audit trail

## Goal

Show a read-only, per-key history of registry lifecycle changes and Filecoin
piece additions. Storage actions are attributed to the EIP-712 signer embedded
in the standard PDP `addPieces` submission; the provider transaction sender is
not treated as the acting key.

## Files to touch

- `dashboard/src/lib/audit.ts` — discover the root's datasets, query
  `PiecesAdded`, decode `addPieces`, reconstruct its typed-data message,
  recover the signer, cache RPC enrichment, and merge audit rows.
- `dashboard/src/hooks/useStorageAudit.ts` — one owner/chain-scoped, 15-second
  polling query independent of the existing registry query.
- `dashboard/src/components/AuditTrail.tsx` — collapsible per-key rows and a
  separate read-only view for owner, unknown, and unattributed dataset actions.
- `dashboard/src/components/KeyCard.tsx` and `dashboard/src/App.tsx` — attach
  recovered actions only to the matching key and preserve cards on audit RPC
  failures.
- `README.md` — document the log window, transfer omission, and non-standard
  submission behavior.

## Attribution and ordering invariants

- ABI names and shapes come from installed `@filoz/synapse-core@0.7.0` types:
  PDPVerifier `PiecesAdded(setId, pieceIds, pieceCids)` and
  `addPieces(setId, listenerAddr, pieceData, extraData)`.
- Dataset discovery uses `getClientDataSets(root)` and maps global `dataSetId`
  to `clientDataSetId`; these identifiers are never interchanged.
- `extraData` is decoded with the package's exported
  `signAddPiecesAbiParameters`. The exact calldata piece tuples, nonce, and
  positionally zipped metadata rebuild the package's `AddPieces` message.
- The domain and types are imported as `getStorageDomain({ chain:
  calibration })` and `EIP712Types`; no type hash, domain field, or ABI is
  hand-written.
- Only a recovered address matching a known registry signer is attached to
  that key. Matching is case-insensitive and other keys' actions never appear
  in its trail.
- Registry lifecycle rows reuse `SessionKeyInfo.events`; no second registry
  log request is made. The first positive event is `authorized`, later positive
  events are `renewed`, and zero-expiry events are `revoked`.
- Rows sort by block, log index, then piece position, newest first. Receipt
  sender is deliberately unused for attribution.
- Transaction inputs and block timestamps are promise-cached. A rejected cache
  entry is evicted; per-row RPC reads retry once and degrade to an unattributed
  row without breaking key cards.

## Known limits

- Storage logs cover exactly the latest 2880 inclusive Calibration epochs
  (roughly 24 hours), matching the RPC range cap.
- Plain transfers, including `--sweep`, emit no contract event and are absent.
- Dataset creation or non-standard calldata cannot use the `addPieces`
  reconstruction path; those rows remain visible and explicitly unattributed.

## Acceptance checks

- Shipped rung: **(a) full trail**.
- [x] Dashboard `tsc --noEmit` passes.
- [x] Dashboard Vite production build passes (`✓ built in 10.61s`).
- [x] Real Calibration probe recovered
      `0xe0cD…Fab7` from transaction `0x6027…ad19`; it has four nonzero
      registry grants while `transaction.from` equals the storage provider.
- [ ] Manual: fresh key A upload appears only in A's trail with a
      `signature-verified` badge, correct PieceCID, transaction link, and
      sensible timestamp; compare the debug `recovered=... expected=...` pair
      with the valet address printed at agent boot.
- [ ] Manual: key B's uploads do not appear under A, a revoked key's trail
      remains readable, and at least one non-standard/dataset-creation action
      renders as unattributed.
