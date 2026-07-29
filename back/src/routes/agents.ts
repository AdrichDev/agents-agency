import { Router } from "express";
import { z } from "zod";
import { base64ImageSchema } from "@/lib/schemas";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { prisma } from "@/lib/db";
import {
  listAgents,
  createAgent,
  getAgentDetail,
  updateAgent,
  deleteAgent,
  updateWidgetConfig,
  updateEcommerceConfig,
  listAgentLeads,
  recheckOpenclawProvisioning,
  setAgentSkills,
} from "@/lib/agent/service";
import { checkPublishPreconditions, transitionAgentStatus } from "@/lib/agent/lifecycle";
import { INBOUND_BUFFER_MAX_MS } from "@/lib/channels/inbound-buffer";
import { REPLY_MAX_MESSAGES_CAP, REPLY_PAUSE_MAX_MS } from "@/lib/channels/reply-split";
import {
  assertCapabilitiesAllowed,
  assertModeTransitionAllowed,
  buildBackendUpdateData,
  resolveEffectiveMode,
  serializeBackend,
} from "@/lib/agent/backend-config";
import { encryptToken } from "@/lib/integrations/oauth";
import { setPairing } from "@/lib/channels/telegram-pairing";
import { decryptCreds } from "@/lib/channels/webhook-shared";
import { validateToken } from "@/lib/channels/telegram";

/* ---------- Agentes ---------- */

export const agentsRouter = Router();

/** Acepta "miweb.com" y lo normaliza a "https://miweb.com"; vacío → undefined. */
const websiteSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url({ message: "URL de web no válida" }).optional());

/**
 * F4 (aa-agent-backend-foundation) + F1 (aa-agent-external-crm-and-lead-
 * qualification): backend de datos del agente. Tres modos:
 *  - managed_db: aprovisionamos BD gestionada; requiere ≥ 1 capability.
 *  - external_api: HTTP + Bearer contra un CRM externo real; requiere
 *    apiBaseUrl + businessId; capabilities acotadas a reservas/leads (el CRM
 *    público no expone pedidos — T1.5).
 *  - none_yet: "solo información / FAQ", sin capabilities.
 *
 * Backward-compat (GAP #2): el campo es OPCIONAL a nivel de API y default
 * `none_yet` cuando el caller lo omite — así los llamadores no-wizard
 * (n8n / scripts) no rompen con 400. El wizard sigue forzando la elección
 * explícita en el cliente; un `managed_db`/`external_api` mal formado se
 * sigue rechazando por el discriminatedUnion.
 */
const dataBackendSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none_yet") }),
  z.object({
    mode: z.literal("managed_db"),
    capabilities: z
      .array(z.enum(["reservas", "leads", "pedidos"]))
      .min(1, "Elige al menos una capacidad (reservas, leads o pedidos)"),
  }),
  z.object({
    mode: z.literal("external_api"),
    apiBaseUrl: z.string().url("apiBaseUrl debe ser una URL válida"),
    businessId: z.string().min(1, "businessId es requerido"),
    locationId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
    capabilities: z
      .array(z.enum(["reservas", "leads"]))
      .min(1, "Elige al menos una capacidad (reservas o leads)"),
  }),
]);

export const createAgentSchema = z.object({
  name: z.string().min(1),
  sector: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().default("gpt-4.1-nano"),
  // F2 (aa-openclaw-brain): control-plane switch — "openclaw" enruta al gateway local
  // (ver lib/openai.ts getClientForAgent) y provisiona el agente en OpenClaw (F2-T1).
  runtime: z.enum(["openai", "openclaw"]).default("openai"),
  // "" (el panel ya no expone el selector de effort; el front puede mandar
  // cadena vacía) se trata como ausente → cae al default.
  reasoningEffort: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["none", "low", "medium", "high", "xhigh"]).default("low")
  ),
  temperature: z.number().min(0).max(1).default(0.7),
  channel: z.string().default("widget"),
  tenantId: z.string().min(1).optional(),
  clientName: z.string().optional(),
  website: websiteSchema,
  // Las skills se eligen tras crear el agente (pestaña Skills de la ficha), no
  // en el wizard (H3). El campo sigue aceptado (opcional, default []) para no
  // romper llamadas existentes; motor/datos/marketplace intactos.
  skillIds: z.array(z.string()).default([]),
  dataBackend: dataBackendSchema.default({ mode: "none_yet" }),
  widgetPrimaryColor: z.string().optional(),
  widgetSecondaryColor: z.string().optional(),
  widgetAvatarBase64: base64ImageSchema.optional(),
  widgetAvatarEmoji: z.string().optional(),
  widgetTemplateConfig: z.record(z.unknown()).optional(),
});

agentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listAgents());
  })
);

agentsRouter.post(
  "/",
  validate.body(createAgentSchema),
  asyncHandler(async (req, res) => {
    const agent = await createAgent(req.validatedBody as z.infer<typeof createAgentSchema>);
    res.status(201).json(agent);
  })
);

agentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getAgentDetail(req.params.id));
  })
);

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  runtime: z.enum(["openai", "openclaw"]).optional(), // F2 (aa-openclaw-brain)
  // "" → ausente (el panel ya no expone el selector de effort).
  reasoningEffort: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["none", "low", "medium", "high", "xhigh"]).optional()
  ),
  channel: z.string().min(1).optional(),
  // aa-canales-buffer-y-respuesta-partida (T5) — Ritmo del agente en canales de
  // mensajería. Los topes de aquí son la validación de entrada; el recorte real
  // se aplica AL LEER (`getAgentPacing`), para que bajar un tope en el futuro
  // afecte también a los agentes ya guardados (AD5).
  inboundBufferMs: z.number().int().min(0).max(INBOUND_BUFFER_MAX_MS).optional(),
  replyMaxMessages: z.number().int().min(1).max(REPLY_MAX_MESSAGES_CAP).optional(),
  replySplitPauseMs: z.number().int().min(0).max(REPLY_PAUSE_MAX_MS).optional(),
});

agentsRouter.patch(
  "/:id",
  validate.body(updateAgentSchema),
  asyncHandler(async (req, res) => {
    // H3 (aa-agente-ciclo-vida-publicacion, T3.4) — El PATCH general NO cambia el estado:
    // guardar un formulario no puede publicar, y publicar factura. Zod ya lo descartaría en
    // silencio (`status` no está en el esquema), pero el silencio es lo peligroso: quien
    // llame se quedaría creyendo que publicó. Se rechaza en voz alta y se dice por dónde.
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "status")) {
      throw new HttpError(
        400,
        "El estado no se cambia por aquí. Usa POST /api/agents/:id/publish o /unpublish."
      );
    }
    const data = req.validatedBody as z.infer<typeof updateAgentSchema>;
    res.json(await updateAgent(req.params.id, data));
  })
);

/**
 * H3 (aa-agente-ciclo-vida-publicacion, T3) — Publicación del agente.
 *
 * Publicar es una acción explícita y con endpoint propio, no un campo del formulario: es el
 * instante en que el agente empieza a atender al público y empieza a facturar. Antes de este
 * change ese instante era el alta, y nadie lo decidía.
 */
