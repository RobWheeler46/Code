/**
 * Client-side admin auth for config/diagnostics (FRD §79).
 *
 * Viewing the display needs nothing. Changing configuration or opening
 * diagnostics requires a password, sent as an HTTP Basic Authorization header on
 * the protected requests. The password is held in sessionStorage for the tab.
 * The server ignores the Basic username, so only a password is needed.
 */

const KEY = "ast_admin_pw";

export function getPassword(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setPassword(pw: string): void {
  try {
    sessionStorage.setItem(KEY, pw);
  } catch {
    /* sessionStorage unavailable - proceed without persistence */
  }
}

export function clearPassword(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Authorization header for protected requests (empty when no password set). */
export function authHeaders(): Record<string, string> {
  const pw = getPassword();
  if (!pw) return {};
  return { Authorization: `Basic ${btoa(`admin:${pw}`)}` };
}

/** Whether the server requires a password for config changes. */
export async function fetchAuthRequired(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/status");
    if (!res.ok) return false;
    const body = (await res.json()) as { authRequired?: boolean };
    return Boolean(body.authRequired);
  } catch {
    return false;
  }
}

/** Verify the currently stored password against the server. */
export async function verifyPassword(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/check", { headers: authHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}
