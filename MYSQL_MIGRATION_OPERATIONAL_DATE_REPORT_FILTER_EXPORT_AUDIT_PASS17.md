# MYSQL Migration — Operational Date, Report Filter & Export Consistency Audit (Pass 17)

Date: 2026-11-15  
Branch: `migration/tidb-foundation`  
Scope: static source audit of clinic date handling, shared report filters, on-screen reports and CSV/PDF exports. Documentation only.

## 1. Source snapshot

| File | Blob SHA | Reviewed areas |
|---|---|---|
| `js/app.js` | `f74c4710161ddd2af230e51c18b1f107d6c52c82` | 20–34, 53–120, 271–318, 3440–3475, 3557–3648, 3791–3820 |
| `js/store.js` | `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb` | 236–350, 535 |
| `js/firebase-backend.js` | `3a613d96564f120b8141966f9ecbae21471c4e65` | 412–424, 678–690 |
| `js/export-helper.js` | `e383d719ba72dc391636444d772305ef9d412b2d` | 1–190 |
| `index.html` | `7f9fbbb202c0fd346eb40b3e93d01c9427bdfad2` | script load order |

No runtime or user data was used.

## 2. Date/time handling observed

1. UI `todayStr` is calculated with `Intl.DateTimeFormat(... timeZone: 'Asia/Jakarta')` and is clinic-local WIB (`app.js:20–29`).
2. Report date from return approval/payout timestamps is converted to Asia/Jakarta (`app.js:84–92`, `101–120`).
3. Several write paths still create date strings using UTC `toISOString().slice(0,10)`: activity log, FEFO expiry cutoff, purchase invoice, supplier settlement and supplier return (`store.js:236–243, 261, 283, 345, 442, 535`; Firebase cancellation/return paths also include UTC-derived fallback dates).
4. Clock strings from `toTimeString()` use the executing device's local timezone, while date fields may be UTC. On a device not configured to WIB, one business event can carry a date and time from different zones.
5. Seven-day preset computes `Date.now() - days × 24h`, then extracts UTC date with `toISOString()`; it is not a clinic-calendar-day calculation (`app.js:302–315`).
6. Date-only comparisons are lexicographic ISO date comparisons, which are safe only when values are normalized to valid `YYYY-MM-DD` dates (`app.js:53–58`; export helper equivalent).

## 3. Report filter contract observed

The shared on-screen filter state contains `from`, `to`, `metode`, and `kasir` (`app.js:30–35`). On-screen active transaction reports apply:
- inclusive date range on `tgl`;
- optional payment method;
- optional cashier;
- exclusion of invoices whose cancellation is approved (`app.js:53–82`).

Return reporting applies original invoice method/cashier and uses return approval date for revenue and payout date for cash flow (`app.js:94–120`). This is distinct from the export generator's current filtering behavior.

## 4. Confirmed inconsistencies / risks

| ID | Finding | Evidence | Required migration behavior |
|---|---|---|---|
| D17-01 | CSV/PDF transaction export does not match on-screen transaction filters. | `export-helper.js:getExportData('Transaksi')` filters only `tgl`; does not apply `metode`, `kasir`, or approved cancellation exclusion. | One canonical report query/filter contract shared by screen, CSV and PDF. |
| D17-02 | Transaction export line subtotal is `qty × harga`, not allocated invoice amount. | Export rows use `item.qty * item.harga`; checkout stores invoice-level `total` and discount/charge snapshots. | Export immutable invoice-line gross, discount allocation and net line amount; reconcile line totals to invoice total. |
| D17-03 | Export transaction report can include cancelled invoices. | Export reads all `s.trx` in date range; no cancellation join/state check. On-screen active reports exclude cancelled. | Cancellation status and reversal must be joined consistently; retain separate audit-history export only if intentionally requested. |
| D17-04 | Export date range ignores payment method and cashier even though the same filter object is passed. | UI passes `dateFilter`; export helper reads only `from` and `to`. | Explicitly define applicable filters per report and expose them in PDF/CSV metadata. |
| D17-05 | CSV and PDF share the same data generator, so both inherit the same semantic defects. | `exportCSV` and `exportPDF` both call `getExportData`. | Test semantic parity once at the query/data layer and separately test file encoding/layout. |
| D17-06 | Report screen and export use inconsistent row inclusion for missing dates. | On-screen `inFilterRange` includes rows with no `tgl`; export `inRange` also includes them. Such rows leak into any selected period without an explicit “undated” bucket. | Quarantine/report undated legacy rows separately; do not silently include in a dated period. |
| D17-07 | Several persisted business dates use UTC date extraction while UI/report dates use Asia/Jakarta. | Store write paths use `toISOString().slice(0,10)`; UI uses Asia/Jakarta. | Store UTC event instant and derive immutable clinic business date in Asia/Jakarta at event creation; never derive business date from browser timezone. |
| D17-08 | Seven-day preset is elapsed-24-hour based and extracts UTC day. | `applyDatePreset(7)` subtracts 7×864e5 and slices UTC ISO. | Define presets as clinic calendar days in Asia/Jakarta, including inclusive/exclusive boundary explicitly. |
| D17-09 | Export filenames use UTC date, PDF period label omits active method/cashier filters. | `export-helper.js` uses `new Date().toISOString()`; PDF prints only from/to. | Use clinic-local generation date; print all active filter criteria and generation timestamp/timezone. |
| D17-10 | Exported stock report is a current snapshot, not historical stock for selected date range. | `Stok Obat` branch ignores range and exports current `s.obat` values. | Label clearly “snapshot as of generated time”; historical stock requires movement ledger reconstruction. |
| D17-11 | Expiry report ignores selected date range and computes “today” in UTC. | `Kedaluwarsa` branch does not filter batches by range and uses UTC `today`. | Define expiry report as current snapshot with WIB cutoff, or add a separately named historical as-of report. |
| D17-12 | Activity log date/time is built from UTC date and device-local time. | `store.logActivity` uses `toISOString()` for date and `toTimeString()` for time. | Store one UTC timestamp plus actor; render localized WIB time. |
| D17-13 | Master-data exports are presented beside period reports despite being non-periodic. | Package/service and current stock exports ignore date range. | Distinguish transaction-period reports from master/current-state snapshots in UI and file metadata. |
| D17-14 | Report data generators are client-side projections over loaded local state. | `ExportHelper` reads `store.state`; no server-side snapshot/query contract. | MySQL reports must query authoritative persisted data with explicit tenant/role scope, cutoff and stable ordering; never trust client-calculated totals as authoritative. |

