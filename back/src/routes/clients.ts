import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { nextClientCode, withCodeRetry } from "@/lib/codes";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import {
  listCredentialsPublic,
  upsertCredential,
  reverifyCredential,
  deleteCredential,
} from "@/lib/llm/credentials";
import { countBillableAgents, quotaWarningLevel, resolveTokenQuota } from "@/lib/quota";
import { BILLABLE_STATUSES } from "@/lib/agent/lifecycle";
import { requireRole, supabaseAdmin } from "@/lib/auth";
import { CLIENT_ROLE } from "@/lib/client-scope";
import { validatePassword } from "@/lib/password";
import { logger } from "@/lib/logger";

/* ---------- Clientes ---------- */
// Router de referencia del patrón "API foundations": asyncHandler + validate + HttpError.
// Los errores los formatea el errorHandler central (envelope consistente).

export const clientsRouter = Router();

/**
 * H4 (aa-planes-y-cuotas, T4) — Proyección del cupo para el panel.
 *
 * El panel tiene que ver EL MISMO cupo que aplica el gate, no `tokenBalance` a pelo: desde T4 ese
 * campo es sólo el override, así que un tenant gobernado por su plan saldría con `null` y el panel
 * lo pintaría como cero disponibles mientras el gate le deja pasar. Mismo error que T3.3 cerró con
 * el contador del periodo, un nivel más arriba.
 *
 * `tokenQuota: null` significa SIN TOPE, no cero. `billableAgents` va aparte porque es la otra
 * magnitud —la que H6 manda a Stripe como `quantity`— y confundirla con el cupo es justo lo que
 * design.md §C.4 separa. Ninguno de los dos es un importe.
 *
 * H7 — Añade `quotaWarning`. Se calcula aquí, junto al cupo y con el mismo consumo del periodo que
 * mira el gate, para que el aviso no pueda contradecir al corte: si el panel lo calculara por su
 * cuenta con otro consumo o otro umbral, habría un punto en el que el agente está cortado y la
 * pantalla dice que va bien.
 *
 * En `byok` el aviso es `null`, no `"ok"`: ahí el gate no mira cupo ni incrementa contadores, así que
 * cualquier nivel calculado sería un porcentaje contra un tope que no se aplica. Un cliente que pasa
 * de `platform` a `byok` con el periodo ya consumido saldría con "90% CONSUMIDO" y el operador iría a
 * recargarle tokens que no le hacen falta.
 */
function withQuota<
  T extends {
    tokenBalance: number | null;
    tokensUsedPeriod: number;
    credentialMode: string;
    plan?: { tokenQuotaPerAgent: number | null } | null;
  },
>(client: T, billableAgents: number) {
  const { limit, source } = resolveTokenQuota(client, billableAgents);
  return {
    ...client,
    tokenQuota: limit,
    quotaSource: source,
    quotaWarning:
      client.credentialMode === "byok"
        ? null
        : quotaWarningLevel(client.tokensUsedPeriod, limit),
    billableAgents,
  };
}

clientsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const clients = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { budgets: true, agents: true } },
        plan: { select: { id: true, codigo: true, nombre: true, tokenQuotaPerAgent: true } },
      },
    });
    // Recuento facturable de TODOS los tenants en una sola consulta agrupada, no una por cliente:
    // la lista del panel se pinta entera y un count por fila sería N+1 por cada carga.
    const grouped = await prisma.agent.groupBy({
      by: ["tenantId"],
      where: { status: { in: [...BILLABLE_STATUSES] } },
      _count: { _all: true },
    });
    const billableByTenant = new Map(grouped.map((g) => [g.tenantId, g._count._all]));
    // hasInvoices: la facturación se apoya en Budget — tiene facturas si tiene presupuestos
    res.json(
      clients.map((c) => ({
        ...withQuota(c, billableByTenant.get(c.id) ?? 0),
        hasInvoices: c._count.budgets > 0,
      }))
    );
  })
);

clientsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const client = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      include: {
        budgets: { orderBy: { createdAt: "desc" } },
        plan: { select: { id: true, codigo: true, nombre: true, tokenQuotaPerAgent: true } },
      },
    });
    if (!client) throw new HttpError(404, "Cliente no encontrado");
    const billableAgents = await countBillableAgents(client.id);
    res.json({ ...withQuota(client, billableAgents), hasInvoices: client.budgets.length > 0 });
  })
);

const optionalText = z.string().trim().nullable().optional();
const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "El campo 'name' es obligatorio"),
  razonSocial: optionalText,
  nif: optionalText,
  direccion: optionalText,
  email: z.string().trim().email("Email no válido").nullable().optional().or(z.literal("")),
  phone: optionalText,
  contactPerson: optionalText,
  website: optionalText,
  sector: optionalText,
});
const clientUpdateSchema = clientCreateSchema.partial();

clientsRouter.post(
  "/",
  validate.body(clientCreateSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof clientCreateSchema>;
    // codCliente autogenerado (cli-NN secuencial); reintento si otra petición gana la carrera
    const client = await withCodeRetry(async () =>
      prisma.tenant.create({
        data: {
          codigo: await nextClientCode(),
          ...data,
        },
      })
    );
    res.status(201).json(client);
  })
);

clientsRouter.put(
  "/:id",
  validate.body(clientUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = req.validatedBody as z.infer<typeof clientUpdateSchema>;
    try {
      const client = await prisma.tenant.update({
        where: { id: req.params.id },
        data,
      });
      res.json(client);
    } catch (e: any) {
      if (e?.code === "P2025") throw new HttpError(404, "Cliente no encontrado");
      throw e;
    }
  })
);

/* ---------- Créditos de IA (tokens) ---------- */

// H4 (T6.4): los dos campos son opcionales, y cada uno sólo se escribe si viene. Antes
// `tokenBalance` era obligatorio, y eso dejaba el kill switch manual inoperable desde el panel:
// `TokenSwitch` manda sólo `{isActive}` y recibía 400. Con T1 ese switch es la ÚNICA forma de
// suspender o reactivar a un cliente, así que tenía que dejar de fallar.
const creditsSchema = z
  .object({
    // Cupo absoluto de tokens a asignar (recarga = fijar un nuevo total). Si se omite, NO se toca.
    tokenBalance: z.number().int().min(0).optional(),
    // Activar/desactivar manualmente. Si se omite, NO se toca.
    isActive: z.boolean().optional(),
  })
  .refine((b) => b.tokenBalance !== undefined || b.isActive !== undefined, {
    message: "Indica al menos tokenBalance o isActive",
  });

clientsRouter.patch(
  "/:id/credits",
  validate.body(creditsSchema),
  asyncHandler(async (req, res) => {
    const { tokenBalance, isActive } = req.validatedBody as z.infer<typeof creditsSchema>;
    const current = await prisma.tenant.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!current) throw new HttpError(404, "Cliente no encontrado");
    // H4 (aa-planes-y-cuotas, T1.2): `isActive` sólo cambia si viene explícito. Antes se
    // derivaba del cupo (`isActive ?? tokenBalance > tokensUsed`), y eso mezclaba cupo con
    // estado de pago en las dos direcciones: recargar crédito reactivaba a un cliente
    // suspendido por impago, y bajarle el cupo suspendía a uno que estaba al día. El bloqueo
    // por cupo no necesita este booleano: lo aplica `checkClientBalance` comparando saldo.
    const client = await prisma.tenant.update({
      where: { id: req.params.id },
      data: {
        ...(tokenBalance !== undefined && { tokenBalance }),
        ...(isActive !== undefined && { isActive }),
      },
      select: {
        id: true,
        tokenBalance: true,
        tokensUsed: true,
        tokensUsedPeriod: true,
        isActive: true,
      },
    });
    res.json(client);
  })
);

clientsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    try {
      await prisma.tenant.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (e: any) {
      if (e?.code === "P2025") throw new HttpError(404, "Cliente no encontrado");
      throw e;
    }
  })
);

