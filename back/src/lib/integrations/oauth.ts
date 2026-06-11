import { prisma } from "@/lib/db";
import type { Integration } from "@/lib/generated/prisma/client";

const APP_URL = () => process.env.BACK_URL ?? "http://localhost:4000";

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  scopes: string;
  extraAuthParams?: Record<string, string>;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? "",
    scopes: "https://www.googleapis.com/auth/gmail.modify",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  calendar: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? "",
    scopes: "https://www.googleapis.com/auth/calendar",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientId: () => process.env.SLACK_CLIENT_ID ?? "",
    clientSecret: () => process.env.SLACK_CLIENT_SECRET ?? "",
    scopes: "chat:write,channels:read,channels:history",
  },
  jira: {
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    clientId: () => process.env.JIRA_CLIENT_ID ?? "",
    clientSecret: () => process.env.JIRA_CLIENT_SECRET ?? "",
    scopes: "read:jira-work write:jira-work offline_access",
    extraAuthParams: { audience: "api.atlassian.com", prompt: "consent" },
  },
};

export function redirectUri(provider: string) {
  return `${APP_URL()}/api/oauth/${provider}/callback`;
}

/** URL para iniciar el flujo OAuth. `state` lleva el agentId. */
export function authorizationUrl(provider: string, agentId: string): string {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);
  if (!cfg.clientId() || !cfg.clientSecret()) {
    throw new Error(
      `Faltan credenciales OAuth de "${provider}" en back/.env — sigue docs/SETUP-OAUTH.md para crearlas y rellena las variables CLIENT_ID/SECRET correspondientes.`
    );
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: cfg.scopes,
    state: agentId,
    ...cfg.extraAuthParams,
  });
  return `${cfg.authUrl}?${params}`;
}

/** Intercambia el code por tokens y guarda la integración. */
export async function handleCallback(provider: string, code: string, agentId: string) {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      redirect_uri: redirectUri(provider),
    }),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`OAuth ${provider}: ${data.error_description ?? data.error ?? res.status}`);
  }

  // Slack anida el token del bot; Jira necesita el cloudId
  const accessToken = data.access_token ?? data.authed_user?.access_token;
  let metadata: Record<string, unknown> = {};
  if (provider === "slack") metadata = { team: data.team?.name };
  if (provider === "jira") {
    const sites: any = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then((r) => r.json());
    metadata = { cloudId: sites?.[0]?.id, site: sites?.[0]?.url };
  }

  await prisma.integration.upsert({
    where: { agentId_provider: { agentId, provider } },
    update: {
      accessToken,
      refreshToken: data.refresh_token ?? undefined,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      metadata: metadata as any,
    },
    create: {
      agentId,
      provider,
      accessToken,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      metadata: metadata as any,
    },
  });
}

/** Devuelve un access token válido, refrescándolo si caducó. */
export async function getAccessToken(integration: Integration): Promise<string> {
  const expired =
    integration.expiresAt && integration.expiresAt.getTime() < Date.now() + 60_000;
  if (!expired || !integration.refreshToken) return integration.accessToken;

  const cfg = PROVIDERS[integration.provider];
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: integration.refreshToken,
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
    }),
  });
  const data: any = await res.json();
  if (!res.ok || !data.access_token) return integration.accessToken;

  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      accessToken: data.access_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    },
  });
  return data.access_token;
}
