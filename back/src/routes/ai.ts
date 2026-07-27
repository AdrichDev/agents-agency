import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { openai, STRONG_MODEL } from "@/lib/openai";
import { KNOWN_MODEL_IDS } from "@/lib/model-capabilities";
import {
  DEFAULT_WIDGET_AVATAR,
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
} from "@/lib/widget-config";
import { aiLimiter } from "@/lib/limiters";
import { setCache } from "@/lib/cache";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { captureError } from "@/lib/sentry";
import { isServable } from "@/lib/agent/lifecycle";
import { visitorError } from "@/lib/agent/visitor-error";

/**
 * Endpoints de IA y widget público.
 * Montado en "/api": las rutas conservan sus paths completos
 * (/api/prompt/improve, /api/chat, /api/widget/config).
 */
export const aiRouter = Router();

/* ---------- Mejora de prompt con IA ---------- */

aiRouter.post("/prompt/improve", aiLimiter, async (req, res) => {
  const { sector, prompt, clientName, website } = req.body ?? {};
  try {
    const completion = await openai.chat.completions.create({
      // Generación de agentes con el modelo fuerte → mayor calidad del prompt resultante.
      model: STRONG_MODEL,
      max_completion_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            'Eres experto en diseñar system prompts completos para agentes de IA de atención al cliente. Devuelve SOLO el system prompt mejorado, en español, en segunda persona ("Eres..."), sin explicaciones ni markdown.',
        },
        {
          role: "user",
          content: `Amplía y mejora este system prompt para un agente del sector "${sector ?? "general"}"${clientName ? ` del negocio "${clientName}"` : ""}${website ? ` (web: ${website})` : ""}. Debe incluir personalidad, tono, saludo, funciones, límites, uso de base de conocimiento, cuándo escalar a humano y el flujo de captación de lead: pedir nombre, preguntar si quiere contacto humano, solicitar email y teléfono si acepta, y despedirse correctamente. Entre 350 y 600 palabras.\n\nPrompt actual:\n${prompt || "(vacío, créalo desde cero)"}`,
        },
      ],
    });
    res.json({ prompt: completion.choices[0].message.content?.trim() ?? "" });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error" });
  }
});

/* ---------- Chat (widget + API pública) ---------- */

aiRouter.post("/chat", aiLimiter, async (req, res) => {
  // F1 (aa-agente-consola-pruebas, T1.2): `test` opcional — marca la conversación
  // creada como de prueba (consola). Sin flag, comportamiento idéntico a hoy.
  const { publicKey, agentId, message, conversationId, test } = req.body ?? {};

  // aa-widget-error-visitante — Quién lee esta respuesta decide qué puede leer. Con sesión hay un
  // operador delante (la consola de pruebas); sin ella es un visitante anónimo en la web de un
  // cliente, y ahí no viaja nada nuestro. Ver `visitor-error.ts` y §D1.
  const esOperador = Boolean(req.user);
  const responderFallo = (e: unknown) => {
    const publico = visitorError(e);
    if (esOperador) {
      return res
        .status(publico.status)
        .json({ error: e instanceof Error ? e.message : "Error interno" });
    }
    return res.status(publico.status).json({ error: publico.error, code: publico.code });
  };

  if (!message) return responderFallo(new HttpError(400, "message requerido"));

  const agent = publicKey
    ? await prisma.agent.findUnique({ where: { publicKey } })
    : agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;
  // §D6 — Este 404 sale ANTES del try y es lo que ve un widget mal instalado en un sitio ajeno.
  // Pasa por la misma política para que no haya dos caminos de salida con dos criterios.
  if (!agent) return responderFallo(new HttpError(404, "Agente no encontrado"));

  // H1 (aa-metering-fail-closed): el gate de saldo vive en runAgent (cuello único de todos
  // los canales), no aquí. Antes este handler era el ÚNICO que lo comprobaba, y sólo
  // `if (agent.tenantId)` → un agente sin tenant consumía sin cupo ni registro.
  //
  // SEGURIDAD: `test` exime del gate de saldo, y esta ruta es PÚBLICA
  // (public-routes.ts:21) → sólo se honra con sesión de operador. Sin este filtro
  // cualquiera enviaría `test:true` con una publicKey y consumiría ilimitado saltándose
  // cupo y kill switch. El gate global de /api resuelve req.user incluso en rutas
  // públicas (index.ts), así que aquí ya está disponible.
  const isTest = Boolean(test) && Boolean(req.user);

  try {
    const reply = await chatWithAgent(
      agent.id,
      message,
      conversationId,
      "widget",
      undefined, // clientId deprecado: runAgent resuelve el tenant desde la BD
      isTest
    );
    res.json(reply);
  } catch (e) {
    // El 402 del metering debe llegar como 402 al widget, no como 500: antes este catch
    // devolvía siempre 500 y el motivo real ("límite de uso") se leía como error interno.
    // El status se conserva (`webhook-shared` corta por 402); lo que cambia es el texto.
    const status = e instanceof HttpError ? e.status : 500;

    // §D4 — Este catch responde con `res.json()` y NO llama a `next(e)`, así que `errorHandler`
    // nunca lo ve: hasta ahora un 500 en la ruta que sostiene el producto era invisible en Sentry.
    // Se captura aquí, explícitamente. Los 4xx no: son estado de servicio esperado (cupo, agente
    // despublicado) y llenarían el log de ruido, misma regla que `errorHandler`.
    if (status >= 500) {
      captureError(e, { route: "POST /api/chat", agentId: agent.id, requestId: req.id });
      logger.error({ err: e, agentId: agent.id }, "[chat] fallo al responder");
    } else {
      logger.warn({ agentId: agent.id, status }, "[chat] servicio no disponible");
    }

    responderFallo(e);
  }
});

