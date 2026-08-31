/**
 * Account model for signed-in users (FRD v3.6 §12, §26-27). A Google account may
 * hold personal saved locations, one of which is Home. These are distinct from
 * the session's detected location and a device's fixed location (§26).
 */

/** The signed-in user, as surfaced to the client (no tokens). */
export interface AccountUser {
  email?: string;
  name?: string;
  picture?: string;
}

/** A user's saved location (§26). */
export interface SavedLocation {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  isHome: boolean;
  accuracyRadiusKm?: number;
}

/** Whether Google Sign-In is configured on the server. */
export interface AuthConfig {
  googleEnabled: boolean;
}
