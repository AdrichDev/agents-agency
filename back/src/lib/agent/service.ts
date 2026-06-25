/**
 * Lógica de negocio de agentes — extraída de routes/agents.ts para dejar
 * los handlers finos (parse req → service → responder). NO cambia comportamiento.
 */
import { prisma } from "@/lib/db";
import { buildSkillStatus } from "@/lib/agent/skill-capabilities";
import { ingestWebsite } from "@/lib/scraper/web";
import * as n8n from "@/lib/n8n/client";
import { encryptToken } from "@/lib/integrations/oauth";
import {
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
  normalizeColorValue,
  normalizeWidgetTemplateConfig,
} from "@/lib/widget-config";
import { avatarAction, uploadImageDataUrl, deletePublicAsset } from "@/lib/storage";
import { HttpError } from "@/lib/http";
import { nextClientCode, nextQuoteNumber, withCodeRetry } from "@/lib/codes";

export const DEFAULT_TOKEN_BALANCE = 10_000_000;

/**
 * Mueve un avatar (data URL) a Supabase Storage y devuelve los campos a guardar.
 * Path determinista por agente → re-subir sobrescribe (sin huérfanos). Si falla
 * el Storage, conserva el base64 como fallback (no rompe el guardado).
 */
export async function resolveAvatarFields(
  agentId: string,
  avatar: string | null | undefined
): Promise<{ widgetAvatarUrl?: string | null; widgetAvatarBase64?: string | null } | undefined> {
  const action = avatarAction(avatar);
  if (action.kind === "noop") return undefined;
  if (action.kind === "clear") {
    await deletePublicAsset(`widget-avatars/${agentId}.webp`);
    return { widgetAvatarUrl: null, widgetAvatarBase64: null };
  }
  try {
    const url = await uploadImageDataUrl(`widget-avatars/${agentId}.webp`, action.dataUrl);
    return { widgetAvatarUrl: url, widgetAvatarBase64: null };
  } catch {
    return { widgetAvatarBase64: action.dataUrl }; // fallback: deja base64
  }
}

