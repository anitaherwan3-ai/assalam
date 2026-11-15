# MYSQL Migration Root-Cause Audit — Write Paths, Rules, and PR13

Status: source inspection only; no schema, production changes, Firebase writes, or live acceptance tests.
Baseline: `main` source files inspected read-only on 2026-11-15.
Repository: `anitaherwan3-ai/assalam`.

## 1. Scope and source fingerprints

| Source | Ref | Blob SHA |
|---|---|---|
| `js/store.js` | `main` | `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` |
| `js/firebase-backend.js` | `main` | `3a613d96564f120b8141966f9ecbae21471c4e65` |
| `js/app.js` | `main` | `f74c4710161ddd2af230e51c18b1f107d6c52c82` |
| `firestore.rules` | `main` | `d02b6d02c13bc85f867b668085edb85c54726779` |
| `display.html` | `main` | `798e11e37cef1498bbc361b4c76474a85a71a9ca` |

PR13: #13, open and unmerged, base `main` at `2c26a769a95a84c06974e249d318498fde8eb7d1`, head `d97e00d6a51e2d4c7d7e84c2a32e0d8ccbe2ceb3`. Its current PR metadata says 54 commits, 5 changed files, 845 additions, 161 deletions. It remains reference-only.

## 2. Critical architectural conclusion

The current application is not a single consistent data model. It contains at least three layers with materially different behavior:

1. Local `ClinicStore` methods in `js/store.js`.
2. UI/controller mutations in `js/app.js`, often mutating local state first and then calling `saveLocal()`.
3. Firestore backend commands and Firestore Rules in `js/firebase-backend.js` and `firestore.rules`.

These layers are not always equivalent. A MySQL migration must not port local mutations as-is. It must define authoritative server commands and make each command own the complete transaction boundary.

## 3. Verified write-path findings

### 3.1 Patient registration and queue

UI `actionAddPasien()` creates a patient with:
- `id`, `no` initially empty
- `tgl` (clinic operational date)
- `jam`, `nama`, `hp`, `layanan`
- `done:false`, `kasir`, `sh`
- `registeredAt`, `_t`

It refuses registration when Firebase is offline, then calls `registerPatientWithQueueNumber()`. The backend reads today's server patients, compares the highest A-number with local state and `seq`, then allocates. This is an A-only implementation in `main`.

**Migration implication:** queue allocation must be a database-serialized operation, not a client max-plus-one calculation. Use a unique key for (operational date, queue prefix, sequence) and an atomic counter/locking strategy. Preserve patient ID and queue number on handoff. Explicitly decide whether the A/B behavior from PR13 is accepted.

### 3.2 POS transaction and inventory

UI `actionBayarTrx()` validates:
- active shift exists;
- patient belongs to today's queue, has been called, is not done, deleted, or Batal Berobat;
- cart is not empty;
- free negative-price discount rows are rejected;
- cash payment must cover total.

Backend `commitCashierTransaction(trx, patientId, stockChanges)` performs a Firestore transaction. It first checks whether the invoice ID already exists; if so it returns without decrementing stock again (idempotency). It reads patient, medicine, and batch documents before writing.

Rules require a cashier-created invoice to match the cashier profile and patient ID, and the patient must be marked done in the same atomic Firestore operation. Invoice updates by cashier are limited to `_t`; admin/pimpinan cancellation is a separate constrained update.

**Migration implication:** one SQL transaction must atomically:
1. verify cashier profile and open shift;
2. lock patient and confirm eligible state/ownership;
3. validate invoice items and historical price/HPP snapshots;
4. lock all affected medicine and batch rows;
5. apply FEFO/batch deductions and aggregate stock changes;
6. insert invoice header and invoice item snapshots;
7. mark patient done;
8. write inventory ledger and audit event;
9. store idempotency key/request identity.

A retry with the same idempotency key must return the original result, not duplicate revenue or stock deductions. Never trust client-submitted `stockChanges`, HPP, item price, or total.

### 3.3 Shift

UI opening shift fields observed:
- `id`, `tgl`, `jam`, `kasir`, `nama`, `modal`, `status:'buka'`, `_t`.

