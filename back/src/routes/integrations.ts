import { Router } from "express";
import { prisma } from "@/lib/db";
import {
  authorizationUrl,
  handleCallback,
  authorizationUrlPlatform,
  handleCallbackPlatform,
  takeOAuthState,
  disconnectIntegration,
} from "@/lib/integrations/oauth";
import {
  CONNECTABLE_PROVIDERS,
  UPCOMING_PROVIDERS,
  SERVICE_TO_PROVIDER as SERVICE_TO_PROVIDER_MAP,
} from "@/lib/integrations/service-map";
import { asyncHandler, HttpError } from "@/lib/http";

/**
 * Integraciones / OAuth.
 * Montado en "/api": conserva los paths /api/integrations/... y /api/oauth/...
 */
export const integrationsRouter = Router();

const FRONT_URL = process.env.FRONT_URL ?? "http://localhost:3000";

/* ---------- Integraciones / OAuth ---------- */

/** GET /api/integrations/services — fuente única de verdad SERVICE_TO_PROVIDER (R6-1) */
integrationsRouter.get("/integrations/services", (_req, res) => {
  res.json({ serviceToProvider: SERVICE_TO_PROVIDER_MAP, upcomingProviders: Array.from(UPCOMING_PROVIDERS) });
});

/** GET /api/integrations/:agentId/status — estado de conexiones sin tokens (R5-1, AD8) */
integrationsRouter.get(
  "/integrations/:agentId/status",
  asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    const rows = await prisma.integration.findMany({
      where: { agentId },
      select: { provider: true, status: true, metadata: true },
    });

    // Todos los proveedores fase inicial + posteriores
    const allProviders = [
      ...CONNECTABLE_PROVIDERS,
      ...UPCOMING_PROVIDERS,
    ] as string[];

    const integrations = allProviders.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      if (!row) {
        return { provider, status: "disconnected" as const, accountLabel: null };
      }
      const meta: any = row.metadata ?? {};
      const accountLabel: string | null =
        meta.email ?? meta.team ?? meta.workspace_name ?? meta.site ?? null;
      return {
        provider,
        status: row.status as "connected" | "reauth_required",
        accountLabel,
      };
    });

    res.json({ integrations });
  })
);

/** DELETE /api/integrations — desconectar proveedor (con revoke si Google) */
integrationsRouter.delete(
  "/integrations",
  asyncHandler(async (req, res) => {
    const { agentId, provider } = req.body;
    if (!agentId || !provider) throw new HttpError(400, "agentId y provider requeridos");
    await disconnectIntegration(agentId, provider);
    res.json({ ok: true });
  })
);

/**
 * GET /api/oauth/:provider/url — devuelve la URL de autorización como JSON.
 * Para clientes autenticados (Bearer): el front hace fetch y luego navega él
 * mismo a la URL. La variante redirect de abajo no sirve desde un <a href>
 * porque la navegación del navegador no lleva el token y el gate la corta.
 */
integrationsRouter.get(
  "/oauth/:provider/url",
  asyncHandler(async (req, res) => {
    const agentId = req.query.agentId as string;
    if (!agentId) throw new HttpError(400, "agentId requerido");
    try {
      res.json({ url: authorizationUrl(req.params.provider, agentId) });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Proveedor desconocido");
    }
  })
);

/**
 * GET /api/oauth/platform/:provider/url — flujo de PLATAFORMA (aa-agenda-google-import).
 * AA es single-tenant: una sola cuenta Google (el owner), sin agentId — evita
 * el bug de colgar el token del owner de un agente/tenant al azar.
 */
integrationsRouter.get(
  "/oauth/platform/:provider/url",
  asyncHandler(async (req, res) => {
    try {
      res.json({ url: authorizationUrlPlatform(req.params.provider) });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Proveedor desconocido");
    }
  })
);

/** GET /api/oauth/:provider — inicia flujo OAuth con nonce anti-CSRF */
integrationsRouter.get(
  "/oauth/:provider",
  asyncHandler(async (req, res) => {
    const agentId = req.query.agentId as string;
    if (!agentId) throw new HttpError(400, "agentId requerido");
    try {
      res.redirect(authorizationUrl(req.params.provider, agentId));
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Proveedor desconocido");
    }
  })
);

/** GET /api/oauth/:provider/callback — callback con validación de state (AD7) */
integrationsRouter.get(
  "/oauth/:provider/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    // Usuario canceló el flujo (R7-5)
    if (oauthError === "access_denied" || (!code && oauthError)) {
      // Necesitamos el state para saber a qué destino redirigir
      const entry = state ? takeOAuthState(state) : null;
      if (entry?.scope === "platform") {
        return res.redirect(`${FRONT_URL}/agenda?error=oauth_cancelled`);
      }
      if (entry?.agentId) {
        return res.redirect(
          `${FRONT_URL}/agents/${entry.agentId}?tab=integraciones&error=oauth_cancelled`
        );
      }
      return res.redirect(`${FRONT_URL}/?error=oauth_cancelled`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONT_URL}/?error=oauth_cancelled`);
    }

    // Validar nonce (un solo uso, AD7)
    const entry = takeOAuthState(state);
    if (!entry) {
      // state inválido o expirado (CB-4)
      return res.redirect(`${FRONT_URL}/?error=invalid_state`);
    }

    const { provider } = entry;

    // Flujo de PLATAFORMA (aa-agenda-google-import): sin agentId, va a /agenda
    if (entry.scope === "platform") {
      try {
        await handleCallbackPlatform(provider, code);
        return res.redirect(`${FRONT_URL}/agenda?connected=${provider}`);
      } catch (e) {
        const msg = encodeURIComponent(e instanceof Error ? e.message : "error");
        if (e instanceof Error && e.message.includes("cifrado incompleta")) {
          return res.status(500).json({ error: "Configuración de cifrado incompleta" });
        }
        return res.redirect(`${FRONT_URL}/agenda?error=${msg}`);
      }
    }

    // Flujo por-agente (cada tenant conecta SU propio Google)
    const agentId = entry.agentId!;
    try {
      await handleCallback(provider, code, agentId);
      res.redirect(
        `${FRONT_URL}/agents/${agentId}?tab=integraciones&connected=${provider}`
      );
    } catch (e) {
      const msg = encodeURIComponent(e instanceof Error ? e.message : "error");
      if (e instanceof Error && e.message.includes("cifrado incompleta")) {
        return res.status(500).json({ error: "Configuración de cifrado incompleta" });
      }
      res.redirect(
        `${FRONT_URL}/agents/${agentId}?tab=integraciones&error=${msg}`
      );
    }
  })
);
