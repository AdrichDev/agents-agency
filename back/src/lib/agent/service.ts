/**
 * LÃ³gica de negocio de agentes â€” extraÃ­da de routes/agents.ts para dejar
 * los handlers finos (parse req â†’ service â†’ responder). NO cambia comportamiento.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { buildSkillStatus } from "@/lib/agent/skill-capabilities";
import { ingestWebsite } from "@/lib/scraper/web";
import * as n8n from "@/lib/n8n/client";
import { encryptToken } from "@/lib/integrations/oauth";
import { syncAgentProvisioning, type ProvisionResult } from "@/lib/openclaw/provision";
import {
  DEFAULT_WIDGET_PRIMARY,
  DEFAULT_WIDGET_SECONDARY,
  normalizeColorValue,
  normalizeWidgetTemplateConfig,
} from "@/lib/widget-config";
import { avatarAction, uploadImageDataUrl, deletePublicAsset, deleteKbFolder } from "@/lib/storage";
import { HttpError } from "@/lib/http";
import { nextClientCode, nextQuoteNumber, withCodeRetry } from "@/lib/codes";
import type { BackendCapability } from "@/lib/agent-backend/types";

export const DEFAULT_TOKEN_BALANCE = 10_000_000;

/**
 * Mueve un avatar (data URL) a Supabase Storage y devuelve los campos a guardar.
 * Path determinista por agente â†’ re-subir sobrescribe (sin huÃ©rfanos). Si falla
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

/** Listado de agentes sin ecommerceConfig (contiene apiKey cifrada â€” no exponerla). */
export async function listAgents() {
  const agents = await prisma.agent.findMany({
    include: {
      tenant: true,
      integrations: { select: { provider: true } },
      // F5: leads en el _count — visibilidad mínima tras retirar la tab Leads
      // (contador en dashboard, AC6).
      // aa-agente-consola-pruebas (fix AC4): conversations filtra isTest:false —
      // el conteo "💬 N chats" de la tarjeta de agente no debe inflarse con
      // conversaciones de la consola de pruebas del operador.
      _count: {
        select: {
          conversations: { where: { isTest: false } },
          automations: true,
          knowledge: true,
          leads: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // El listado no necesita ecommerceConfig y contiene la apiKey cifrada â€” no exponerla
  return agents.map(({ ecommerceConfig, ...agent }) => agent);
}

/**
 * Selección obligatoria del backend de datos (F4 aa-agent-backend-foundation;
 * external_api cableado en F1 aa-agent-external-crm-and-lead-qualification).
 * - managed_db: BD gestionada + capabilities.
 * - external_api: HTTP + Bearer contra un CRM externo (apiBaseUrl+businessId
 *   requeridos; apiKey opcional se cifra al persistir).
 * - none_yet: solo información, sin capabilities.
 */
export interface CreateAgentDataBackendInput {
  mode: "managed_db" | "external_api" | "none_yet";
  capabilities?: BackendCapability[];
  // external_api (F1 aa-agent-external-crm-and-lead-qualification)
  apiBaseUrl?: string;
  businessId?: string;
  locationId?: string;
  apiKey?: string;
}

export interface CreateAgentInput {
  tenantId?: string;
  clientName?: string;
  website?: string;
  skillIds: string[];
  dataBackend: CreateAgentDataBackendInput;
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
  const { tenantId, clientName, website, skillIds, dataBackend, ...data } = input;
  const existingTenant = tenantId
    ? await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, codigo: true, sector: true },
      })
    : null;
  if (tenantId && !existingTenant) throw new HttpError(404, "Cliente no encontrado");

  // F1 (aa-agent-external-crm-and-lead-qualification, AC3): external_api exige
  // apiBaseUrl + businessId; sin ellos no hay forma de alcanzar el CRM externo.
  if (dataBackend.mode === "external_api" && (!dataBackend.apiBaseUrl || !dataBackend.businessId)) {
    throw new HttpError(400, "external_api requiere apiBaseUrl y businessId");
  }

  // Si se crea cliente nuevo: codCliente secuencial (cli-NN) + 10M tokens por defecto.
  // El c?lculo del c?digo va DENTRO del retry, junto al create: si otra petici?n gana
  // la carrera (P2002 en tenant.codigo), withCodeRetry recalcula el c?digo y reintenta
  // el create completo. El create anidado es at?mico ? en fallo no persiste nada.
  const agent = await withCodeRetry(async () => {
    const newClientData = !tenantId && clientName
      ? {
          name: clientName,
          website,
          sector: data.sector,
          codigo: await nextClientCode(),
          tokenBalance: DEFAULT_TOKEN_BALANCE,
          isActive: true,
        }
      : undefined;
    return prisma.agent.create({
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
        tenant: tenantId ? { connect: { id: tenantId } } : newClientData ? { create: newClientData as any } : undefined,
        skills: { create: skillIds.map((skillId: string) => ({ skillId })) },
        // F4 (aa-agent-backend-foundation): el backend de datos nace CON el agente
        // en el mismo create anidado (atómico — en fallo no persiste nada).
        // managed_db queda pendiente de aprovisionar la BD (dbUrlEncrypted null,
        // panel F5); none_yet no lleva capabilities aunque el input las traiga.
        dataBackend: {
          create: {
            mode: dataBackend.mode,
            capabilities:
              dataBackend.mode === "managed_db" || dataBackend.mode === "external_api"
                ? dataBackend.capabilities ?? []
                : [],
            // F1 (aa-agent-external-crm-and-lead-qualification): apiBaseUrl/businessId+
            // locationId (dbSchema) + apiKey cifrada — SOLO en external_api.
            ...(dataBackend.mode === "external_api"
              ? {
                  apiBaseUrl: dataBackend.apiBaseUrl,
                  apiKeyEncrypted: dataBackend.apiKey ? encryptToken(dataBackend.apiKey) : undefined,
                  dbSchema: {
                    businessId: dataBackend.businessId,
                    ...(dataBackend.locationId ? { locationId: dataBackend.locationId } : {}),
                  },
                }
              : {}),
          },
        },
      } as any,
      include: { tenant: true },
    });
  });

  // Avatar ? Supabase Storage (tras crear, ya hay id). Guarda URL, no base64.
  const avatarFields = await resolveAvatarFields(agent.id, data.widgetAvatarBase64);
  if (avatarFields) {
    Object.assign(agent, await prisma.agent.update({ where: { id: agent.id }, data: avatarFields }));
  }

  // Crear presupuesto borrador autom?tico vinculado al cliente.
  const clientId = agent.tenantId ?? (agent as any).tenant?.id;
  if (clientId) {
    // C?digo y create dentro del mismo retry: si otra petici?n consume el n?mero
    // (P2002 en budget.quoteNumber), recalcula y reintenta.
    await withCodeRetry(async () =>
      prisma.budget.create({
        data: {
          quoteNumber: await nextQuoteNumber(),
          tenantId: clientId,
          clientSnapshot: (agent as any).tenant
            ? { name: (agent as any).tenant.name, codCliente: (agent as any).tenant.codigo }
            : existingTenant
              ? { name: existingTenant.name, codCliente: existingTenant.codigo }
              : {},
          status: "draft",
          lines: {
            create: [
              {
                serviceId: "chatbot",
                name: `Chatbot IA - ${agent.name}`,
                description: `Asistente inteligente sector ${agent.sector}`,
                quantity: 1,
                implPrice: 0,
                maintPrice: 0,
                position: 0,
              },
            ],
          },
        },
      }),
    );
  }

  // F5: la ingesta de la web inicial deja de ser fire-and-forget silencioso —
  // se persiste un estado visible (pendiente/indexada/fallida) en
  // ecommerceConfig.initialIngest que la tab Conocimiento muestra con re-ingesta.
  if (website) {
    const pendingConfig = {
      ...(((agent as any).ecommerceConfig as Record<string, unknown> | undefined) ?? {}),
      initialIngest: { url: website, status: "pending", updatedAt: new Date().toISOString() },
    };
    await prisma.agent.update({ where: { id: agent.id }, data: { ecommerceConfig: pendingConfig } as any });
    Object.assign(agent, { ecommerceConfig: pendingConfig });

    // Background: al terminar (o fallar) se re-lee la config de BD y se mergea
    // solo initialIngest (evita pisar openclawProvisioning u otros writes).
    ingestWebsite(agent.id, website)
      .then(
        (r): InitialIngestRecord => ({ url: website, status: "indexed", pages: r.pages, chunks: r.chunks }),
        (e): InitialIngestRecord => ({
          url: website,
          status: "failed",
          error: e instanceof Error ? e.message : "Error de ingesta",
        })
      )
      .then((record) => writeInitialIngestStatus(agent.id, record))
      .catch((e) => logger.error({ err: e }, `[agent] initial ingest status write failed id=${agent.id}:`));
  }

  // Fase 6 (aa-centro-mando-agenda-telegram): el wizard crea agentes OpenClaw
  // reales y la UI no debe asumir ?xito. En runtime=openclaw esperamos el
  // read-back fail-soft y persistimos un estado visible en la respuesta/detalle.
  if ((agent as any).runtime === "openclaw") {
    try {
      const provisioning = await syncAgentProvisioning({
        id: agent.id,
        name: agent.name,
        systemPrompt: (agent as any).systemPrompt,
        runtime: (agent as any).runtime,
        temperature: (agent as any).temperature,
      });
      const openclawProvisioning = buildProvisioningRecord(provisioning);
      const updated = await prisma.agent.update({
        where: { id: agent.id },
        data: {
          ecommerceConfig: {
            ...(((agent as any).ecommerceConfig as Record<string, unknown> | undefined) ?? {}),
            openclawProvisioning,
          },
        } as any,
      });
      Object.assign(agent, updated, { openclawProvisioning });
    } catch (e) {
      logger.error({ err: e }, `[agent] openclaw provisioning sync failed on create id=${agent.id}:`);
      Object.assign(agent, {
        openclawProvisioning: { status: "failed", checkedAt: new Date().toISOString() },
      });
    }
  }

  return agent;
}

/**
 * Estado de la ingesta de la "web inicial" del wizard (F5). Se persiste en
 * ecommerceConfig.initialIngest (mismo cajón que openclawProvisioning) y la
 * tab Conocimiento lo muestra con botón de re-ingesta.
 */
export interface InitialIngestRecord {
  url: string;
  status: "pending" | "indexed" | "failed";
  pages?: number;
  chunks?: number;
  error?: string;
  updatedAt?: string;
}

/** Merge de initialIngest sobre la config FRESCA de BD (no pisa otros campos). */
async function writeInitialIngestStatus(agentId: string, record: InitialIngestRecord): Promise<void> {
  const fresh = await prisma.agent.findUnique({ where: { id: agentId }, select: { ecommerceConfig: true } });
  if (!fresh) return;
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      ecommerceConfig: {
        ...(((fresh.ecommerceConfig as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
        initialIngest: { ...record, updatedAt: new Date().toISOString() },
      },
    } as any,
  });
}

/**
 * Refresca el estado de la web inicial cuando se re-ingesta MANUALMENTE la
 * misma URL desde la tab Conocimiento (POST /api/knowledge con url).
 * No-op si la URL no coincide con la web inicial del agente.
 */
export async function refreshInitialIngestStatus(
  agentId: string,
  url: string,
  result: { pages: number; chunks: number }
): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { ecommerceConfig: true } });
  const current = ((agent?.ecommerceConfig as Record<string, unknown> | null) ?? {}) as {
    initialIngest?: InitialIngestRecord;
  };
  if (!current.initialIngest || current.initialIngest.url !== url) return;
  await writeInitialIngestStatus(agentId, {
    url,
    status: "indexed",
    pages: result.pages,
    chunks: result.chunks,
  });
}

