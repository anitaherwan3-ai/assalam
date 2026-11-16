"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLegacyTimestamp } = require("../lib/legacy-timestamp-normalizer");

test("normalizes ISO timestamps with an explicit UTC zone", () => {
  const result = normalizeLegacyTimestamp("2026-11-17T02:00:00Z");
  assert.equal(result.status, "normalized");
  assert.equal(result.normalizedAtUtc, "2026-11-17T02:00:00.000Z");
});

test("normalizes ISO timestamps with an explicit numeric offset", () => {
  const result = normalizeLegacyTimestamp("2026-11-17T09:00:00+07:00");
  assert.equal(result.status, "normalized");
  assert.equal(result.normalizedAtUtc, "2026-11-17T02:00:00.000Z");
});

test("preserves source fractional precision when normalizing ISO timestamps", () => {
  const result = normalizeLegacyTimestamp("2026-11-17T09:00:00.123456+07:00");
  assert.equal(result.status, "normalized");
  assert.equal(result.normalizedAtUtc, "2026-11-17T02:00:00.123456000Z");
});

test("does not guess a timezone for a local timestamp", () => {
  const raw = "2026-11-17T09:00:00";
  const result = normalizeLegacyTimestamp(raw);
  assert.equal(result.status, "needs_review");
  assert.equal(result.normalizedAtUtc, null);
  assert.equal(result.rawValue, raw);
});

test("does not interpret a date-only field as an event timestamp", () => {
  const raw = "2026-11-17";
  const result = normalizeLegacyTimestamp(raw);
  assert.equal(result.status, "needs_review");
  assert.equal(result.reason, "date_only_value_is_not_an_event_timestamp");
});

test("numeric epochs require a source-declared unit", () => {
  const raw = 1794855600000;
  const missingUnit = normalizeLegacyTimestamp(raw);
  const explicitMilliseconds = normalizeLegacyTimestamp(raw, { epochUnit: "milliseconds" });
  assert.equal(missingUnit.status, "needs_review");
  assert.equal(explicitMilliseconds.status, "normalized");
  assert.equal(explicitMilliseconds.normalizedAtUtc, "2026-11-16T19:00:00.000Z");
});

test("normalizes explicitly declared seconds epoch", () => {
  const result = normalizeLegacyTimestamp(1794855600, { epochUnit: "seconds" });
  assert.equal(result.status, "normalized");
  assert.equal(result.sourceFormat, "unix_seconds");
});

test("normalizes Firestore seconds/nanoseconds without discarding nanos", () => {
  const raw = { seconds: 1794855600, nanoseconds: 123456789 };
  const result = normalizeLegacyTimestamp(raw);
  assert.equal(result.status, "normalized");
  assert.equal(result.normalizedAtUtc, "2026-11-16T19:00:00.123456789Z");
});

test("rejects malformed and out-of-range timestamps without inventing a date", () => {
  for (const raw of [null, "", "yesterday", 1.25, { seconds: 10, nanoseconds: 1_000_000_000 }]) {
    const result = normalizeLegacyTimestamp(raw);
    assert.equal(result.status, "needs_review");
    assert.equal(result.normalizedAtUtc, null);
  }
});
