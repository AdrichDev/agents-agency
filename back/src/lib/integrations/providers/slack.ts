/**
 * Proveedor Slack — bot tokens, sin expiración, sin refresh.
 */

import type { OAuthProvider, ParsedTokenResponse } from "./google";

export const slackProvider: OAuthProvider = {
  authUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  clientId: () => process.env.SLACK_CLIENT_ID ?? "",
  clientSecret: () => process.env.SLACK_CLIENT_SECRET ?? "",
  scopes: "chat:write,channels:read,channels:history",
  supportsRefresh: false, // bot tokens de Slack no caducan (D-P2-4)

  async parseTokenResponse(data, _accessToken): Promise<ParsedTokenResponse> {
    // Slack anida el bot token en data.access_token;
    // el token de usuario autenticado va en data.authed_user?.access_token
    const accessToken =
      (data.access_token as string | undefined) ??
      ((data.authed_user as any)?.access_token as string | undefined) ??
      "";

    const teamName = (data.team as any)?.name as string | undefined;

    return {
      accessToken,
      metadata: { team: teamName },
      accountLabel: teamName,
    };
  },
};