aiRouter.get("/widget/config", async (req, res) => {
  const publicKey = String(req.query.publicKey ?? "");
  if (!publicKey) return res.status(400).json({ error: "publicKey requerido" });

  const agent = await prisma.agent.findUnique({
    where: { publicKey },
    select: {
      name: true,
      status: true,
      widgetPrimaryColor: true,
      widgetSecondaryColor: true,
      widgetAvatarBase64: true,
      widgetAvatarUrl: true,
      widgetAvatarEmoji: true,
      widgetTemplateConfig: true,
    },
  });
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  // H3 (aa-agente-ciclo-vida-publicacion, T2.3): un agente no publicado no tiene widget
  // público. Antes esto servía nombre, colores y avatar de CUALQUIER agente a quien tuviera
  // su clave, borrador incluido. Mismo 404 que una clave inexistente, y a propósito: el 403
  // confirmaría que la clave es válida y que hay un agente detrás.
  if (!isServable(agent.status)) return res.status(404).json({ error: "Agente no encontrado" });

  // Config pública y poco cambiante, pedida en cada carga del widget → cacheable.
  setCache(res, { maxAge: 60, public: true, staleWhileRevalidate: 300 });
  res.json({
    name: agent.name,
    primaryColor: agent.widgetPrimaryColor || DEFAULT_WIDGET_PRIMARY,
    secondaryColor: agent.widgetSecondaryColor || DEFAULT_WIDGET_SECONDARY,
    // avatarUrl (Storage) preferido; avatarBase64 legacy como fallback. Defensa
    // en profundidad: solo se sirven esquemas seguros (Storage siempre da
    // https://, y avatarBase64 ya se valida en el schema de entrada, pero un
    // registro legacy no debe poder colar javascript:/etc. en el widget).
    avatarUrl: agent.widgetAvatarUrl?.startsWith("https://") ? agent.widgetAvatarUrl : null,
    avatarBase64: agent.widgetAvatarBase64?.startsWith("data:image/") ? agent.widgetAvatarBase64 : null,
    avatarEmoji: agent.widgetAvatarEmoji || DEFAULT_WIDGET_AVATAR,
    template: agent.widgetTemplateConfig || {},
  });
});

