/**
 * Orquestador OAuth: authorizationUrl, handleCallback, getValidToken.
 * Gestiona cifrado enc:v1:, state anti-CSRF y refresh con lock anti-carrera.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encrypt, decrypt } from "@/lib/crypto";
import { googleProvider, GOOGLE_REVOKE_URL } from "./providers/google";
import { slackProvider } from "./providers/slack";
import { notionProvider } from "./providers/notion";
import { jiraProvider } from "./providers/jira";
import type { OAuthProvider } from "./providers/google";
import { toPhysicalProvider } from "./service-map";
import { randomBytes } from "node:crypto";

// ── Registro de proveedores ────────────────────────────────────────────────────

const PROVIDERS: Record<string, OAuthProvider> = {
  google: googleProvider,
  slack: slackProvider,
  notion: notionProvider,
  jira: jiraProvider,
};

// Mantener backward-compat: gmail/calendar resuelven a google
// (para el endpoint GET /api/oauth/:provider que usa el front antiguo si quedara)
PROVIDERS.gmail = googleProvider;
PROVIDERS.calendar = googleProvider;

// ── Errors tipados ─────────────────────────────────────────────────────────────

class IntegrationMissingError extends Error {
  constructor(agentId: string, provider: string) {
    super(`El agente ${agentId} no tiene conectado ${provider}`);
    this.name = "IntegrationMissingError";
  }
}

class ReauthRequiredError extends Error {
  constructor(provider: string) {
    super(`La integración ${provider} requiere reconexión (token revocado o caducado)`);
    this.name = "ReauthRequiredError";
  }
}

// ── Cifrado enc:v1: ────────────────────────────────────────────────────────────

const ENC_PREFIX = "enc:v1:";

/** Cifra un token y lo envuelve con el prefijo enc:v1: */
export function encryptToken(plain: string): string {
  const payload = encrypt(plain);
  return ENC_PREFIX + Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** Descifra un token envuelto con enc:v1:; si no tiene prefijo, devuelve el valor tal cual (legacy). */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy passthrough
  const json = Buffer.from(stored.slice(ENC_PREFIX.length), "base64").toString("utf8");
  const payload = JSON.parse(json);
  return decrypt(payload);
}

/** Devuelve true si el valor tiene el prefijo enc:v1: */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

// ── State store anti-CSRF (Map TTL, AD7) ──────────────────────────────────────

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface StateEntry {
  scope: "agent" | "platform";
  agentId?: string;
  provider: string;
  exp: number;
}

const stateStore = new Map<string, StateEntry>();

/** Limpieza perezosa de nonces expirados */
function purgeExpiredStates(now: number): void {
  for (const [nonce, entry] of stateStore) {
    if (now > entry.exp) stateStore.delete(nonce);
  }
}

/** Crea y registra un nonce de un solo uso en el state store (flujo por-agente) */
export function createOAuthState(agentId: string, provider: string, now = Date.now()): string {
  purgeExpiredStates(now);
  const nonce = randomBytes(16).toString("hex");
  stateStore.set(nonce, { scope: "agent", agentId, provider, exp: now + STATE_TTL_MS });
  return nonce;
}

/** Crea y registra un nonce de un solo uso para el flujo de PLATAFORMA (sin agentId) */
export function createPlatformOAuthState(provider: string, now = Date.now()): string {
  purgeExpiredStates(now);
  const nonce = randomBytes(16).toString("hex");
  stateStore.set(nonce, { scope: "platform", provider, exp: now + STATE_TTL_MS });
  return nonce;
}

/**
 * Consume el nonce (get + delete, un solo uso).
 * Devuelve null si el nonce no existe o está expirado.
 */
export function takeOAuthState(nonce: string, now = Date.now()): StateEntry | null {
  const entry = stateStore.get(nonce);
  stateStore.delete(nonce); // siempre borrar (un solo uso)
  if (!entry || now > entry.exp) return null;
  return entry;
}

// ── Lock anti-carrera para refresh ────────────────────────────────────────────

const refreshLocks = new Map<string, Promise<string>>();

// ── Helpers ────────────────────────────────────────────────────────────────────

const APP_URL = () => process.env.BACK_URL ?? "http://localhost:4000";

export function redirectUri(provider: string): string {
  // Siempre usar el proveedor físico en la redirectUri
  const physical = toPhysicalProvider(provider);
  return `${APP_URL()}/api/oauth/${physical}/callback`;
}

