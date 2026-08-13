import { useEffect, useState, type ReactNode } from "react";
import {
  fetchAuthRequired,
  verifyPassword,
  setPassword,
  clearPassword,
  getPassword,
} from "../auth.js";

interface Props {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

type Phase = "checking" | "locked" | "open";

/**
 * Gates a page behind the admin password (FRD §79). If the server does not
 * require auth (no SITE_PASSWORD), it opens immediately. Uses an inline prompt -
 * never a native browser dialog.
 */
export function AuthGate({ title, onBack, children }: Props) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const required = await fetchAuthRequired();
      if (!active) return;
      if (!required) {
        setPhase("open");
        return;
      }
      if (getPassword() && (await verifyPassword())) {
        if (active) setPhase("open");
        return;
      }
      clearPassword();
      if (active) setPhase("locked");
    })();
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    if (pw.length === 0) return;
    setBusy(true);
    setError(undefined);
    setPassword(pw);
    const ok = await verifyPassword();
    setBusy(false);
    if (ok) {
      setPhase("open");
    } else {
      clearPassword();
      setError("Incorrect password. Please try again.");
    }
  };

  if (phase === "open") return <>{children}</>;

  return (
    <div className="page">
      <h1>{title}</h1>
      {phase === "checking" ? (
        <p className="hint">Checking…</p>
      ) : (
        <>
          <p className="hint">
            This area is password protected. Enter the password to continue.
          </p>
          <div className="field">
            <label htmlFor="ast-pw">Password</label>
            <input
              id="ast-pw"
              type="password"
              value={pw}
              autoFocus
              autoComplete="current-password"
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
            {error && <div className="status-line err">{error}</div>}
          </div>
          <div className="actions">
            <button onClick={onBack}>Back</button>
            <button
              className="primary"
              onClick={() => void submit()}
              disabled={busy || pw.length === 0}
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