/**
 * F7 (aa-agent-backend-foundation, T7.2): auto-verificacion de instalacion del
 * widget. `widget.js` hace un POST best-effort al cargar en la web del cliente.
 * Sella `widgetInstalledAt` en el primer ping y `widgetLastSeenAt` en cada carga
 * → el panel de Implementacion muestra "instalado" con la fecha/ultimo visto.
 *
 * Publico (el widget vive en el sitio del cliente, sin sesion; ver public-routes).
 * Best-effort de extremo a extremo: nunca lanza al cliente ni filtra si la clave
 * existe (204 tambien para claves desconocidas) — es telemetria de instalacion,
 * no un endpoint de datos.
 */
aiRouter.post("/widget/ping", async (req: Request, res: Response) => {
  const publicKey = String((req.body?.publicKey ?? req.query.publicKey) ?? "").trim();
  if (!publicKey) return res.status(400).json({ error: "publicKey requerido" });

  const now = new Date();
  try {
    // Sella la instalacion solo en el primer ping (no pisa la fecha original)...
    await prisma.agent.updateMany({
      where: { publicKey, widgetInstalledAt: null },
      data: { widgetInstalledAt: now, widgetLastSeenAt: now },
    });
    // ...y refresca "ultimo visto" en cada ping (idempotente para el resto).
    await prisma.agent.updateMany({
      where: { publicKey, NOT: { widgetInstalledAt: null } },
      data: { widgetLastSeenAt: now },
    });
  } catch (e) {
    // best-effort: un fallo de persistencia no debe romper la carga del widget.
    logger.warn({ err: e }, "[widget/ping] no se pudo sellar la instalacion");
  }
  // 204 siempre (incluso clave desconocida): no confirma/niega existencia.
  res.status(204).end();
});

/* ---------- Generación IA para el CRM (server-to-server, SIN metering) ---------- */
// El CRM reusa la generación de AA (clave OpenAI + modelos). Es coste de PLATAFORMA:
// NO descuenta cupo del cliente (OpenAI corta el servicio si se agota la cuenta del
// propietario). Auth: AA_SERVICE_TOKEN (gate, en index.ts). Entrada {model, effort,
// prompt} → salida {content, usage:{tokens, model}}.

// ALLOWLIST de modelos/efforts (los que ofrece el CRM, lib/config/models.ts). Acota el
// abuso de coste: aunque se tenga el token de servicio, no se puede forzar un modelo
// arbitrario/caro fuera de esta lista.
// Allowlist = todos los modelos del catálogo de capacidades (anti abuso de coste). El
// nivel de effort se valida por-modelo en el choke-point de openai.ts (resolveEffort).
const ALLOWED_GEN_MODELS = new Set(KNOWN_MODEL_IDS);

async function runGeneration(
  useModel: string,
  prompt: string,
  effort?: string
): Promise<{ content: string; usage: { tokens: number; model: string } }> {
  const body: Record<string, unknown> = {
    model: useModel,
    max_completion_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  };
  // El nivel se valida/coacciona contra las capacidades del modelo en el choke-point de
  // openai.ts (resolveEffort). Aquí solo se propaga la petición.
  if (effort) body.reasoning_effort = effort;
  const completion = await openai.chat.completions.create(
    body as unknown as Parameters<typeof openai.chat.completions.create>[0]
  );
  const content =
    (completion as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim() ?? "";
  const tokens = (completion as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0;
  return { content, usage: { tokens, model: useModel } };
}

async function handleGeneration(req: Request, res: Response) {
  const { model, effort, prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt requerido" });
  }
  // Modelo: vacío → STRONG_MODEL; si viene, debe estar en la allowlist (anti abuso de coste).
  if (model != null && (typeof model !== "string" || !ALLOWED_GEN_MODELS.has(model))) {
    return res.status(400).json({ error: "modelo no permitido" });
  }
  const useModel = model || STRONG_MODEL;
  try {
    res.json(await runGeneration(useModel, prompt, effort));
  } catch (e) {
    // No filtrar detalles internos de OpenAI al cliente; se loguea server-side.
    logger.error({ err: e }, "[ai] generación falló");
    res.status(500).json({ error: "Error generando contenido" });
  }
}

aiRouter.post("/ai/marketing-plan", aiLimiter, handleGeneration);
aiRouter.post("/ai/generate", aiLimiter, handleGeneration);
