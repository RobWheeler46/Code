// Correlation identifiers (FR-AUTH-006, FR-REQ-001, FR-ERR-014).
//
// Format: OSM-YYYYMMDD-XXXXX, matching the example in the FRD wireframes. Every
// retry reuses the parent correlation identifier and takes a new attempt identifier.

const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/1/I/O, so ids can be read aloud

function suffix(length = 5) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function datePart(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function newCorrelationId() {
  return `OSM-${datePart()}-${suffix(5)}`;
}

function newAttemptId(correlationId, attemptNumber) {
  return `${correlationId}#${attemptNumber}`;
}

function newSessionRef(prefix = 'TS') {
  return `${prefix}-${datePart()}-${suffix(6)}`;
}

module.exports = { newCorrelationId, newAttemptId, newSessionRef };