/** Registro persistible del estado de aprovisionamiento OpenClaw (JSON en ecommerceConfig). */
export interface OpenclawProvisioningRecord {
  status: "provisioned" | "pending" | "failed" | "skipped";
  checkedAt: string;
  pendingRestart: boolean;
  reason?: string;
}

function buildProvisioningRecord(p: ProvisionResult): OpenclawProvisioningRecord {
  return {
    status: p.ok ? p.provisionState ?? "pending" : "failed",
    checkedAt: new Date().toISOString(),
    pendingRestart: p.pendingRestart === true,
    ...(p.reason ? { reason: p.reason } : {}),
  };
}

/**
 * Re-sincroniza el agente contra OpenClaw BAJO DEMANDA y refresca el estado
 * persistido (aa-openclaw-provision-hardening). Es la acción del botón
 * "Re-sincronizar" de la UI y del paso post-creación del wizard: re-ejecuta el
 * upsert + sonda en vivo (/v1/models) y guarda el resultado, de modo que el
 * chip deja de ser un snapshot congelado del momento del create.
 */
export async function recheckOpenclawProvisioning(id: string): Promise<OpenclawProvisioningRecord> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, name: true, systemPrompt: true, runtime: true, temperature: true, ecommerceConfig: true },
  });
  if (!agent) throw new HttpError(404, "Agente no encontrado");

  if (agent.runtime !== "openclaw") {
    return {
      status: "skipped",
      checkedAt: new Date().toISOString(),
      pendingRestart: false,
      reason: "runtime is not openclaw",
    };
  }

  const provisioning = await syncAgentProvisioning({
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    runtime: agent.runtime,
    temperature: agent.temperature,
  });
  const openclawProvisioning = buildProvisioningRecord(provisioning);

  await prisma.agent.update({
    where: { id },
    data: {
      ecommerceConfig: {
        ...(((agent.ecommerceConfig as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
        openclawProvisioning,
      },
    } as any,
  });

  return openclawProvisioning;
}

/**
 * Devuelve el agente por id con la vista segura: enmascara orderStatusApiKey,
 * inyecta el provider "ecommerce" si hay orderStatusUrl, calcula skillStatus y
 * expone si n8n estÃ¡ configurado. Lanza HttpError(404) si no existe.
 */
export async function getAgentDetail(id: string) {
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      tenant: true,
      integrations: { select: { id: true, provider: true, metadata: true, createdAt: true } },
      skills: { include: { skill: true } },
      automations: { include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } } },
      dataBackend: true, // F5: tab "Datos del negocio" (vista segura más abajo)
      // aa-agente-consola-pruebas (fix AC4): mismo filtro isTest:false que listAgents.
      _count: {
        select: {
          knowledge: true,
          conversations: { where: { isTest: false } },
          leads: true,
        },
      },
    },
  });
  if (!agent) throw new HttpError(404, "No encontrado");

  const connectedProviders = (agent.integrations as any[]).map((i) => i.provider);
  const ecomCfg = (agent.ecommerceConfig as any) ?? {};

  // AD4/Â§5.2: inyectar "ecommerce" como provider ejecutable si orderStatusUrl presente
  const providersForSkillStatus = ecomCfg?.orderStatusUrl
    ? [...connectedProviders, "ecommerce"]
    : connectedProviders;

  const skillStatus = buildSkillStatus(
    (agent.skills as any[])
      .filter((s) => s.skill != null)
      .map((s) => ({
        id: s.skillId,
        name: s.skill.name,
        use: s.skill.use ?? "",
        // F1 aa-skills-executable-contract: facultad declarada, no heurística
        toolsProvider: s.skill.toolsProvider ?? null,
        // F2b: badge MCP (declara servidor + tiene secreto per-agente).
        mcpUrl: s.skill.mcpUrl ?? null,
        hasMcpSecret: Boolean(s.secretEncrypted),
      })),
    providersForSkillStatus
  );

  // Enmascarar orderStatusApiKey en la respuesta (R6-1, Â§6.3)
  const safeEcomCfg = { ...ecomCfg };
  if (safeEcomCfg.orderStatusApiKey) safeEcomCfg.orderStatusApiKey = "***";

  // F5: vista SEGURA del backend de datos — la connection string cifrada nunca
  // sale por API; solo el flag de si está aprovisionada.
  const rawBackend = (agent as any).dataBackend;
  const dataBackend = rawBackend
    ? {
        mode: rawBackend.mode,
        capabilities: rawBackend.capabilities ?? [],
        notificationConfig: rawBackend.notificationConfig ?? {},
        provisioned: Boolean(rawBackend.dbUrlEncrypted),
      }
    : null;

  // R6-4: exponer si n8n estÃ¡ configurado para que la UI muestre el aviso
  return {
    ...agent,
    ecommerceConfig: safeEcomCfg,
    dataBackend,
    skillStatus,
    n8nConfigured: n8n.isConfigured(),
  };
}

