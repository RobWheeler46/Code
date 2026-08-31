/**
 * Google Sign-In via OAuth 2.0 authorization-code flow (FRD v3.6 §12). Disabled
 * unless GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set. The profile is read from
 * the userinfo endpoint using the access token, avoiding any JWT-verification
 * dependency (the token came from Google's token endpoint over TLS).
 */

import { env } from "../config/env.js";
import type { GoogleProfile } from "../persistence/accountRepo.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("auth.google");
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const REQUEST_TIMEOUT_MS = 10000;

export class GoogleAuth {
  get configured(): boolean {
    return Boolean(env.googleClientId && env.googleClientSecret);
  }

  /** Consent-screen URL to redirect the browser to. */
  authUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: env.googleClientId as string,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  /** Exchange an authorization code for the user's Google profile. */
  async exchangeCode(code: string, redirectUri: string): Promise<GoogleProfile> {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId as string,
        client_secret: env.googleClientSecret as string,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!tokenRes.ok) {
      log.warn("token exchange failed", { status: tokenRes.status });
      throw new Error(`Google token exchange HTTP ${tokenRes.status}`);
    }
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) throw new Error("Google token response missing access_token");

    const infoRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!infoRes.ok) throw new Error(`Google userinfo HTTP ${infoRes.status}`);
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!info.sub) throw new Error("Google userinfo missing sub");
    return { id: info.sub, email: info.email, name: info.name, picture: info.picture };
  }
}
