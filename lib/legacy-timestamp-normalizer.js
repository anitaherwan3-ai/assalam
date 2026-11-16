"use strict";

const ISO_WITH_ZONE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

function needsReview(rawValue, reason) {
  return Object.freeze({
    status: "needs_review",
    normalizedAtUtc: null,
    rawValue,
    reason
  });
}

function normalized(rawValue, normalizedAtUtc, sourceFormat) {
  return Object.freeze({
    status: "normalized",
    normalizedAtUtc,
    rawValue,
    sourceFormat
  });
}

function normalizeIsoWithZone(rawValue) {
  const match = ISO_WITH_ZONE.exec(rawValue);
  if (!match) return null;
  const parsed = Date.parse(rawValue);
  if (!Number.isFinite(parsed)) {
    return needsReview(rawValue, "invalid_iso_timestamp");
  }

  let utc = new Date(parsed).toISOString();
  if (match[2]) {
    const fraction = match[2].padEnd(9, "0");
    utc = utc.replace(/\.\d{3}Z$/, "." + fraction + "Z");
  }
  return normalized(rawValue, utc, "iso_with_explicit_zone");
}

function normalizeFirestoreTimestamp(rawValue) {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
  const hasSeconds = Object.prototype.hasOwnProperty.call(rawValue, "seconds");
  const hasNanos = Object.prototype.hasOwnProperty.call(rawValue, "nanoseconds");
  if (!hasSeconds && !hasNanos) return null;
  if (!hasSeconds || !hasNanos ||
      !Number.isSafeInteger(rawValue.seconds) ||
      !Number.isInteger(rawValue.nanoseconds) ||
      rawValue.nanoseconds < 0 || rawValue.nanoseconds >= 1_000_000_000) {
    return needsReview(rawValue, "invalid_firestore_timestamp_shape");
  }

  const milliseconds = rawValue.seconds * 1000;
  if (!Number.isSafeInteger(milliseconds)) {
    return needsReview(rawValue, "firestore_timestamp_out_of_range");
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return needsReview(rawValue, "firestore_timestamp_out_of_range");
  }

  let utc = date.toISOString();
  if (rawValue.nanoseconds !== 0) {
    utc = utc.replace(/\.\d{3}Z$/, "." + String(rawValue.nanoseconds).padStart(9, "0") + "Z");
  }
  return normalized(rawValue, utc, "firestore_seconds_nanoseconds");
}

function normalizeNumericEpoch(rawValue, epochUnit) {
  if (typeof rawValue !== "number" || !Number.isSafeInteger(rawValue)) return null;
  if (epochUnit !== "seconds" && epochUnit !== "milliseconds") {
    return needsReview(rawValue, "numeric_epoch_unit_not_declared");
  }

  const milliseconds = epochUnit === "seconds" ? rawValue * 1000 : rawValue;
  if (!Number.isSafeInteger(milliseconds)) {
    return needsReview(rawValue, "numeric_epoch_out_of_range");
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    return needsReview(rawValue, "numeric_epoch_out_of_range");
  }
  return normalized(rawValue, date.toISOString(), "unix_" + epochUnit);
}

function normalizeLegacyTimestamp(rawValue, options = {}) {
  if (typeof rawValue === "string") {
    if (!rawValue.trim()) return needsReview(rawValue, "empty_timestamp");
    const result = normalizeIsoWithZone(rawValue);
    if (result) return result;
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
      return needsReview(rawValue, "date_only_value_is_not_an_event_timestamp");
    }
    return needsReview(rawValue, "timestamp_missing_explicit_zone_or_invalid_format");
  }

  if (typeof rawValue === "number") {
    const result = normalizeNumericEpoch(rawValue, options.epochUnit);
    return result || needsReview(rawValue, "numeric_timestamp_must_be_a_safe_integer");
  }

  if (rawValue && typeof rawValue === "object") {
    return normalizeFirestoreTimestamp(rawValue) ||
      needsReview(rawValue, "unsupported_timestamp_object");
  }

  return needsReview(rawValue, "timestamp_missing_or_unsupported");
}

module.exports = { normalizeLegacyTimestamp };
