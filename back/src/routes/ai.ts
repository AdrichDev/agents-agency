import { Router } from "express";
import { prisma } from "@/lib/db";
import { chatWithAgent } from "@/lib/agent/engine";
import { openai, DEFAULT_MODEL } from "@/lib/openai";
import {
  DEFAULT_WIDGET_AVATAR,
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
} from "@/lib/widget-config";
import { aiLimiter } from "@/lib/limiters";

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
      model: DEFAULT_MODEL,
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

  try {
    const reply = await chatWithAgent(agent.id, message, conversationId);
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
      widgetAvatarEmoji: true,
      widgetTemplateConfig: true,
    },
  });
  if (!agent) return res.status(404).json({ error: "Agente no encontrado" });

  res.json({
    name: agent.name,
    primaryColor: agent.widgetPrimaryColor || DEFAULT_WIDGET_PRIMARY,
    secondaryColor: agent.widgetSecondaryColor || DEFAULT_WIDGET_SECONDARY,
    avatarBase64: agent.widgetAvatarBase64,
    avatarEmoji: agent.widgetAvatarEmoji || DEFAULT_WIDGET_AVATAR,
    template: agent.widgetTemplateConfig || {},
  });
});