agentsRouter.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        tenantId: true,
        systemPrompt: true,
        channel: true,
        channelConnections: { select: { provider: true } },
      },
    });
    if (!agent) throw new HttpError(404, "Agente no encontrado");
    if (agent.status === "suspended") {
      // La suspensión la pone la plataforma por impago; el propietario del agente no la
      // levanta publicando. Reactivar es de H4/H6, no de aquí.
      throw new HttpError(409, "Agente suspendido por la plataforma. No se puede publicar.");
    }
    // `archived` SÍ pasa, y es deliberado: publicar ES la restauración. La alternativa era
    // rechazarlo y añadir un endpoint de restaurar, que dejaría `archived` sin salida real —
    // un agente archivado por error sólo se recuperaría a mano en la base de datos. No abre
    // agujero: las precondiciones se comprueban igual (tenant y prompt) y la transición deja
    // su `AgentStatusEvent` archived→published, así que la vuelta queda fechada y con actor.

    const { blocking, warnings } = checkPublishPreconditions(agent);
    // Fail-closed y enumerando: publicar a medias es peor que no publicar, y decir sólo
    // "faltan datos" obliga a adivinar cuáles.
    if (blocking.length > 0) {
      throw new HttpError(400, `No se puede publicar: ${blocking.join(" ")}`);
    }

    const { agent: updated, changed } = await transitionAgentStatus(agent.id, "published", {
      actor: req.user?.id ?? null,
    });
    // `changed: false` cuando ya estaba publicado. Idempotente a propósito: dos clics
    // seguidos no duplican evento ni pisan `publishedAt`.
    res.json({ ok: true, changed, status: updated.status, publishedAt: updated.publishedAt, warnings });
  })
);

/**
 * Despublicar devuelve el agente a `draft`, NO a `suspended`. Los dos callan el agente,
 * pero no significan lo mismo para la factura: `suspended` sigue facturando y lo pone la
 * plataforma; `draft` no factura y lo decide el propietario. Meterlos en el mismo saco es
 * el error que H4/T1 tuvo que deshacer con `Tenant.isActive`.
 */
agentsRouter.post(
  "/:id/unpublish",
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!agent) throw new HttpError(404, "Agente no encontrado");
    if (agent.status === "suspended") {
      throw new HttpError(409, "Agente suspendido por la plataforma. Contacta con soporte.");
    }
    if (agent.status === "archived") {
      // No decía "Restáuralo": ese verbo apuntaba a una acción que no existe. La restauración
      // de un archivado es publicarlo (ver `POST /:id/publish`), y despublicar lo que ya está
      // callado no significa nada.
      throw new HttpError(
        409,
        "Agente archivado: ya no atiende. Para reactivarlo, publícalo."
      );
    }

    const { agent: updated, changed } = await transitionAgentStatus(agent.id, "draft", {
      actor: req.user?.id ?? null,
      reason: "unpublished by owner",
    });
    res.json({ ok: true, changed, status: updated.status });
  })
);

/**
 * Archivar: retirada definitiva de un agente que estuvo publicado, en lugar del borrado en
 * duro. Borrarlo destruiría el rastro de qué se sirvió y se facturó, que es justo lo que
 * hace falta para responder una reclamación de factura.
 */
agentsRouter.post(
  "/:id/archive",
  asyncHandler(async (req, res) => {
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true },
    });
    if (!agent) throw new HttpError(404, "Agente no encontrado");
    if (agent.status === "suspended") {
      // Archivar saca al agente de `countBillableAgents`, así que un `suspended` (= vendido y
      // callado por impago) podría archivarse para dejar de figurar como facturable. El
      // propietario no cambia el estado de un agente que la plataforma ha suspendido: ni
      // publicando, ni despublicando, ni archivando. Las tres puertas, cerradas igual.
      throw new HttpError(409, "Agente suspendido por la plataforma. Contacta con soporte.");
    }

    const { agent: updated, changed } = await transitionAgentStatus(agent.id, "archived", {
      actor: req.user?.id ?? null,
      reason: (req.body?.reason as string | undefined) ?? null,
    });
    res.json({ ok: true, changed, status: updated.status });
  })
);

/** Historial de cambios de estado. Es lo que permite responder "¿estuvo publicado en junio?". */
agentsRouter.get(
  "/:id/status-events",
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.agentStatusEvent.findMany({
        where: { agentId: req.params.id },
        orderBy: { createdAt: "asc" },
      })
    );
  })
);

/**
 * Re-sincroniza el agente contra OpenClaw y devuelve el estado actualizado
 * (aa-openclaw-provision-hardening). Lo usan el botón "Re-sincronizar" del
 * detalle y el paso post-creación del wizard.
 */
agentsRouter.post(
  "/:id/openclaw/recheck",
  asyncHandler(async (req, res) => {
    res.json({ openclawProvisioning: await recheckOpenclawProvisioning(req.params.id) });
  })
);

agentsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteAgent(req.params.id);
    res.json({ ok: true });
  })
);

const widgetConfigSchema = z.object({
  widgetPrimaryColor: z.string().optional(),
  widgetSecondaryColor: z.string().optional(),
  widgetAvatarBase64: base64ImageSchema.nullable().optional(),
  widgetAvatarEmoji: z.string().optional(),
  widgetTemplateConfig: z.record(z.unknown()).optional(),
});

agentsRouter.patch(
  "/:id/widget-config",
  validate.body(widgetConfigSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof widgetConfigSchema>;
    res.json(await updateWidgetConfig(req.params.id, data));
  })
);

/* ---------- Skills instaladas (aa-agent-skills-install-execute, F2) ---------- */

/**
 * Edita el conjunto CURADO de skills del agente (reemplazo declarativo). El
 * cliente natural es un multi-select con "Guardar": envía el conjunto deseado
 * completo, no deltas. `[]` desinstala todo. Mismo patrón que PATCH /:id/backend.
 */
export const setAgentSkillsSchema = z.object({
  skillIds: z.array(z.string().min(1)),
});

agentsRouter.put(
  "/:id/skills",
  validate.body(setAgentSkillsSchema),
  asyncHandler(async (req, res) => {
    const { skillIds } = req.validatedBody as z.infer<typeof setAgentSkillsSchema>;
    res.json(await setAgentSkills(req.params.id, skillIds));
  })
);

/* ---------- Backend de datos (F5, tab "Datos del negocio") ---------- */

/**
 * Config editable del AgentDataBackend desde el panel: capabilities
 * (managed_db: reservas/leads/pedidos; external_api: solo reservas/leads,
 * T1.5) y destino de notificaciones al dueño del negocio. El dispatcher
 * real de avisos es F6 — aquí SOLO se persiste la config (a dónde/cómo).
 */
export const updateBackendSchema = z
  .object({
    capabilities: z.array(z.enum(["reservas", "leads", "pedidos"])).optional(),
    notificationConfig: z
      .object({
        telegramChatId: z.string().max(64).optional(),
        events: z.array(z.enum(["nueva_reserva", "nuevo_lead", "handoff"])).optional(),
      })
      .optional(),
    // F1: switch de modo post-creación. Se acepta "external_api" (config CRM, H6) y
    // "managed_db" (activar nuestra BD desde none_yet/external_api; solo fija el modo,
    // el aprovisionamiento es el endpoint POST /:id/backend/provision aparte). Se
    // mantiene el bloqueo de SALIR de managed_db (no se tira una BD ya provisionada).
    mode: z.enum(["external_api", "managed_db"]).optional(),
    apiBaseUrl: z.string().url().optional(),
    // Write-only: "" o ausente conserva la key actual; nunca se devuelve por ninguna vista.
    apiKey: z.string().optional(),
    businessId: z.string().optional(),
    locationId: z.string().optional(),
  })
  .refine(
    (v) =>
      v.capabilities !== undefined ||
      v.notificationConfig !== undefined ||
      v.mode !== undefined ||
      v.apiBaseUrl !== undefined ||
      v.apiKey !== undefined ||
      v.businessId !== undefined ||
      v.locationId !== undefined,
    { message: "Nada que actualizar" }
  );

agentsRouter.patch(
  "/:id/backend",
  validate.body(updateBackendSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof updateBackendSchema>;
    const backend = await prisma.agentDataBackend.findUnique({ where: { agentId: req.params.id } });
    if (!backend) throw new HttpError(404, "El agente no tiene backend de datos");

    assertModeTransitionAllowed(backend.mode, data.mode);
    assertCapabilitiesAllowed(resolveEffectiveMode(backend.mode, data.mode), data.capabilities);

    const updated = await prisma.agentDataBackend.update({
      where: { agentId: req.params.id },
      data: buildBackendUpdateData(backend, data),
    });

    res.json(serializeBackend(updated));
  })
);

