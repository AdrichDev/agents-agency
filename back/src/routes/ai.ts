import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { openai, STRONG_MODEL } from "@/lib/openai";
import {
  DEFAULT_WIDGET_AVATAR,
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
} from "@/lib/widget-config";
import { aiLimiter } from "@/lib/limiters";
import { setCache } from "@/lib/cache";
import { checkClientBalance } from "@/lib/token-metering";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";

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
  const { publicKey, agentId, message, conversationId } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message requerido" });

  const agent = publicKey
    ? await prisma.agent.findUnique({ where: { publicKey } })
    : agentId
      ? await prisma.agent.findUnique({ where: { id: agentId } })
      : null;
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  // Metering de créditos: si el agente pertenece a un cliente, verificar saldo antes de
  // consumir tokens. checkClientBalance lanza HttpError(402) si está bloqueado o sin cupo.
  if (agent.tenantId) {
    try {
      await checkClientBalance(agent.tenantId);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 402;
      return res.status(status).json({ error: e instanceof Error ? e.message : "Límite excedido" });
    }
  }

  try {
    const reply = await chatWithAgent(
      agent.id,
      message,
      conversationId,
      "widget",
      agent.tenantId ?? undefined
    );
    res.json(reply);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Error interno" });
  }
});

aiRouter.get("/widget/config", async (req, res) => {
  const publicKey = String(req.query.publicKey ?? "");
  if (!publicKey) return res.status(400).json({ error: "publicKey requerido" });

  const agent = await prisma.agent.findUnique({
    where: { publicKey },
    select: {
      name: true,
      widgetPrimaryColor: true,
      widgetSecondaryColor: true,
      widgetAvatarBase64: true,
      widgetAvatarUrl: true,
      widgetAvatarEmoji: true,
      widgetTemplateConfig: true,
    },
  });
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  // Config pública y poco cambiante, pedida en cada carga del widget → cacheable.
  setCache(res, { maxAge: 60, public: true, staleWhileRevalidate: 300 });
  res.json({
    name: agent.name,
    primaryColor: agent.widgetPrimaryColor || DEFAULT_WIDGET_PRIMARY,
    secondaryColor: agent.widgetSecondaryColor || DEFAULT_WIDGET_SECONDARY,
    // avatarUrl (Storage) preferido; avatarBase64 legacy como fallback.
    avatarUrl: agent.widgetAvatarUrl,
    avatarBase64: agent.widgetAvatarBase64,
    avatarEmoji: agent.widgetAvatarEmoji || DEFAULT_WIDGET_AVATAR,
    template: agent.widgetTemplateConfig || {},
  });
});

/* ---------- Generación IA para el CRM (server-to-server, SIN metering) ---------- */
// El CRM reusa la generación de AA (clave OpenAI + modelos). Es coste de PLATAFORMA:
// NO descuenta cupo del cliente (OpenAI corta el servicio si se agota la cuenta del
// propietario). Auth: AA_SERVICE_TOKEN (gate, en index.ts). Entrada {model, effort,
// prompt} → salida {content, usage:{tokens, model}}.

// ALLOWLIST de modelos/efforts (los que ofrece el CRM, lib/config/models.ts). Acota el
// abuso de coste: aunque se tenga el token de servicio, no se puede forzar un modelo
// arbitrario/caro fuera de esta lista.
const ALLOWED_GEN_MODELS = new Set([
  "gpt-5.4", "gpt-5.4-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini",
  "gemini-2.5-pro", "gemini-2.5-flash",
]);
const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

async function runGeneration(
  useModel: string,
  prompt: string,
  effort?: string
): Promise<{ content: string; usage: { tokens: number; model: string } }> {
  // reasoning_effort SOLO en gpt-5* (gpt-4*/Gemini lo rechazan con 400). minimal→low.
  const isReasoning = useModel.startsWith("gpt-5");
  const eff = effort === "minimal" ? "low" : effort;
  const body: Record<string, unknown> = {
    model: useModel,
    max_completion_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  };
  if (isReasoning && eff && ALLOWED_EFFORTS.has(eff)) body.reasoning_effort = eff;
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