/* ---------- Modo de credenciales LLM y claves propias del cliente (BYOK) ---------- */
// H2 aa-credenciales-byok-multiproveedor (T3.2).
//
// NINGUNA respuesta de este bloque contiene la clave en claro. Las lecturas van por
// `listCredentialsPublic`, que hace un `select` EXPLÍCITO sin `api_key`; la escritura devuelve
// esa misma vista pública. Lo sostiene una prueba que afirma que el claro no aparece en el
// cuerpo de ninguna respuesta de lectura (`tests/llm-credentials.test.ts`).

const credentialModeSchema = z.object({
  // platform → paga la plataforma y el cupo la protege. byok → paga el cliente con su clave.
  credentialMode: z.enum(["platform", "byok"]),
});

const providerParamSchema = z.object({
  provider: z.enum(["openai", "gemini", "anthropic"]),
});

const apiKeySchema = z.object({
  // Sin formato impuesto: los prefijos de los tres proveedores cambian sin avisar y una
  // validación de forma rechazaría claves buenas. Lo que decide si sirve es `models.list()`.
  apiKey: z.string().trim().min(20, "La clave parece demasiado corta"),
});

async function assertTenantExists(id: string): Promise<void> {
  const found = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!found) throw new HttpError(404, "Cliente no encontrado");
}

clientsRouter.patch(
  "/:id/credential-mode",
  validate.body(credentialModeSchema),
  asyncHandler(async (req, res) => {
    const { credentialMode } = req.validatedBody as z.infer<typeof credentialModeSchema>;
    await assertTenantExists(req.params.id);

    const client = await prisma.tenant.update({
      where: { id: req.params.id },
      data: { credentialMode },
      select: { id: true, credentialMode: true },
    });

    // Pasar a byok sin claves conectadas AVISA, no bloquea: el orden natural de la pantalla es
    // elegir el modo y luego pegar la clave, y bloquear aquí obligaría al humano a hacerlo al
    // revés. Lo que no ocurre es servir con la clave del propietario: el resolutor devuelve 402.
    let warning: string | null = null;
    if (credentialMode === "byok") {
      const connected = await prisma.tenantLlmCredential.count({
        where: { tenantId: req.params.id, status: "connected" },
      });
      if (connected === 0) {
        warning =
          "Este cliente está en modo BYOK y no tiene ninguna clave verificada: sus agentes " +
          "devolverán error hasta que añadas una.";
      }
    }
    res.json({ ...client, warning });
  })
);

clientsRouter.get(
  "/:id/llm-credentials",
  asyncHandler(async (req, res) => {
    await assertTenantExists(req.params.id);
    res.json(await listCredentialsPublic(req.params.id));
  })
);

clientsRouter.put(
  "/:id/llm-credentials/:provider",
  validate.params(providerParamSchema),
  validate.body(apiKeySchema),
  asyncHandler(async (req, res) => {
    const { provider } = req.validatedParams as z.infer<typeof providerParamSchema>;
    const { apiKey } = req.validatedBody as z.infer<typeof apiKeySchema>;
    await assertTenantExists(req.params.id);
    // Una clave que el proveedor rechaza SE GUARDA, marcada `invalid` con el motivo: descartar
    // lo que el humano acaba de teclear por un fallo que puede ser de red es peor que guardarlo
    // inservible y decirlo. El resolutor sólo sirve con `connected`.
    res.json(await upsertCredential(req.params.id, provider, apiKey));
  })
);

clientsRouter.post(
  "/:id/llm-credentials/:provider/verify",
  validate.params(providerParamSchema),
  asyncHandler(async (req, res) => {
    const { provider } = req.validatedParams as z.infer<typeof providerParamSchema>;
    await assertTenantExists(req.params.id);
    const result = await reverifyCredential(req.params.id, provider);
    if (!result) throw new HttpError(404, "No hay ninguna clave guardada para ese proveedor");
    res.json(result);
  })
);

clientsRouter.delete(
  "/:id/llm-credentials/:provider",
  validate.params(providerParamSchema),
  asyncHandler(async (req, res) => {
    const { provider } = req.validatedParams as z.infer<typeof providerParamSchema>;
    await assertTenantExists(req.params.id);
    const removed = await deleteCredential(req.params.id, provider);
    if (!removed) throw new HttpError(404, "No hay ninguna clave guardada para ese proveedor");
    res.json({ ok: true });
  })
);

