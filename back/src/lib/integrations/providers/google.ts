/**
 * Proveedor Google unificado: scopes Calendar + Gmail en un solo flujo OAuth.
 * Implementa la interfaz OAuthProvider del diseño (AD2).
 */

export interface ParsedTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  accountLabel?: string;
  metadata: Record<string, unknown>;
}

export interface OAuthProvider {
  authUrl: string;
  tokenUrl: string;
  clientId(): string;
  clientSecret(): string;
  scopes: string;
  extraAuthParams?: Record<string, string>;
  supportsRefresh: boolean;
  /** Parsea la respuesta cruda del endpoint token y extrae los campos normalizados */
  parseTokenResponse(data: Record<string, unknown>, accessToken: string): Promise<ParsedTokenResponse>;
}

/** Endpoint para revocar tokens de Google */
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const googleProvider: OAuthProvider = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: () => process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Scopes mínimos alineados con el cliente OAuth compartido con el CRM (R7-4):
  // gmail.send + calendar.events son "sensibles" (verificación estándar de Google,
  // sin CASA); gmail.modify sería restringido. La lectura/etiquetado de correo se
  // cubre vía n8n con su propia credencial. Las tools de agente list/read/label/
  // archive_email devolverán 403 con credenciales nuevas hasta migrar ese flujo.
  scopes: [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
  ].join(" "),
  extraAuthParams: { access_type: "offline", prompt: "consent" },
  supportsRefresh: true,

  async parseTokenResponse(data, accessToken) {
    // Intentar obtener el email del usuario via userinfo
    let accountLabel: string | undefined;
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userRes.ok) {
        const userInfo: any = await userRes.json();
        accountLabel = userInfo.email ?? undefined;
      }
    } catch {
      // No bloquear el flujo si userinfo falla
    }

    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresAt: typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      accountLabel,
      metadata: accountLabel ? { email: accountLabel } : {},
    };
  },
};
