/**
 * Proveedor Jira (Atlassian) — fase posterior, no conectable en la UI.
 * El proveedor existe para que los tools existentes sigan funcionando;
 * la UI lo marca como "Próximamente" (R5-2).
 */

import type { OAuthProvider, ParsedTokenResponse } from "./google";

export const jiraProvider: OAuthProvider = {
  authUrl: "https://auth.atlassian.com/authorize",
  tokenUrl: "https://auth.atlassian.com/oauth/token",
  clientId: () => process.env.JIRA_CLIENT_ID ?? "",
  clientSecret: () => process.env.JIRA_CLIENT_SECRET ?? "",
  scopes: "read:jira-work write:jira-work offline_access",
  extraAuthParams: { audience: "api.atlassian.com", prompt: "consent" },
  supportsRefresh: true,

  async parseTokenResponse(data, accessToken): Promise<ParsedTokenResponse> {
    // Obtener cloudId de los recursos accesibles
    let metadata: Record<string, unknown> = {};
    try {
      const sites: any = await fetch(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).then((r) => r.json());
      metadata = { cloudId: sites?.[0]?.id, site: sites?.[0]?.url };
    } catch {
      // No bloquear si falla
    }

    return {
      accessToken,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expiresAt: typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      metadata,
      accountLabel: (metadata.site as string | undefined),
    };
  },
};
