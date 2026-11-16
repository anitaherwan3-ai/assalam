# Medicine, Tariff, and Service Package Master Data Audit — Pass 22

**Scope:** static source inspection only; no live records, runtime test, or schema deployment.

## Inspected source
- `js/app.js` SHA `f74c4710161ddd2af230e51c18b1f107d6c52c82`
- `js/store.js` SHA `99e74acf8caec9c70d82be1d5f6efc5bfa6bc4fb`
- `js/firebase-backend.js` SHA `3a613d96564f120b8141966f9ecbae21471c4e65`

## Confirmed findings
1. Medicine master fields include name, unit, HPP, selling price, current stock and minimum stock. UI edit can directly change stock as well as HPP and selling price; this can bypass a stock movement document if used as a correction path.
2. Medicine deletion removes the master row from local state. No source-level guard shown here prevents deletion when historical invoices, batches or stock movements reference it. Referential safety must be enforced in MySQL and UI should prefer inactive/archive state.
3. Tariff master includes name, type and price. Editing mutates current master values; deleting removes the row. Invoice line snapshots must remain independent of later tariff edits/deletion.
4. Package master stores a price and nested component snapshots. Builder captures component type, source ID, name, unit price and quantity; editing the package replaces its component array. There is no explicit version history for package composition or price.
5. Existing invoice line snapshots are the historical commercial record; future schema must not recalculate past invoices from current medicine/tariff/package masters.
6. Medicine units are free-text (e.g. strip/botol), with fractional quantity policy not resolved. A generic conversion catalogue must not be invented before owner confirms actual units and allowed fractions.
7. The purchase flow changes current HPP using weighted moving average. The current medicine master HPP is therefore a current valuation projection, not a historical invoice price.
8. Role navigation exposes medicine/tariff/package master to Admin and Pimpinan, but static UI role visibility is not a substitute for server authorization.
9. The generic synchronization layer writes master documents by ID with merge semantics. It does not provide a dedicated server command/version check for each master edit.
10. Package components can refer to medicine or tariff IDs, but source-level referential integrity against deletion is not enforced by a relational FK.

## Target requirements
- Stable medicine/tariff/package IDs; use active/inactive lifecycle rather than hard delete after references exist.
- Preserve immutable invoice line name/type/unit/qty/price/discount/HPP snapshots.
- Preserve package version or a snapshot of expanded components at checkout; package edits affect future sales only.
- Treat stock adjustment as a dedicated reasoned movement with actor and approval policy, not a direct edit to medicine stock.
- Validate positive/finite prices and quantities, unit policy and package component references server-side.
- Maintain HPP valuation history through purchase/stock movements; never rewrite historical invoice HPP.
- Master changes should be versioned or audited with before/after values and actor attribution.

## Synthetic tests required
- Edit/delete referenced medicine, tariff and package; historical invoices remain readable and exact.
- Change package components/price after sale; old invoice and return quota remain tied to original snapshot.
- Invalid unit, fractional qty, zero/negative price, duplicate master identity and missing component.
- Direct stock adjustment rejected or routed to a stock-movement command with reason/approval.
- Concurrent master edits detect stale version rather than silently overwrite.

## Status
Static source audit only. No runtime tests, TiDB DDL, Firebase writes, imports, deployment or production change. Unit/fraction rules and master deactivation policy remain owner decisions.
