"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { profileFirebaseExport } = require("../scripts/profile-firebase-export");

const fixture = {
  exportVersion: 1,
  exportedAt: "2026-11-19T00:00:00Z",
  collections: {
    k_pasien: [
      { documentId: "q1", data: { id: "q1", nama: "Patient One", _t: 1795000000000, tgl: "2026-11-19", phone: null } },
      { documentId: "q1", data: { id: "legacy-other", nama: "Patient Two", createdAt: 1795000000 } }
    ],
    k_trx: { q1: { id: "q1", pid: "q1", createdAt: "2026-11-19T08:00:00+07:00" } }
  }
};

test("profiles counts, preserves per-collection identity and distinguishes cross-collection ID collisions", () => {
  const report = profileFirebaseExport(fixture, { collectionNames: ["k_pasien", "k_trx"] });
  assert.equal(report.totalDocuments, 3);
  assert.equal(report.collections.k_pasien.duplicateDocumentIds, 1);
  assert.equal(report.collections.k_pasien.embeddedIdMismatches, 1);
  assert.deepEqual(report.crossCollectionIdCollisions, [{ documentId: "q1", collections: ["k_pasien", "k_trx"] }]);
});

test("profiles timestamp candidates without converting or guessing units", () => {
  const report = profileFirebaseExport(fixture, { collectionNames: ["k_pasien", "k_trx"] });
  assert.equal(report.timestampFieldCandidates["k_pasien._t:numeric_epoch_milliseconds_candidate"], 1);
  assert.equal(report.timestampFieldCandidates["k_pasien.createdAt:numeric_epoch_seconds_candidate"], 1);
  assert.equal(report.timestampFieldCandidates["k_trx.createdAt:iso_with_explicit_zone"], 1);
});

test("distinguishes explicit null from absent fields", () => {
  const report = profileFirebaseExport(fixture, { collectionNames: ["k_pasien"] });
  assert.equal(report.collections.k_pasien.fieldPresence.phone.explicitNull, 1);
  assert.equal(report.collections.k_pasien.fieldPresence.phone.present, 1);
  assert.equal(report.collections.k_pasien.fieldPresence.nama.present, 2);
});

test("reports requested but absent collections without treating them as empty evidence", () => {
  const report = profileFirebaseExport(fixture, { collectionNames: ["k_pasien", "k_shift"] });
  assert.equal(report.collections.k_shift.missingCollection, true);
  assert.ok(report.issues.some(issue => issue.code === "collection_missing_from_export" && issue.collection === "k_shift"));
});

test("rejects unsupported export shape and malformed documents without crashing", () => {
  assert.throws(() => profileFirebaseExport({ collections: [] }), /collections object/);
  const report = profileFirebaseExport({ collections: { k_pasien: [null, { documentId: "x", data: null }] } });
  assert.equal(report.collections.k_pasien.documents, 0);
  assert.ok(report.issueCount >= 2);
});

test("report is explicitly read-only and excludes raw patient payloads", () => {
  const report = profileFirebaseExport(fixture, { collectionNames: ["k_pasien"] });
  assert.equal(report.mode, "read_only_profile");
  assert.equal(report.safety.wroteToSource, false);
  assert.equal(report.safety.wroteToDatabase, false);
  assert.equal(JSON.stringify(report).includes("Patient One"), false);
});