Closing shift adds/changes:
- `status:'tutup'`, `jamT`, `sistem`, `fisik`, `selisih`, `verif:false`, `_t`.

Rules: cashier can open own shift with nonnegative numeric opening modal; cashier can close own open shift; admin verifies closed shift; leadership has broad access. The rules constrain allowed field changes but not all business invariants (for example, duplicate open shifts for one cashier/day must be enforced in the database).

**Migration implication:** enforce at most one open shift per cashier under concurrency. Keep opening modal separate from omzet and from actual cash movement. Recompute expected cash on the server from eligible cash transactions, cash refunds, petty cash, and other explicitly classified movements; do not accept client `sistem`.

### 3.4 Petty cash

UI fields observed:
- `id`, `tgl`, `ket`, `jml`, `kasir`, `sh`, `_t`.
Rules: cashier may create positive amount with own cashier identity; cashier may edit only `ket`, `jml`, `_t` on own record; cashier may delete own record; Pimpinan has broad control; all signed-in users can read.

**Risk:** current rules do not freeze petty cash after shift close or after reconciliation. Product owner must decide whether edits/deletes are allowed after shift closure/verification. New design should normally use reversal entries rather than destructive deletion for financially posted movements.

### 3.5 Expenses (`biaya`)

UI creation fields observed:
- `id`, `tgl`, `kat`, `ket`, `jml`, `status`, `kasir`, `_t`.
- status is `pending` when amount >= configured `batasApproval`, otherwise `approved`.
- Edit changes `ket`, `jml`, `_t` and recalculates status from threshold.
- Delete physically removes the local entry.
Rules grant read/write to Admin/Pimpinan, not Kasir.

**Risk:** local UI and Firestore rules do not encode a robust approval state machine or immutable approver/payment metadata in the observed UI path. Need inspect full `actionApproveBiaya` and store methods before finalizing fields. Decide self-approval prohibition, amount threshold, and whether an approved expense can be edited/deleted. Recommended SQL model: request, approval event, payment/posting event, reversal; actor/time retained.

### 3.6 Stock loss / opname

UI loss creation fields observed:
- `id`, `tgl`, `oid`, `bid`, `qty`, `ket`, `nilai`, `_t`.
- It decrements batch `sisa` and medicine aggregate `stok`, then creates loss record.
- Deleting a loss restores both batch and medicine quantities and removes the record.
Rules grant `k_loss` read/write only to Admin/Pimpinan; stock and batch updates are also role-limited.

**Risk:** a delete-and-restore flow can erase the historical reason for a posted stock loss. New design should use an audited reversal referencing the original loss. Every inventory movement must update the ledger, batch balance, and aggregate stock in one SQL transaction.

### 3.7 Purchases and supplier returns

UI `actionAddBeli()` passes:
- `supplier`, `faktur`, `oid`, `qty`, `total`, `tempo`, `batchNo`, `ed`, `isLunas`.
- The store's `recordPurchase()` is responsible for purchase row, batch, aggregate stock, HPP, and payable state.
- UI explicitly refuses deleting a purchase invoice and directs users to supplier return.
Rules grant Admin/Pimpinan read/write for `k_beli` and `k_returBeli`.

**Still needs exact extraction:** `recordPurchase()`, `openModalReturBeli()`, supplier-return store methods, and payment/settlement handlers. Do not infer a purchase payment schedule from the candidate field list alone.

### 3.8 Sales returns: critical three-stage cloud workflow

Backend methods reveal the authoritative cloud flow:
1. Kasir (and Pimpinan in backend API) submits a return request. It checks invoice, item index, positive integer-like quantity, request ID, cashier ownership; atomically reserves a per-invoice-item quota and creates pending return.
2. Admin `approveReturJual()` moves `menunggu` to `menunggu_pimpinan`; stock is not changed.
3. Pimpinan `finalizeReturJual()` performs final approval and restores stock/batch; the return is marked approved and refund obligation is created/maintained.
4. Pimpinan `payReturJual()` records refund separately. Allowed methods: Tunai or Transfer; transfer requires reference. Only approved return with refund status pending can be paid; duplicate payment is rejected.