// ── URL de autorización ────────────────────────────────────────────────────────

/** Genera la URL OAuth con nonce anti-CSRF y redirige al proveedor. */
export function authorizationUrl(provider: string, agentId: string): string {
  const physical = toPhysicalProvider(provider);
  const cfg = PROVIDERS[physical];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);
  if (!cfg.clientId() || !cfg.clientSecret()) {
    throw new Error(
      `Faltan credenciales OAuth de "${physical}" en back/.env — sigue docs/SETUP-OAUTH.md para crearlas y rellena las variables CLIENT_ID/SECRET correspondientes.`
    );
  }

  const nonce = createOAuthState(agentId, physical);

  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri(physical),
    response_type: "code",
    state: nonce,
    ...cfg.extraAuthParams,
  });

  // Notion no usa scope en la URL de auth (configurado en la app)
  if (cfg.scopes) params.set("scope", cfg.scopes);

  return `${cfg.authUrl}?${params}`;
}

// ── Callback OAuth ────────────────────────────────────────────────────────────

/** Intercambia el code por tokens, cifra y persiste la Integration. */
export async function handleCallback(provider: string, code: string, agentId: string): Promise<void> {
  const physical = toPhysicalProvider(provider);
  const cfg = PROVIDERS[physical];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);

  // Validar que CHANNEL_ENCRYPTION_KEY está disponible antes de continuar (R1-4)
  try {
    encryptToken("test-key-check");
  } catch {
    throw new Error("Configuración de cifrado incompleta");
  }

  // Notion usa Basic Auth para el intercambio de token
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (physical === "notion") {
    const creds = Buffer.from(`${cfg.clientId()}:${cfg.clientSecret()}`).toString("base64");
    headers["Authorization"] = `Basic ${creds}`;
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      redirect_uri: redirectUri(physical),
    }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || (data.error as string | undefined)) {
    throw new Error(
      `OAuth ${physical}: ${(data.error_description as string | undefined) ?? (data.error as string | undefined) ?? res.status}`
    );
  }

  const rawAccessToken =
    (data.access_token as string | undefined) ??
    ((data.authed_user as any)?.access_token as string | undefined) ??
    "";

  if (!rawAccessToken) throw new Error(`OAuth ${physical}: no se recibió access_token`);

  // Parsear respuesta por proveedor (obtiene accountLabel, metadata, etc.)
  const parsed = await cfg.parseTokenResponse(data, rawAccessToken);

  // Cifrar tokens antes de persistir (R1-1)
  const encryptedAccess = encryptToken(parsed.accessToken);
  const encryptedRefresh = parsed.refreshToken ? encryptToken(parsed.refreshToken) : undefined;

  await prisma.integration.upsert({
    where: { agentId_provider: { agentId, provider: physical } },
    update: {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh ?? null,
      expiresAt: parsed.expiresAt ?? null,
      metadata: parsed.metadata as any,
      status: "connected",
    },
    create: {
      agentId,
      provider: physical,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh ?? null,
      expiresAt: parsed.expiresAt ?? null,
      metadata: parsed.metadata as any,
      status: "connected",
    },
  });
}

// ── getValidToken (capa única, AD3) ───────────────────────────────────────────

/**
 * Devuelve un access token válido en texto plano.
 * Descifra, refresca si expirado (con lock anti-carrera), maneja invalid_grant.
 * TODOS los consumidores pasan por aquí (executor, engines).
 */
export async function getValidToken(agentId: string, provider: string): Promise<string> {
  const physical = toPhysicalProvider(provider);

  const integration = await prisma.integration.findUnique({
    where: { agentId_provider: { agentId, provider: physical } },
  });
  if (!integration) throw new IntegrationMissingError(agentId, physical);

  const plainAccess = decryptToken(integration.accessToken);

  // Verificar si hay que refrescar (margen 60s, AD3)
  const isExpired =
    integration.expiresAt !== null &&
    integration.expiresAt.getTime() < Date.now() + 60_000;

  const cfg = PROVIDERS[physical];
  const shouldRefresh = isExpired && cfg?.supportsRefresh && !!integration.refreshToken;

  if (!shouldRefresh) return plainAccess;

  // Lock anti-carrera: segunda llamada concurrente reutiliza la promesa en vuelo
  const lockKey = `${agentId}:${physical}`;
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;

  const refreshPromise = doRefresh(agentId, physical, integration, cfg).finally(() => {
    refreshLocks.delete(lockKey);
  });
  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
}

