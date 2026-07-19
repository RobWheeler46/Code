// Password policy (FRD v0.26). Stateless string checks live here so the same rules can be described to
// the user and enforced on the server. Reuse-prevention (comparing against previous hashes) needs the DB
// and stays in the route.
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;
const HISTORY_DEPTH = 5; // how many previous passwords a new one must differ from

// A small blocklist of obviously weak / common passwords. Not exhaustive — length is the primary control
// per the FRD ("no forced complexity if strong length and breached-password checks are enabled").
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'password1234',
  '123456789012', '1234567890123', 'qwertyuiop12', 'qwerty123456', 'letmein12345',
  'iloveyou1234', 'administrator', 'welcome12345', 'changeme1234', 'careerexplorer'
]);

// Human-readable rules for the UI's guidance panel.
const POLICY_RULES = [
  `At least ${MIN_LENGTH} characters long`,
  'Not a commonly used or easily guessed password',
  'Different from your name and email address',
  `Different from your current and last ${HISTORY_DEPTH} passwords`
];

// Validate the stateless properties of a proposed password. Returns { ok } or { ok:false, error }.
// `identity` carries email/first/last so we can reject passwords that embed them.
function validatePasswordString(newPassword, identity = {}) {
  const pw = String(newPassword || '');
  if (pw.length < MIN_LENGTH) return { ok: false, error: `Your new password must be at least ${MIN_LENGTH} characters long.` };
  if (pw.length > MAX_LENGTH) return { ok: false, error: `Your new password must be ${MAX_LENGTH} characters or fewer.` };

  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return { ok: false, error: 'That password is too common. Please choose something less predictable.' };
  if (/^(.)\1+$/.test(pw)) return { ok: false, error: 'Your password cannot be a single repeated character.' };

  const bits = [];
  if (identity.email) bits.push(String(identity.email).split('@')[0]);
  if (identity.firstName) bits.push(String(identity.firstName));
  if (identity.lastName) bits.push(String(identity.lastName));
  for (const b of bits) {
    const token = String(b).toLowerCase().trim();
    if (token.length >= 3 && lower.includes(token)) {
      return { ok: false, error: 'Your password should not contain your name or email address.' };
    }
  }
  return { ok: true };
}

module.exports = { MIN_LENGTH, MAX_LENGTH, HISTORY_DEPTH, POLICY_RULES, validatePasswordString };
