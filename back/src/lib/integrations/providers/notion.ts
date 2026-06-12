/**
 * Proveedor Notion — OAuth 2.0, token de larga duración, sin refresh.
 * Notion Basic Auth en el intercambio de token.
 */

import type { OAuthProvider, ParsedTokenResponse } from "./google";

export const notionProvider: OAuthProvider = {
  authUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  clientId: () => process.env.NOTION_CLIENT_ID ?? "",
  clientSecret: () => process.env.NOTION_CLIENT_SECRET ?? "",
  scopes: "", // Notion no usa selector de scopes en la URL (se configuran en la app)
  supportsRefresh: false, // tokens de Notion no caducan (R3-1-b)

  async parseTokenResponse(data, _accessToken): Promise<ParsedTokenResponse> {
    const accessToken = data.access_token as string ?? "";
    const workspaceName = data.workspace_name as string | undefined;
    const workspaceId = data.workspace_id as string | undefined;

    return {
      accessToken,
      // Notion no emite refreshToken ni expiresAt
      metadata: {
        workspace_name: workspaceName,
        workspace_id: workspaceId,
      },
      accountLabel: workspaceName,
    };
  },
};
