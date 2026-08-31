import { useCallback, useEffect, useState } from "react";
import type { AccountUser, SavedLocation, AppConfig } from "@ast/shared";
import { authHeaders } from "../auth.js";

export interface NewLocation {
  label: string;
  latitude: number;
  longitude: number;
  isHome?: boolean;
  accuracyRadiusKm?: number;
}

export interface UseAuth {
  googleEnabled: boolean;
  user: AccountUser | null;
  locations: SavedLocation[];
  loading: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  addLocation: (input: NewLocation) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  setHome: (id: string) => Promise<void>;
  useLocation: (id: string) => Promise<AppConfig>;
}

/** Google Sign-In + account saved-locations state (FRD v3.6 §12, §26). */
export function useAuth(): UseAuth {
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/account/locations");
      if (res.ok) setLocations(((await res.json()) as { locations: SavedLocation[] }).locations);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, me] = await Promise.all([
        fetch("/api/auth/config").then((r) => r.json() as Promise<{ googleEnabled: boolean }>),
        fetch("/api/auth/me").then((r) => r.json() as Promise<{ user: AccountUser | null }>),
      ]);
      setGoogleEnabled(cfg.googleEnabled);
      setUser(me.user);
      if (me.user) await loadLocations();
      else setLocations([]);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [loadLocations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setLocations([]);
  }, []);

  const addLocation = useCallback(
    async (input: NewLocation) => {
      const res = await fetch("/api/account/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to save");
      await loadLocations();
    },
    [loadLocations],
  );

  const deleteLocation = useCallback(
    async (id: string) => {
      await fetch(`/api/account/locations/${id}`, { method: "DELETE" });
      await loadLocations();
    },
    [loadLocations],
  );

  const setHome = useCallback(
    async (id: string) => {
      await fetch(`/api/account/locations/${id}/home`, { method: "POST" });
      await loadLocations();
    },
    [loadLocations],
  );

  const useLocation = useCallback(async (id: string): Promise<AppConfig> => {
    const res = await fetch(`/api/account/locations/${id}/use`, {
      method: "POST",
      headers: { ...authHeaders() },
    });
    const body = (await res.json()) as AppConfig | { error: string };
    if (!res.ok) throw new Error((body as { error: string }).error ?? "Could not apply location");
    return body as AppConfig;
  }, []);

  return {
    googleEnabled,
    user,
    locations,
    loading,
    signIn,
    signOut,
    addLocation,
    deleteLocation,
    setHome,
    useLocation,
  };
}