async function doRefresh(
  agentId: string,
  physical: string,
  integration: { id: string; refreshToken: string | null; accessToken: string },
  cfg: OAuthProvider
): Promise<string> {
  const plainRefresh = decryptToken(integration.refreshToken!);

  try {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: plainRefresh,
        client_id: cfg.clientId(),
        client_secret: cfg.clientSecret(),
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as Record<string, unknown>;

    // invalid_grant u otro error de autorización → reauth_required
    if (!res.ok || data.error) {
      const err = data.error as string | undefined;
      if (
        err === "invalid_grant" ||
        err === "invalid_token" ||
        res.status === 401 ||
        res.status === 400
      ) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: "reauth_required" },
        });
        throw new ReauthRequiredError(physical);
      }
      // Otro error HTTP → fallo de red transitorio (R4-2-b)
      logger.error({ data }, `[oauth] refresh ${physical} falló con estado ${res.status}:`);
      return decryptToken(integration.accessToken);
    }

    const newAccess = data.access_token as string;
    const encryptedAccess = encryptToken(newAccess);
    const encryptedRefresh = typeof data.refresh_token === "string"
      ? encryptToken(data.refresh_token)
      : undefined;

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        accessToken: encryptedAccess,
        ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
        expiresAt: typeof data.expires_in === "number"
          ? new Date(Date.now() + data.expires_in * 1000)
          : null,
        status: "connected",
      },
    });

    return newAccess;
  } catch (e) {
    if (e instanceof ReauthRequiredError) throw e;
    // Error de red u otro fallo transitorio: devolver token viejo, sin marcar reauth (R4-2-b)
    logger.error({ err: e }, `[oauth] refresh ${physical} error transitorio:`);
    return decryptToken(integration.accessToken);
  }
}

// ── Disconnect / revoke ────────────────────────────────────────────────────────

/** Revoca el token en Google si aplica, luego elimina la Integration. */
export async function disconnectIntegration(agentId: string, provider: string): Promise<void> {
  const physical = toPhysicalProvider(provider);

  const integration = await prisma.integration.findUnique({
    where: { agentId_provider: { agentId, provider: physical } },
  });

  // Intentar revocar en Google (solo Google expone endpoint de revoke)
  if (integration && physical === "google") {
    try {
      const token = decryptToken(integration.accessToken);
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch {
      // No bloquear si el revoke falla
    }
  }

  await prisma.integration.delete({
    where: { agentId_provider: { agentId, provider: physical } },
  });
}

/** Desconecta la integración de PLATAFORMA (revoke best-effort + borrado de la fila). */
export async function disconnectPlatformIntegration(provider: string): Promise<void> {
  const physical = toPhysicalProvider(provider);

  const integration = await prisma.platformIntegration.findUnique({ where: { provider: physical } });
  if (!integration) return;

  if (physical === "google") {
    try {
      const token = decryptToken(integration.accessToken);
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch {
      // No bloquear si el revoke falla
    }
  }

  await prisma.platformIntegration.delete({ where: { provider: physical } });
}

// ── Flujo de PLATAFORMA (aa-agenda-google-import) ───────────────────────────
//
// AA es single-tenant: solo existe UNA cuenta Google (el owner). Este flujo
// es independiente del OAuth por-agente de arriba (cada tenant conecta SU
// propio Google para que su chatbot consulte/reserve en su calendario) —
// escribe en PlatformIntegration, sin agentId, para que "conectar" desde
// /agenda nunca pueda colgarse por error de un agente al azar.
// Comparte el mismo endpoint físico de callback; se distingue por
// entry.scope === "platform" en el nonce de state.

/** Genera la URL OAuth de plataforma (mismo callback físico que el flujo por-agente). */
export function authorizationUrlPlatform(provider: string): string {
  const physical = toPhysicalProvider(provider);
  const cfg = PROVIDERS[physical];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);
  if (!cfg.clientId() || !cfg.clientSecret()) {
    throw new Error(
      `Faltan credenciales OAuth de "${physical}" en back/.env — sigue docs/SETUP-OAUTH.md para crearlas y rellena las variables CLIENT_ID/SECRET correspondientes.`
    );
  }

  const nonce = createPlatformOAuthState(physical);

  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: redirectUri(physical),
    response_type: "code",
    state: nonce,
    ...cfg.extraAuthParams,
  });
  if (cfg.scopes) params.set("scope", cfg.scopes);

  return `${cfg.authUrl}?${params}`;
}

