# Firebase Export Dry-Run Profiler — Pass 69

**Status:** Implemented; isolated synthetic tests pass.  
**Branch:** `migration/tidb-foundation`  
**Scope:** Local JSON profiling only. No Firebase connection, TiDB connection, import, authentication operation, deployment or production change.

## Deliverables

- `scripts/profile-firebase-export.js` — read-only command-line profiler.
- `tests/profile-firebase-export.test.js` — synthetic regression tests.
- `package.json` — `npm run migration:profile -- --input <file>` command.

## Supported input contract

The profiler intentionally accepts a normalized JSON envelope, not a raw Firebase Admin SDK backup or Firestore wire-format export. An authorized export adapter/operator must transform each collection into this shape:

```json
{
  "exportVersion": 1,
  "exportedAt": "2026-11-19T00:00:00Z",
  "collections": {
    "k_pasien": [
      {
        "documentId": "q_20261119_000001",
        "data": {
          "id": "q_20261119_000001",
          "_t": 1795000000000,
          "tgl": "2026-11-19"
        }
      }
    ],
    "k_trx": {
      "invoice-document-id": {
        "id": "invoice-document-id",
        "pid": "q_20261119_000001"
      }
    }
  }
}
```

A collection may be an array of `{ documentId, data }` entries or an object keyed by document ID whose values are document data. The source document ID must come from the Firestore document path, not from a potentially stale embedded `id`.

## What it measures

- Collection/document counts for the 17 known operational collection paths, including `k_returKuota`.
- Invalid document shapes, repeated document IDs within one exported collection and embedded `id` mismatches.
- Same raw document IDs appearing in different collections (reported as collisions for review, not as global duplicates).
- Per-field presence, explicit-null counts and observed JSON types; absent fields remain distinguishable from explicit null.
- Timestamp-like field candidates: epoch milliseconds, epoch seconds, ISO with/without explicit timezone, date-only strings, Firestore timestamp objects and unknown forms.
- A bounded issue sample (maximum 100) plus total issue count.

## What it deliberately does not do

- Does not fetch Firebase records, access credentials, connect to Firebase or TiDB, write to a database, mutate Auth, or modify source records.
- Does not infer duplicate people from names/phone numbers.
- Does not declare relational orphan records or duplicate business keys without an approved source-specific relationship/key map.
- Does not convert timestamps or guess timezone/epoch units.
- Does not output raw document payloads or patient names/phone numbers.
- Does not auto-merge, repair, delete or quarantine source data.

A missing collection in the supplied export means it was absent from that input only; it is not evidence that the collection does not exist in Firebase. Cross-collection ID collisions are informational because raw IDs are scoped by collection.

## Running locally

```bash
npm run migration:profile -- --input ./private/firebase-export-normalized.json
```

To save a report to a new path (the command refuses to overwrite an existing file):

```bash
npm run migration:profile -- --input ./private/firebase-export-normalized.json --output ./private/firebase-profile-report.json
```

Keep the export and generated report in a private, access-controlled location. Do not commit patient exports or profiler outputs to GitHub. The input file should be obtained only through an owner-authorized read-only export process and must include the full collection manifest.

## Synthetic verification performed

- `node --test tests/profile-firebase-export.test.js`: 6 tests passed, 0 failed.
- `node --check scripts/profile-firebase-export.js`: passed.

These checks were executed in an isolated Node environment against the newly authored script and synthetic fixtures. In addition, GitHub Actions run [#278](https://github.com/anitaherwan3-ai/assalam/actions/runs/44472681602), on commit `b14af53873a793739f0c7fef5dd0151db767afd2` which contains the profiler, its tests and package command, completed successfully. The repository workflow ran `npm run build` (full `node --test tests/*.test.js` suite plus the guarded preview migration build step). This verifies the branch CI gate, not live TiDB connectivity or Firebase data.

## Next gate

Before real data profiling, verify the export adapter preserves exact Firestore paths, document IDs, raw JSON types, explicit nulls and Timestamp seconds/nanoseconds. Then run the profiler locally on an authorized export, review the exception report, and add source-specific relationship checks for invoice/patient/shift/cashier, inventory/batch, returns/quotas, cancellation and supplier chains. Import remains blocked until those reports and reconciliations are reviewed.

**Decision:** Pass 69 provides a safe first-pass structural profiler. It is not a Firebase migration, and it does not authorize DDL, import or cutover.