The backend also computes return value from original invoice item snapshots and allocates discount rather than trusting cashier-submitted amount. Per-item quota uses a deterministic `trxId__itemIndex` document ID and tracks cumulative quantity.

**Critical divergence:** local `ClinicStore.approveReturJual()` permits Admin/Pimpinan and immediately restores batch/medicine stock when status is `menunggu`, setting `disetujui`. Cloud backend instead requires Admin first-stage verification and Pimpinan final approval before stock restoration. These must not be combined accidentally. The MySQL system must implement the secure cloud workflow as the intended business rule, after owner confirmation.

**Additional risk:** legacy return documents may have no prior-quantity/quota/refund metadata. They require read-only reconciliation; never auto-pay or auto-restore ambiguous legacy rows.

### 3.9 Invoice cancellation

Backend `submitCancelRequest()` allows cashier to submit one pending request per invoice; it checks invoice exists/not already cancelled, and checks existing returns before creating request. Submission does not change stock.
Backend `processCancelRequest()` allows Admin/Pimpinan to approve or reject. Approval is atomic with invoice status cancellation and inventory/batch restoration; request must still be pending. This should be idempotent and must be blocked if returns conflict with cancellation.
Rules allow cashier create own pending request; Admin/Pimpinan decide; cashier can resubmit a previously rejected request with constrained fields.

**Migration implication:** define explicit states and prohibit simultaneous return and full cancellation for the same invoice. Use a single lock/transaction on invoice and return quota rows to prevent races.

## 4. Exact role and rules findings

### Global identity
- Two hard-coded Pimpinan emails: `praktekrose@gmail.com`, `nursalim42@gmail.com`.
- Staff profile is looked up by Firebase email document ID; staff requires matching email, active=true, role admin/kasir.
- Staff reads own profile; Pimpinan reads all profiles.
- Provisioning is restricted to initial owners and currently uses an allow-listed set of staff email document IDs.
- The source includes a local owner identity map and owner bootstrap logic. New backend must not accept a role or user ID from browser payload.

### Patient
- Signed-in users can read patient documents.
- Kasir/Pimpinan can create patient documents; current main Rules create condition is less strict than PR13's ownership/prefix checks.
- Update paths distinguish completion, admin correction, patient identity edit, Batal Berobat, restore, and calling/display state.
- Pimpinan can delete; app also has archive/restore status concepts.
- Need map exact branches and fields before SQL endpoint authorization is frozen.

### Invoice
- Signed-in read.
- Kasir create own invoice with patient completion in same atomic operation.
- Cashier metadata sync update limited to `_t`; Admin/Pimpinan constrained cancellation.
- This is a strong indication that new API should expose commands, not generic invoice update.

### Shift
- Signed-in read.
- Cashier creates own open shift, closes own shift with restricted fields.
- Admin verifies closed shift; Pimpinan broader.
- Need decide reopening and post-verification adjustment policy.

### Stock/master
- Signed-in read.
- Admin/Pimpinan create/delete medicine and batch; Kasir can only decrement aggregate stock and batch remaining quantity, not increase.
- Admin/Pimpinan manage tariff/package/purchase/expense/loss/supplier-return.
- This rule-level asymmetry is important: cashier return restoration must occur only through the dedicated return/cancellation command, not generic stock update.

### Petty cash/log/config
- Pety: all signed-in read; own cashier create/edit/delete under constraints; Pimpinan broad.
- Logs: Admin/Pimpinan read; staff creates own logs; staff updates only timestamp; Pimpinan manages.
- Clinic config read by signed-in; Pimpinan manages general config; Admin/Pimpinan can update only Display TV fields and queue audio clips; audio files currently stored as base64 Firestore docs, max 600 KiB.
- Queue audio storage should move to object storage with SQL metadata, not MySQL blobs/base64 rows.

## 5. PR13 — requirements and risks, not adopted

PR13 adds:
- logout guard while today's patients assigned to current shift remain unfinished;
- continue service, Batal Berobat, or handoff;
- handoff preserves patient ID/queue number, changes cashier and shift, requires reason >= 5 characters, logs event;
- receiver shift must be open, same operational date, and queue prefix must match receiver;
- A/B queue prefix per cashier and display switching; cashier can choose A or B display mode;
- Display TV filters patients by selected queue.