## 5. Recommended report contract for MySQL

Every report request should carry a typed, validated contract:

- `period_from` and `period_to` as clinic business dates (inclusive) or explicit timestamp bounds; do not mix both silently.
- `timezone = Asia/Jakarta` for clinic business-date interpretation.
- Optional filters such as cashier, original payment method, refund payout method, status and shift; each filter must declare which entity/date dimension it applies to.
- Explicit `date_basis`: invoice date, return approval date, refund payout date, supplier payment date, expense recognition date, stock movement date, or snapshot cutoff.
- `generated_at` as UTC instant and displayed clinic-local timestamp.
- Stable row ordering and pagination/snapshot token for large reports.
- Screen, CSV and PDF must consume the same authorized report dataset and calculation definitions.
- Export metadata should include report name, date basis, period, timezone, active filters, generated time, and row count.
- Undated/invalid legacy records must be shown in a reconciliation bucket, not silently assigned to a period.
- Master/current-state reports must be labeled snapshot and state their cutoff; movement-derived historical reports must reconstruct from the ledger.

## 6. Focused synthetic tests for later implementation

1. Create invoice at 00:15 WIB; ensure its business date is today's clinic date even if server/browser timezone is UTC or another zone.
2. Create event at 23:55 WIB; verify invoice, shift, activity and payment business date remain the same.
3. Device configured to a non-WIB timezone creates a transaction; persisted business date remains Asia/Jakarta.
4. Run date presets around month/year boundary; verify “7 hari” is seven clinic calendar dates with defined inclusive behavior.
5. Apply method=QRIS and cashier=Kasir Pagi; on-screen, CSV and PDF contain identical invoice IDs.
6. Approve cancellation for an invoice; ordinary sales export excludes it, cancellation audit report retains the reversal reference.
7. Apply discount and package pricing; exported line allocations sum exactly to invoice total.
8. Include invoice with no valid date; it appears in undated reconciliation, not every date-range report.
9. Generate PDF/CSV with date, cashier and method filters; header metadata reflects exact criteria and WIB generation time.
10. Current stock/expiry reports clearly identify snapshot cutoff; selected period does not imply historical stock.
11. Compare dashboard, P&L, cash flow and export with identical date basis; verify totals reconcile from the same source records.
12. Generate reports across midnight and month boundary; verify return approval date and refund payout date are each assigned to their own correct WIB business date.

## 7. Decisions and non-goals

- Use Asia/Jakarta as the clinic's business timezone; retain UTC event instants for technical ordering/audit.
- Decide report-specific date basis; do not force one date field across all financial events.
- Preserve invoice cohort reporting only as a separately named report if requested; current P&L is event-period style.
- Do not modify existing application exports during this audit.
- No speculative report builder, generic analytics engine or arbitrary accounting layer is proposed.

## 8. Safety status

Pass 17 is a static source audit. No application source was edited, no DDL or test data was applied, no live Firebase data was read, no Firebase/Auth accounts or rules were changed, no Vercel deployment occurred, no merge or production operation occurred. The isolated migration branch and Firebase rollback/archive remain intact.