/** Cap de skills instaladas por agente (aa-agent-skills-install-execute, F2). */
export const MAX_INSTALLED_SKILLS = 15;

/**
 * Edita el conjunto CURADO de skills instaladas de un agente (reemplazo
 * declarativo, aa-agent-skills-install-execute F2). Valida agente (404) y que
 * TODOS los skillIds existan (400 con la lista de inválidos), dedupe y refuerza
 * el cap MAX_INSTALLED_SKILLS (400). El reemplazo es transaccional (deleteMany
 * + createMany sobre AgentSkill): nada se persiste a medias. Devuelve el
 * skillStatus resultante con las integraciones del agente — mismo cálculo que
 * getAgentDetail. `[]` vacía el conjunto (desinstala todo).
 */
export async function setAgentSkills(agentId: string, skillIds: string[]) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, ecommerceConfig: true, integrations: { select: { provider: true } } },
  });
  if (!agent) throw new HttpError(404, "Agente no encontrado");

  // Dedupe conservando el orden de llegada.
  const unique = [...new Set(skillIds)];

  if (unique.length > MAX_INSTALLED_SKILLS) {
    throw new HttpError(
      400,
      `Máximo ${MAX_INSTALLED_SKILLS} skills instaladas por agente (recibidas ${unique.length}).`
    );
  }

  // Validar existencia de TODAS las skills; 400 con la lista de inválidas.
  const found = unique.length
    ? await prisma.skill.findMany({ where: { id: { in: unique } }, select: { id: true } })
    : [];
  if (found.length !== unique.length) {
    const foundSet = new Set(found.map((s) => s.id));
    const invalid = unique.filter((id) => !foundSet.has(id));
    throw new HttpError(400, `Skills inexistentes: ${invalid.join(", ")}`, "INVALID_SKILL_IDS", {
      invalid,
    });
  }

  // D8 (F2b): antes del reemplazo, capturar el secreto MCP per-agente de las
  // skills que SOBREVIVEN al PUT (siguen en `unique`), para re-inyectarlo tras
  // el delete+create y NO perderlo. El secreto es per-agente-per-skill: reinstalar
  // una skill desde el panel no debe borrar su credencial MCP curada. Cast puntual:
  // el Prisma client commiteado aún no conoce `secretEncrypted` hasta `npm run
  // generate` tras la migración 20260716160000_skill_mcp.
  const survivors = unique.length
    ? ((await prisma.agentSkill.findMany({
        where: { agentId, skillId: { in: unique } },
        select: { skillId: true, secretEncrypted: true },
      } as any)) as unknown as Array<{ skillId: string; secretEncrypted: string | null }>)
    : [];
  const secretBySkill = new Map(survivors.map((r) => [r.skillId, r.secretEncrypted]));

  // Reemplazo declarativo transaccional: borra el set anterior, crea el nuevo
  // re-inyectando el secreto MCP preservado de las skills supervivientes.
  await prisma.$transaction([
    prisma.agentSkill.deleteMany({ where: { agentId } }),
    prisma.agentSkill.createMany({
      data: unique.map((skillId) => ({
        agentId,
        skillId,
        secretEncrypted: secretBySkill.get(skillId) ?? null,
      })),
    } as any),
  ]);

  // skillStatus con las integraciones del agente (idéntico a getAgentDetail:
  // inyecta "ecommerce" como provider ejecutable si hay orderStatusUrl).
  const rows = await prisma.agentSkill.findMany({ where: { agentId }, include: { skill: true } });
  const connectedProviders = (agent.integrations as { provider: string }[]).map((i) => i.provider);
  const ecomCfg = (agent.ecommerceConfig as any) ?? {};
  const providersForSkillStatus = ecomCfg?.orderStatusUrl
    ? [...connectedProviders, "ecommerce"]
    : connectedProviders;

  const skillStatus = buildSkillStatus(
    (rows as any[])
      .filter((s) => s.skill != null)
      .map((s) => ({
        id: s.skillId,
        name: s.skill.name,
        use: s.skill.use ?? "",
        toolsProvider: s.skill.toolsProvider ?? null,
        // F2b: badge MCP (declara servidor + tiene secreto per-agente).
        mcpUrl: s.skill.mcpUrl ?? null,
        hasMcpSecret: Boolean(s.secretEncrypted),
      })),
    providersForSkillStatus
  );

  return { skillStatus };
}

