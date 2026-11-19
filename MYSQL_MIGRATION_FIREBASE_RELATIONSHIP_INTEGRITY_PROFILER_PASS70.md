# Firebase Relationship Integrity Profiler — Pass 70

## Status
Static source review and local synthetic verification completed. This is a read-only tool; it does not connect to Firebase or TiDB.

## Source evidence
- `js/app.js` revision `da5f6ae886edd1c3e0a457d539c7e359ef5cd9ec`: invoice stores `pid`, `sh`, `kasir`, and line items; medicine lines store `oid` and batch deductions `bid`; package medicine parts store `oid/id` and batch deductions.
- `js/store.js` revision `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`: purchase stores `oid` and `batchId`; batch stores `oid` and `beli`; supplier return stores `beliId`; loss records store `oid` and `bid`.
- `js/firebase-backend.js` revision `3a613d96564f120b8141966f9ecbae21471c4e65`: cancellation document path is invoice ID and contains `trxId`; sales return contains `trxId` and `itemIndex`; quota document ID is `<trxId>__<itemIndex>`; quota carries `qtyTerpakai`.

## Checks implemented
- Invoice patient and shift references.
- Purchase medicine and purchase-to-batch links; batch-to-medicine and optional batch-to-purchase links.
- Loss medicine and optional batch links; supplier-return-to-purchase link.
- Sales-return invoice link, item-index bounds and positive quantity.
- Return quota document-key format, invoice link, item-index bounds, nonnegative quantity and upper bound against original invoice line quantity.
- Duplicate return business key `trxId + itemIndex`.
- Cancellation invoice link and document-path/embedded-`trxId` consistency.
- Invoice direct medicine/package-part and batch deduction references.

## Deliberate exclusions
- Cashier-to-user relation is not declared valid/invalid: `k_trx.kasir` is a profile handle, while owner and staff profile document IDs differ. A UID crosswalk is required.
- Supplier names are display strings, not a stable supplier foreign key.
- Multiple historical batch documents per purchase are not declared invalid.
- Missing collections are reported as unavailable in the supplied export; not proof of absence in Firebase.
- No assumptions are made for optional/legacy fields.

## Run
`npm run migration:relationships -- --input ./private/firebase-export-normalized.json [--output ./private/relationship-report.json]`

Input uses the same normalized envelope as Pass 69. Output contains issue codes and source document IDs, not patient payloads. Output files use exclusive-create mode and cannot overwrite an existing report.

## Synthetic tests
Eight Node tests cover valid links, orphan patient/shift links, malformed return item index and quantity, quota key/quantity mismatch, optional null/missing reference behavior, cancellation path mismatch, duplicate return business key, missing collections, and PII exclusion. Local isolated test run: **8 passed, 0 failed**.

## Safety and limitations
No live Firebase export or Auth read was performed. No account/profile mutation, source write, TiDB write, DDL, import, deploy, merge to main, or production change occurred. This profiler is not evidence that actual Firebase records are clean; it requires a complete normalized export first.