/* ---------- Usuarios de portal (H5, aa-portal-cliente, T5.1) ---------- */

/**
 * El tenant llega por la URL, no por el body. Es lo que hace imposible el caso que la invariante del
 * design §B prohíbe: un `role = "client"` sin `tenantId`. Con el tenant en el body, la petición sin
 * ese campo tendría que rechazarse a mano y el día que alguien olvidara la comprobación nacería un
 * usuario de portal que la puerta `clientScopeGate` no puede escopar (y que por eso mismo niega).
 */
const portalUserSchema = z.object({
  // Normalizar ANTES de validar: con `.email()` primero, un email pegado con un espacio delante da
  // 400 en vez de darse de alta. Y en minúsculas porque la columna es UNIQUE — "Ana@" y "ana@" serían
  // dos usuarios de portal para la misma persona, y el 409 no saltaría.
  email: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().email()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
  // Contraseña inicial, que el estudio entrega al cliente fuera de banda. Misma política que el
  // cambio de contraseña (`@/lib/password`): dos políticas distintas para la misma cuenta significan
  // que la débil es la que decide.
  password: z.string().superRefine((pw, ctx) => {
    const error = validatePassword(pw);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }),
});

/**
 * POST /api/clients/:id/portal-users — crea el acceso de un cliente a su portal.
 *
 * Sólo `admin`: esto no edita datos de un cliente, crea unas credenciales de acceso al producto.
 *
 * Orden de las dos escrituras, y por qué importa: primero Supabase Auth (que es quien asigna el UUID
 * que `aa.usuario.id` reutiliza) y después la fila de perfil. Si la segunda falla, se **borra** el
 * usuario de Auth recién creado. Sin esa compensación quedaría una cuenta que puede iniciar sesión y
 * recibe 401 en `/api/auth/me` para siempre, y que además bloquea el reintento con el mismo email.
 */
clientsRouter.post(
  "/:id/portal-users",
  requireRole("admin"),
  validate.body(portalUserSchema),
  asyncHandler(async (req, res) => {
    const { email, firstName, lastName, phone, password } = req.validatedBody as z.infer<
      typeof portalUserSchema
    >;
    const tenantId = req.params.id;
    await assertTenantExists(tenantId);

    // Duplicado detectado ANTES de tocar Supabase: así el caso corriente (dar de alta dos veces al
    // mismo contacto) no deja nada a medias que haya que compensar.
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new HttpError(409, "Ya existe un usuario con ese email");

    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      // Alta hecha por el estudio: el email no se confirma por correo porque la contraseña se
      // entrega en mano. Sin esto la cuenta nace sin poder iniciar sesión.
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      const message = created.error?.message ?? "createUser sin usuario";
      // La contraseña NUNCA se registra. Sólo el email y el motivo del proveedor.
      logger.error({ email, err: message }, "[portal-users] createUser falló");
      // Supabase ya tiene esa dirección aunque `aa.usuario` no: sigue siendo un conflicto, no un
      // fallo del servidor.
      if (/already been registered|already exists/i.test(message)) {
        throw new HttpError(409, "Ya existe un usuario con ese email");
      }
      throw new HttpError(502, "No se pudo crear el usuario de acceso");
    }

    const authUserId = created.data.user.id;
    try {
      const user = await prisma.user.create({
        data: {
          id: authUserId,
          firstName,
          lastName,
          email,
          phone: phone ?? null,
          role: CLIENT_ROLE,
          tenantId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          role: true,
          tenantId: true,
        },
      });
      // La respuesta no lleva la contraseña, ni siquiera enmascarada: quien la necesita ya la tecleó.
      res.status(201).json(user);
    } catch (e) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
      if (rollbackError) {
        // Compensación fallida: queda una cuenta huérfana en Auth y hay que borrarla a mano. Se
        // registra el id porque es el único hilo para encontrarla.
        logger.error(
          { authUserId, email, err: rollbackError.message },
          "[portal-users] usuario huérfano en Supabase Auth: borrar a mano"
        );
      }
      throw e;
    }
  })
);