/**
 * Actualiza campos bÃ¡sicos del agente. F2 (aa-openclaw-brain, F2-T1): tras
 * el write, sincroniza (upsert) la entrada agents.list[] en OpenClaw si el
 * agente queda en runtime="openclaw" (persona/nombre pudieron cambiar), o la
 * retira si el `data` trae `runtime` y el agente DEJA de ser "openclaw" (solo
 * en ese caso se hace la lectura previa â€” evita una llamada extra al gateway
 * en updates que no tocan runtime). No bloqueante â€” fail-soft.
 */
export async function updateAgent(id: string, data: Record<string, unknown>) {
  const touchesRuntime = Object.prototype.hasOwnProperty.call(data, "runtime");
  const before = touchesRuntime
    ? await prisma.agent.findUnique({ where: { id }, select: { runtime: true } })
    : null;

  const updated = await prisma.agent.update({ where: { id }, data });

  const wasOpenclaw = before?.runtime === "openclaw";
  const isOpenclaw = updated.runtime === "openclaw";
  const shouldRemove = wasOpenclaw && !isOpenclaw;

  if (isOpenclaw || shouldRemove) {
    syncAgentProvisioning(
      {
        id: updated.id,
        name: updated.name,
        systemPrompt: updated.systemPrompt,
        runtime: updated.runtime,
        temperature: updated.temperature,
      },
      { remove: shouldRemove }
    ).catch((e) => logger.error({ err: e }, `[agent] openclaw provisioning sync failed on update id=${id}:`));
  }

  return updated;
}