/**
 * No-op idempotente (aa-managed-db-conexion-compartida F2). managed_db usa la
 * conexión COMPARTIDA de la app (DATABASE_URL) sobre el schema `aa`, aislado por
 * `agente_id`: ya no hay rol/BD per-agente que aprovisionar. El endpoint se
 * mantiene para no romper llamadas del front y devuelve "listo" sin invocar
 * `provisionManagedDbBackend` ni exigir `AGENT_BACKEND_ADMIN_DB_URL`. El flujo de
 * rol/RLS de `provisioning.ts` queda inerte.
 */
agentsRouter.post(
  "/:id/backend/provision",
  asyncHandler(async (_req, res) => {
    res.json({ status: "already_provisioned", provisioned: true });
  })
);

/* ---------- Telegram pairing por deep-link (aa-telegram-chatid-autocaptura) ---------- */

/**
 * Genera un token de pairing y devuelve el deep-link `t.me/<bot>?start=<token>`.
 * El endpoint va tras el gate de sesión del tenant (montado bajo /api). El token
 * es la prueba de autorización para el binding vía webhook (análogo a
 * webhookSecret); viaja SOLO en el enlace al dueño autenticado y nunca se loguea.
 * 400 si el agente no tiene Telegram conectado.
 */
agentsRouter.post(
  "/:id/telegram/pairing-token",
  asyncHandler(async (req, res) => {
    const agentId = req.params.id;
    const conn = await prisma.channelConnection.findUnique({
      where: { agentId_provider: { agentId, provider: "telegram" } },
    });
    if (!conn) throw new HttpError(400, "Conecta primero el bot de Telegram");

    let botUsername = conn.botUsername ?? null;
    if (!botUsername) {
      // Recuperación opcional: si falta botUsername pero hay credenciales,
      // consultamos getMe para reconstruir el enlace sin obligar a reconectar.
      try {
        const creds = decryptCreds<{ token: string }>(conn.credentials);
        const bot = await validateToken(creds.token);
        botUsername = bot.username;
      } catch {
        botUsername = null;
      }
    }
    if (!botUsername) throw new HttpError(400, "Conecta primero el bot de Telegram");

    const { token, expiresAt } = await setPairing(agentId);
    res.json({ link: `https://t.me/${botUsername}?start=${token}`, expiresAt });
  })
);

/**
 * Estado del pairing para el polling del front. Refleja si ya hay un chat_id
 * vinculado. NUNCA devuelve el token de pairing.
 */
agentsRouter.get(
  "/:id/telegram/pairing-status",
  asyncHandler(async (req, res) => {
    const backend = await prisma.agentDataBackend.findUnique({
      where: { agentId: req.params.id },
    });
    const config = (backend?.notificationConfig as Record<string, unknown> | null) ?? {};
    const chatId = typeof config.telegramChatId === "string" ? config.telegramChatId : undefined;
    res.json({ linked: Boolean(chatId), ...(chatId ? { chatId } : {}) });
  })
);

/* ---------- Ecommerce config ---------- */

const ecommerceConfigSchema = z.object({
  businessHours: z
    .object({
      timezone: z.string(),
      schedule: z.array(
        z.object({
          day: z.number().int().min(0).max(6),
          open: z.string(),
          close: z.string(),
        })
      ),
    })
    .optional(),
  handoffSlackChannel: z.string().optional(),
  orderStatusUrl: z.string().url().optional().or(z.literal("")),
  orderStatusApiKey: z.string().optional(), // texto plano → se cifra aquí
});

agentsRouter.patch(
  "/:id/ecommerce-config",
  validate.body(ecommerceConfigSchema),
  asyncHandler(async (req, res) => {
    const incoming = req.validatedBody as z.infer<typeof ecommerceConfigSchema>;
    res.json(await updateEcommerceConfig(req.params.id, incoming));
  })
);

/* ---------- Leads por agente ---------- */

agentsRouter.get(
  "/:id/leads",
  asyncHandler(async (req, res) => {
    res.json({ leads: await listAgentLeads(req.params.id) });
  })
);