/** Intercambia el code por tokens y persiste en PlatformIntegration (sin agentId). */
export async function handleCallbackPlatform(provider: string, code: string): Promise<void> {
  const physical = toPhysicalProvider(provider);
  const cfg = PROVIDERS[physical];
  if (!cfg) throw new Error(`Proveedor desconocido: ${provider}`);

  try {
    encryptToken("test-key-check");
  } catch {
    throw new Error("Configuración de cifrado incompleta");
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: cfg.clientId(),
      client_secret: cfg.clientSecret(),
      redirect_uri: redirectUri(physical),
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || (data.error as string | undefined)) {
    throw new Error(
      `OAuth ${physical}: ${(data.error_description as string | undefined) ?? (data.error as string | undefined) ?? res.status}`
    );
  }

  const rawAccessToken = (data.access_token as string | undefined) ?? "";
  if (!rawAccessToken) throw new Error(`OAuth ${physical}: no se recibió access_token`);

  const parsed = await cfg.parseTokenResponse(data, rawAccessToken);
  const encryptedAccess = encryptToken(parsed.accessToken);
  const encryptedRefresh = parsed.refreshToken ? encryptToken(parsed.refreshToken) : undefined;

  await prisma.platformIntegration.upsert({
    where: { provider: physical },
    update: {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh ?? null,
      expiresAt: parsed.expiresAt ?? null,
      metadata: parsed.metadata as any,
      status: "connected",
    },
    create: {
      provider: physical,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh ?? null,
      expiresAt: parsed.expiresAt ?? null,
      metadata: parsed.metadata as any,
      status: "connected",
    },
  });
}

/** Equivalente a getValidToken pero para la integración de plataforma (sin agentId). */
export async function getValidPlatformToken(provider: string): Promise<string> {
  const physical = toPhysicalProvider(provider);

  const integration = await prisma.platformIntegration.findUnique({ where: { provider: physical } });
  if (!integration) throw new IntegrationMissingError("platform", physical);

  const plainAccess = decryptToken(integration.accessToken);

  const isExpired =
    integration.expiresAt !== null && integration.expiresAt.getTime() < Date.now() + 60_000;

  const cfg = PROVIDERS[physical];
  const shouldRefresh = isExpired && cfg?.supportsRefresh && !!integration.refreshToken;

  if (!shouldRefresh) return plainAccess;

  const lockKey = `platform:${physical}`;
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;

  const refreshPromise = doRefreshPlatform(physical, integration, cfg).finally(() => {
    refreshLocks.delete(lockKey);
  });
  refreshLocks.set(lockKey, refreshPromise);
  return refreshPromise;
}

async function doRefreshPlatform(
  physical: string,
  integration: { id: string; refreshToken: string | null; accessToken: string },
  cfg: OAuthProvider
): Promise<string> {
  const plainRefresh = decryptToken(integration.refreshToken!);

  try {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: plainRefresh,
        client_id: cfg.clientId(),
        client_secret: cfg.clientSecret(),
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok || data.error) {
      const err = data.error as string | undefined;
      if (err === "invalid_grant" || err === "invalid_token" || res.status === 401 || res.status === 400) {
        await prisma.platformIntegration.update({
          where: { id: integration.id },
          data: { status: "reauth_required" },
        });
        throw new ReauthRequiredError(physical);
      }
      logger.error({ data }, `[oauth] refresh plataforma ${physical} falló con estado ${res.status}:`);
      return decryptToken(integration.accessToken);
    }

    const newAccess = data.access_token as string;
    const encryptedAccess = encryptToken(newAccess);
    const encryptedRefresh = typeof data.refresh_token === "string" ? encryptToken(data.refresh_token) : undefined;

    await prisma.platformIntegration.update({
      where: { id: integration.id },
      data: {
        accessToken: encryptedAccess,
        ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
        expiresAt: typeof data.expires_in === "number" ? new Date(Date.now() + data.expires_in * 1000) : null,
        status: "connected",
      },
    });

    return newAccess;
  } catch (e) {
    if (e instanceof ReauthRequiredError) throw e;
    logger.error({ err: e }, `[oauth] refresh plataforma ${physical} error transitorio:`);
    return decryptToken(integration.accessToken);
  }
}

