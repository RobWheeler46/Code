import { useCallback, useEffect, useState } from "react";
import type { AppConfig, ConfigUpdate } from "@ast/shared";
import { authHeaders } from "../auth.js";

export interface ValidateResult {
  valid: boolean;
  postcode: string;
  latitude: number;
  longitude: number;
}

export interface UseConfig {
  config: AppConfig | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  update: (update: ConfigUpdate) => Promise<AppConfig>;
  reset: () => Promise<AppConfig>;
  validatePostcode: (postcode: string) => Promise<ValidateResult>;
}

/** REST access to the backend configuration API (FRD §39-40). */
export function useConfig(): UseConfig {
  const [config, setConfig] = useState<AppConfig | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfig((await res.json()) as AppConfig);
      setError(undefined);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (patch: ConfigUpdate): Promise<AppConfig> => {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
    const body = (await res.json()) as AppConfig | { error: string };
    if (!res.ok) {
      throw new Error((body as { error: string }).error ?? `HTTP ${res.status}`);
    }
    const next = body as AppConfig;
    setConfig(next);
    return next;
  }, []);

  const reset = useCallback(async (): Promise<AppConfig> => {
    const res = await fetch("/api/config/reset", {
      method: "POST",
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as AppConfig;
    setConfig(next);
    return next;
  }, []);

  const validatePostcode = useCallback(
    async (postcode: string): Promise<ValidateResult> => {
      const res = await fetch("/api/location/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ postcode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as ValidateResult;
    },
    [],
  );

  return { config, loading, error, refresh, update, reset, validatePostcode };
}