Important technical risks to resolve before adoption:
1. The PR diff includes a very large Firestore Rules rewrite. It is not a simple UI feature; its ownership predicates and allowed-field changes must be translated into SQL API authorization tests.
2. Queue prefix mapping is hard-coded to internal IDs `kasir -> A`, `kasir2 -> B`. Decide whether prefixes are configurable or permanent identity policy.
3. Display switching is a global setting; if multiple cashiers/devices change it concurrently, define last-writer and audit behavior.
4. Handoff changes ownership/shift; transaction submission must check current ownership at commit time, not trust stale browser state.
5. Logout guard should be enforced server-side using pending patient assignments, not just a client modal.
6. PR13's checklist is unchecked; PR metadata confirms it is open/unmerged. It must be separately accepted and tested before inclusion in migration requirements.

## 6. Root-cause risk register

| ID | Risk | Why it matters | Required MySQL control |
|---|---|---|---|
| R1 | Local store vs cloud backend behavior diverges | Local tests can pass while cloud state machine differs | One authoritative server command per business operation |
| R2 | Browser mutates state before cloud sync | Client can show false success or stale balances | Server response is source of truth; optimistic state is reversible |
| R3 | Aggregate stock vs batch stock diverges | Dispensing, returns, expiry and loss affect both | Immutable stock ledger + transactional balance updates + reconciliation |
| R4 | Historical invoice snapshots | Current HPP/price can change after sale | Snapshot price, HPP, discount allocation and item metadata on invoice |
| R5 | Return/cancel race | Double restoration/refund or over-return | Lock invoice + per-item return quota + idempotency |
| R6 | Multiple open shifts / concurrent queue IDs | Duplicate shift/queue and cash attribution | Unique constraints + row locks/atomic counters |
| R7 | Operational WIB date vs UTC timestamps | Wrong daily queue/shift/report | Store UTC instants and explicit Asia/Jakarta operational date |
| R8 | Destructive edit/delete of financial/stock records | Audit trail can disappear | Reversal/void records; no hard delete after posting |
| R9 | Untrusted client role, price, quantity, HPP, totals | Fraud and race conditions | Verify token/profile server-side; calculate on server |
| R10 | Large base64 media in Firestore | Cost, limits and sync pressure | Object storage; SQL metadata and access control |
| R11 | Legacy return quota gaps | Historical over-return or duplicate payout | Read-only reconciliation and manual exceptions workflow |
| R12 | PR13 not approved | Requirements may be accidentally treated as live behavior | Keep PR13 as a separate decision gate |

## 7. Still not fully audited — must close before schema approval

The following source paths require exact method-by-method extraction and comparison:
- `ClinicStore.recordPurchase()`, supplier return creation/approval and purchase payment/settlement.
- `actionApproveBiaya()`, expense approval state, threshold and self-approval.
- `actionVerifShift()`, all shift verification fields and post-verification edits.
- `actionMigrateReturKuota()` and legacy return migration behavior.
- Complete nested invoice item schema: medicine, tariff, package, package components, discounts, batch deductions, signa, label instructions, and snapshots.
- Full patient lifecycle including calling, Batal Berobat, restore, archive/unarchive and any handoff event history.
- User provisioning/email change and owner protection.
- Exact Firestore collection inventory vs every store state key and every listener/push mapping.
- Display audio upload/delete metadata and storage migration.
- Export/backup/log retention and privacy requirements.

No DDL should be approved until these are closed and the resulting field/transition matrix is reviewed.

## 8. Proposed next audit sequence

1. Extract exact store/backend methods for purchases, supplier returns, expenses, shift verification, return quota migration, and nested invoice items.
2. Build a complete collection-to-table mapping with every field marked **verified**, **derived**, **legacy**, or **unknown**.
3. Build endpoint command matrix: role, preconditions, rows locked, rows written, ledger entries, audit event, idempotency key, rollback behavior.
4. Review the matrix with the user and settle PR13/approval/backup decisions.
5. Only then draft relational table design. SQL DDL remains blocked until explicit approval.