/** Borra el agente y limpia su avatar en Storage (best-effort, no bloquea). */
export async function deleteAgent(id: string) {
  const before = await prisma.agent.findUnique({ where: { id }, select: { runtime: true } });

  await prisma.agent.delete({ where: { id } });
  // GC: borra el avatar en Storage (best-effort, no bloquea el borrado).
  await deletePublicAsset(`widget-avatars/${id}.webp`);
  // F5 (AC7): GC de los originales de conocimiento en kb-files/<agentId>/.
  await deleteKbFolder(id);

  // F2 (aa-openclaw-brain, F2-T1): retira la entrada agents.list[] si el
  // agente borrado era runtime="openclaw". Hook DESPUÃ‰S del write en BD,
  // no bloqueante â€” fail-soft.
  if (before?.runtime === "openclaw") {
    syncAgentProvisioning({ id, name: "", runtime: before.runtime }, { remove: true }).catch((e) =>
      logger.error({ err: e }, `[agent] openclaw provisioning removal failed on delete id=${id}:`)
    );
  }
}

export interface WidgetConfigInput {
  widgetPrimaryColor?: string;
  widgetSecondaryColor?: string;
  widgetAvatarBase64?: string | null;
  widgetAvatarEmoji?: string;
  widgetTemplateConfig?: Record<string, unknown>;
}

/** Actualiza la config del widget. Avatar â†’ Storage; null/"" limpia; undefined no toca. */
export async function updateWidgetConfig(id: string, data: WidgetConfigInput) {
  // Avatar (data URL) â†’ Storage; null/"" â†’ limpia. undefined â†’ no toca.
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
  // Si orderStatusApiKey llega vacÃ­o/omitido â†’ conservar el valor cifrado existente (sin sobreescribir)

  const updated = await prisma.agent.update({
    where: { id },
    data: { ecommerceConfig: newConfig },
    select: { id: true, ecommerceConfig: true },
  });

  // Enmascarar apiKey en la respuesta (nunca en claro) â€” R6-1
  const cfg: any = { ...((updated.ecommerceConfig as any) ?? {}) };
  if (cfg.orderStatusApiKey) cfg.orderStatusApiKey = "***";

  return { id: updated.id, ecommerceConfig: cfg };
}

/** Leads de un agente con intent/handoff derivados de la metadata de la conversaciÃ³n. */
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
