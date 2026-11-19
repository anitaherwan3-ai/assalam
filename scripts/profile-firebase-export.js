"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_COLLECTIONS = [
  "k_obat", "k_tarif", "k_paket", "k_pasien", "k_trx", "k_petty",
  "k_beli", "k_biaya", "k_loss", "k_shift", "k_batch", "k_log",
  "k_users", "k_returJual", "k_returBeli", "k_batalTrx", "k_returKuota"
];
const MAX_EXAMPLES = 100;
const OBJECT = value => value !== null && typeof value === "object" && !Array.isArray(value);

function safeId(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function flatten(value, prefix = "", output = {}) {
  if (!OBJECT(value) && !Array.isArray(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  if (Array.isArray(value)) {
    if (prefix) output[prefix] = value;
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? prefix + "." + key : key;
    if (OBJECT(child)) flatten(child, next, output);
    else output[next] = child;
  }
  return output;
}

function timestampKind(field, value) {
  if (!/(^|[._])(?:t|at|date|time|timestamp|created|updated|approved|paid|deleted|cancelled|batal|dibuat|diubah)(?:$|[._])|(?:At|Date|Time|Timestamp)$/i.test(field)) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    const abs = Math.abs(value);
    if (abs >= 1e12 && abs < 1e14) return "numeric_epoch_milliseconds_candidate";
    if (abs >= 1e9 && abs < 1e11) return "numeric_epoch_seconds_candidate";
    return "numeric_epoch_unknown_or_out_of_range";
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date_only_string";
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return "iso_with_explicit_zone";
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "iso_without_zone";
    return "other_string";
  }
  if (OBJECT(value) && ("seconds" in value || "nanoseconds" in value)) return "firestore_timestamp_object_candidate";
  if (value === null) return "explicit_null";
  return "other_type";
}

function normalizeDocumentEntries(collectionName, value, issues) {
  if (Array.isArray(value)) return value.map((entry, index) => {
    if (!OBJECT(entry)) {
      issues.push({ code: "invalid_document_entry", collection: collectionName, index });
      return null;
    }
    const documentId = safeId(entry.documentId) || safeId(entry.id);
    if (!documentId || !Object.prototype.hasOwnProperty.call(entry, "data") || !OBJECT(entry.data)) {
      issues.push({ code: "invalid_document_shape", collection: collectionName, index, documentId: documentId || null });
      return null;
    }
    return { documentId, data: entry.data };
  }).filter(Boolean);

  if (OBJECT(value)) return Object.entries(value).map(([documentId, data]) => {
    if (!safeId(documentId) || !OBJECT(data)) {
      issues.push({ code: "invalid_document_shape", collection: collectionName, documentId: safeId(documentId) });
      return null;
    }
    return { documentId, data };
  }).filter(Boolean);

  issues.push({ code: "invalid_collection_shape", collection: collectionName });
  return [];
}

function profileFirebaseExport(input, options = {}) {
  if (!OBJECT(input) || !OBJECT(input.collections)) throw new TypeError("Input must be an object with a collections object.");
  const collectionNames = options.collectionNames || Object.keys(input.collections).sort();
  const issues = [];
  const collections = {};
  const globalIds = new Map();
  const timestampCounts = {};
  let totalDocuments = 0;

  for (const name of collectionNames) {
    if (!Object.prototype.hasOwnProperty.call(input.collections, name)) {
      collections[name] = { documents: 0, missingCollection: true, duplicateDocumentIds: 0, embeddedIdMismatches: 0, fieldPresence: {} };
      issues.push({ code: "collection_missing_from_export", collection: name });
      continue;
    }
    const entries = normalizeDocumentEntries(name, input.collections[name], issues);
    const seen = new Set();
    const summary = { documents: entries.length, missingCollection: false, duplicateDocumentIds: 0, embeddedIdMismatches: 0, fieldPresence: {} };
    totalDocuments += entries.length;

    for (const entry of entries) {
      if (seen.has(entry.documentId)) {
        summary.duplicateDocumentIds++;
        issues.push({ code: "duplicate_document_id_in_export", collection: name, documentId: entry.documentId });
      }
      seen.add(entry.documentId);
      if (!globalIds.has(entry.documentId)) globalIds.set(entry.documentId, []);
      globalIds.get(entry.documentId).push(name);

      if (Object.prototype.hasOwnProperty.call(entry.data, "id") && entry.data.id !== entry.documentId) {
        summary.embeddedIdMismatches++;
        issues.push({ code: "embedded_id_differs_from_document_id", collection: name, documentId: entry.documentId, embeddedId: typeof entry.data.id === "string" ? entry.data.id : "[non-string]" });
      }
      const flat = flatten(entry.data);
      for (const [field, value] of Object.entries(flat)) {
        if (!summary.fieldPresence[field]) summary.fieldPresence[field] = { present: 0, explicitNull: 0, types: {} };
        const stat = summary.fieldPresence[field];
        stat.present++;
        if (value === null) stat.explicitNull++;
        const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
        stat.types[type] = (stat.types[type] || 0) + 1;
        const kind = timestampKind(field, value);
        if (kind) {
          const key = name + "." + field + ":" + kind;
          timestampCounts[key] = (timestampCounts[key] || 0) + 1;
        }
      }
    }
    collections[name] = summary;
  }

  const crossCollectionIdCollisions = [];
  for (const [documentId, names] of globalIds) {
    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length > 1) crossCollectionIdCollisions.push({ documentId, collections: uniqueNames });
  }

  const report = {
    reportVersion: 1,
    mode: "read_only_profile",
    generatedAtUtc: new Date().toISOString(),
    sourceExportedAt: input.exportedAt || null,
    sourceExportVersion: input.exportVersion || null,
    totalDocuments,
    collectionCount: Object.keys(collections).length,
    collections,
    timestampFieldCandidates: timestampCounts,
    crossCollectionIdCollisions,
    issueCount: issues.length,
    issues: issues.slice(0, MAX_EXAMPLES),
    issuesTruncated: Math.max(0, issues.length - MAX_EXAMPLES),
    safety: { wroteToSource: false, wroteToDatabase: false, modifiedAuthentication: false, autoMergedRecords: false, rawPersonalDataIncluded: false },
    limitations: [
      "A missing collection in this profile means absent from the supplied export, not necessarily absent from Firebase.",
      "No duplicate business-key or relational orphan conclusion is made without an approved, source-specific key map.",
      "Timestamp magnitude is a candidate classification only; field semantics and source unit must be verified before conversion.",
      "Only field presence in the supplied JSON representation is measured; absent and explicit null remain distinct."
    ]
  };
  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--input" || key === "--output") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Missing value for " + key);
      args[key.slice(2)] = argv[++i];
    } else if (key === "--help") args.help = true;
    else throw new Error("Unknown argument: " + key);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write("Usage: node scripts/profile-firebase-export.js --input <export.json> [--output <report.json>]\n" +
      "Input format: { exportVersion: 1, exportedAt: ISO-string, collections: { collectionName: [{ documentId, data }] } }\n" +
      "Read-only: does not connect to Firebase or TiDB and never changes source records.\n");
    return;
  }
  if (!args.input) throw new Error("--input is required.");
  const input = JSON.parse(fs.readFileSync(path.resolve(args.input), "utf8"));
  const report = profileFirebaseExport(input, { collectionNames: DEFAULT_COLLECTIONS });
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (args.output) fs.writeFileSync(path.resolve(args.output), serialized, { flag: "wx" });
  process.stdout.write(serialized);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write("Firebase export profiling failed: " + error.message + "\n");
    process.exitCode = 2;
  }
}

module.exports = { profileFirebaseExport, DEFAULT_COLLECTIONS };
