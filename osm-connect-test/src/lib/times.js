// Timestamps are stored either as SQLite `datetime('now')` (UTC, "YYYY-MM-DD HH:MM:SS")
// or as ISO strings written by the application. Parse both without guessing at the zone.

function parseUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const s = String(value).trim();
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  // Bare SQLite timestamp - always UTC.
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

function ukFormat(value) {
  const ms = parseUtc(value);
  if (ms === null || Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London'
  }).format(new Date(ms));
}

function isoNow() {
  return new Date().toISOString();
}

module.exports = { parseUtc, ukFormat, isoNow };