/** Listado de agentes sin ecommerceConfig (contiene apiKey cifrada — no exponerla). */
export async function listAgents() {
  const agents = await prisma.agent.findMany({
    include: {
      tenant: true,
      integrations: { select: { provider: true } },
      _count: { select: { conversations: true, automations: true, knowledge: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // El listado no necesita ecommerceConfig y contiene la apiKey cifrada — no exponerla
  return agents.map(({ ecommerceConfig, ...agent }) => agent);
}

export interface CreateAgentInput {
  clientName?: string;
  website?: string;
  skillIds: string[];
  sector: string;
  widgetPrimaryColor?: string;
  widgetSecondaryColor?: string;
  widgetAvatarBase64?: string;
  widgetAvatarEmoji?: string;
  widgetTemplateConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Crea un agente. Si llega clientName, crea cliente nuevo (codCliente secuencial,
 * 10M tokens por defecto) y un presupuesto borrador vinculado. Sube el avatar a
 * Storage tras crear (ya hay id) e ingesta la web en background.
 */
export async function createAgent(input: CreateAgentInput) {
  const { clientName, website, skillIds, ...data } = input;

  // Si se crea cliente nuevo: generar codCliente secuencial + 10M tokens por defecto.
  let newClientData: Record<string, unknown> | undefined;
  if (clientName) {
    const codCliente = await withCodeRetry(() => nextClientCode());
    newClientData = {
      name: clientName,
      website,
      sector: data.sector,
      codigo: codCliente,
      tokenBalance: DEFAULT_TOKEN_BALANCE,
      isActive: true,
    };
  }

  const agent = await prisma.agent.create({
    data: {
      ...data,
      widgetPrimaryColor: data.widgetPrimaryColor
        ? normalizeColorValue(data.widgetPrimaryColor, DEFAULT_WIDGET_PRIMARY)
        : undefined,
      widgetSecondaryColor: data.widgetSecondaryColor
        ? normalizeColorValue(data.widgetSecondaryColor, DEFAULT_WIDGET_SECONDARY)
        : undefined,
      widgetAvatarBase64: data.widgetAvatarBase64 || undefined,
      widgetAvatarEmoji: data.widgetAvatarEmoji || undefined,
      widgetTemplateConfig: data.widgetTemplateConfig
        ? (normalizeWidgetTemplateConfig(data.widgetTemplateConfig) as any)
        : undefined,
      tenant: newClientData ? { create: newClientData as any } : undefined,
      skills: { create: skillIds.map((skillId: string) => ({ skillId })) },
    } as any,
    include: { tenant: true },
  });

  // Avatar → Supabase Storage (tras crear, ya hay id). Guarda URL, no base64.
  const avatarFields = await resolveAvatarFields(agent.id, data.widgetAvatarBase64);
  if (avatarFields) {
    Object.assign(agent, await prisma.agent.update({ where: { id: agent.id }, data: avatarFields }));
  }

  // Crear presupuesto borrador automático vinculado al cliente.
  const clientId = agent.tenantId ?? (agent as any).tenant?.id;
  if (clientId) {
    const quoteNumber = await withCodeRetry(() => nextQuoteNumber());
    await prisma.budget.create({
      data: {
        quoteNumber,
        tenantId: clientId,
        clientSnapshot: (agent as any).tenant
          ? { name: (agent as any).tenant.name, codCliente: (agent as any).tenant.codigo }
          : {},
        status: "draft",
        lines: {
          create: [
            {
              serviceId: "chatbot",
              name: `Chatbot IA — ${agent.name}`,
              description: `Asistente inteligente sector ${agent.sector}`,
              quantity: 1,
              implPrice: 0,
              maintPrice: 0,
              position: 0,
            },
          ],
        },
      },
    });
  }

  if (website) ingestWebsite(agent.id, website).catch(() => {});
  return agent;
}

/**
 * Devuelve el agente por id con la vista segura: enmascara orderStatusApiKey,
 * inyecta el provider "ecommerce" si hay orderStatusUrl, calcula skillStatus y
 * expone si n8n está configurado. Lanza HttpError(404) si no existe.
 */
export async function getAgentDetail(id: string) {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      tenant: true,
      integrations: { select: { id: true, provider: true, metadata: true, createdAt: true } },
      skills: { include: { skill: true } },
      automations: { include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } } },
      _count: { select: { knowledge: true, conversations: true } },
    },
  });
  if (!agent) throw new HttpError(404, "No encontrado");

  const connectedProviders = (agent.integrations as any[]).map((i) => i.provider);
  const ecomCfg = (agent.ecommerceConfig as any) ?? {};

  // AD4/§5.2: inyectar "ecommerce" como provider ejecutable si orderStatusUrl presente
  const providersForSkillStatus = ecomCfg?.orderStatusUrl
    ? [...connectedProviders, "ecommerce"]
    : connectedProviders;

  const skillStatus = buildSkillStatus(
    (agent.skills as any[])
      .filter((s) => s.skill != null)
      .map((s) => ({ id: s.skillId, name: s.skill.name, use: s.skill.use ?? "" })),
    providersForSkillStatus
  );

  // Enmascarar orderStatusApiKey en la respuesta (R6-1, §6.3)
  const safeEcomCfg = { ...ecomCfg };
  if (safeEcomCfg.orderStatusApiKey) safeEcomCfg.orderStatusApiKey = "***";

  // R6-4: exponer si n8n está configurado para que la UI muestre el aviso
  return { ...agent, ecommerceConfig: safeEcomCfg, skillStatus, n8nConfigured: n8n.isConfigured() };
}

/** Actualiza campos básicos del agente. */
export async function updateAgent(id: string, data: Record<string, unknown>) {
  return prisma.agent.update({ where: { id }, data });
}

/** Borra el agente y limpia su avatar en Storage (best-effort, no bloquea). */
export async function deleteAgent(id: string) {
  await prisma.agent.delete({ where: { id } });
  // GC: borra el avatar en Storage (best-effort, no bloquea el borrado).
  await deletePublicAsset(`widget-avatars/${id}.webp`);
}

export interface WidgetConfigInput {
  widgetPrimaryColor?: string;
  widgetSecondaryColor?: string;
  widgetAvatarBase64?: string | null;
  widgetAvatarEmoji?: string;
  widgetTemplateConfig?: Record<string, unknown>;
}

/** Actualiza la config del widget. Avatar → Storage; null/"" limpia; undefined no toca. */
export async function updateWidgetConfig(id: string, data: WidgetConfigInput) {
  // Avatar (data URL) → Storage; null/"" → limpia. undefined → no toca.
  const avatarFields = await resolveAvatarFields(id, data.widgetAvatarBase64);
  return prisma.agent.update({
    where: { id },
    data: {
      widgetPrimaryColor: data.widgetPrimaryColor
        ? normalizeColorValue(data.widgetPrimaryColor, DEFAULT_WIDGET_PRIMARY)
        : undefined,
      widgetSecondaryColor: data.widgetSecondaryColor
        ? normalizeColorValue(data.widgetSecondaryColor, DEFAULT_WIDGET_SECONDARY)
        : undefined,
      ...(avatarFields ?? {}),
      widgetAvatarEmoji: data.widgetAvatarEmoji || undefined,
      widgetTemplateConfig: data.widgetTemplateConfig
        ? (normalizeWidgetTemplateConfig(data.widgetTemplateConfig) as any)
        : undefined,
    },
  });
}

export interface EcommerceConfigInput {
  businessHours?: unknown;
  handoffSlackChannel?: string;
  orderStatusUrl?: string;
  orderStatusApiKey?: string;
}

/**
 * Actualiza la config de ecommerce con merge: conserva la apiKey cifrada existente
 * si no llega una nueva; cifra la nueva si llega texto plano. Enmascara la apiKey
 * en la respuesta. Lanza HttpError(404) si el agente no existe.
 */
export async function updateEcommerceConfig(id: string, incoming: EcommerceConfigInput) {
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { ecommerceConfig: true },
  });
  if (!agent) throw new HttpError(404, "Agente no encontrado");

  const current = (agent.ecommerceConfig as any) ?? {};

  // Merge: conservar apiKey cifrada existente si no viene nueva
  const newConfig: any = { ...current };
  if (incoming.businessHours !== undefined) newConfig.businessHours = incoming.businessHours;
  if (incoming.handoffSlackChannel !== undefined) newConfig.handoffSlackChannel = incoming.handoffSlackChannel;
  if (incoming.orderStatusUrl !== undefined) newConfig.orderStatusUrl = incoming.orderStatusUrl;
  if (incoming.orderStatusApiKey && incoming.orderStatusApiKey.trim() !== "") {
    // Cifrar solo si llega texto plano nuevo
    newConfig.orderStatusApiKey = encryptToken(incoming.orderStatusApiKey);
  }
  // Si orderStatusApiKey llega vacío/omitido → conservar el valor cifrado existente (sin sobreescribir)

  const updated = await prisma.agent.update({
    where: { id },
    data: { ecommerceConfig: newConfig },
    select: { id: true, ecommerceConfig: true },
  });

  // Enmascarar apiKey en la respuesta (nunca en claro) — R6-1
  const cfg: any = { ...((updated.ecommerceConfig as any) ?? {}) };
  if (cfg.orderStatusApiKey) cfg.orderStatusApiKey = "***";

  return { id: updated.id, ecommerceConfig: cfg };
}

/** Leads de un agente con intent/handoff derivados de la metadata de la conversación. */
export async function listAgentLeads(agentId: string) {
  const leads = await prisma.lead.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    include: { conversation: { select: { metadata: true } } },
  });
  return leads.map((l) => ({
    id: l.id,
    customerName: l.customerName,
    email: l.email,
    phone: l.phone,
    status: l.status,
    createdAt: l.createdAt,
    intent: (l.conversation?.metadata as any)?.leadIntent ?? null, // R3-4
    handoff: (l.conversation?.metadata as any)?.handoff === true, // R4-9
  }));
}
