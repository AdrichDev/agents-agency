import type { AgentDataBackend, Prisma } from "@/lib/generated/prisma/client";
import { HttpError } from "@/lib/http";
import { encryptToken } from "@/lib/integrations/oauth";

/**
 * aa-deuda-p3-fase2 #7 — Reglas del backend de datos de un agente, fuera del handler.
 *
 * `PATCH /api/agents/:id/backend` acumulaba las tres cosas que decide este módulo: qué cambios de
 * modo se permiten, qué capabilities son válidas en cada modo, y cómo se mezclan los dos campos
 * JSON sin pisar claves ausentes. Es lógica de negocio pura —no toca red ni BD— así que aquí se
 * puede leer y probar sin montar un router.
 *
 * Refactor SIN cambio de comportamiento: mismos mensajes de error, mismos códigos, misma forma
 * del payload. Si algo aquí difiere del handler original, es un bug, no una mejora.
 */

/** Campos aceptados por el PATCH. Espejo de `updateBackendSchema` en `routes/agents.ts`. */
export interface UpdateBackendInput {
  capabilities?: ("reservas" | "leads" | "pedidos")[];
  notificationConfig?: { telegramChatId?: string; events?: string[] };
  mode?: "external_api" | "managed_db";
  apiBaseUrl?: string;
  /** Write-only: nunca se devuelve ni se loguea; sólo entra cifrado. */
  apiKey?: string;
  businessId?: string;
  locationId?: string;
}

/** Capabilities que admite un CRM externo. `pedidos` requiere nuestra BD. */
const EXTERNAL_API_CAPABILITIES = new Set(["reservas", "leads"]);

/**
 * Modo resultante tras aplicar el PATCH.
 *
 * Se calcula antes de escribir porque gobierna la validación de capabilities: pedirlas en el mismo
 * PATCH que cambia el modo tiene que validarse contra el modo NUEVO, no contra el viejo.
 */
export function resolveEffectiveMode(current: string, requested: UpdateBackendInput["mode"]): string {
  return requested ?? current;
}

/**
 * Reglas de transición de modo.
 *
 * La única prohibida es SALIR de `managed_db`: esa BD ya está provisionada y con datos del cliente
 * dentro, así que convertirla a otro modo dejaría los datos huérfanos sin que nadie lo pida
 * explícitamente. Entrar en `managed_db` desde `none_yet`/`external_api` sí se permite, y sólo
 * fija el modo — aprovisionar es otro endpoint.
 */
export function assertModeTransitionAllowed(current: string, requested: UpdateBackendInput["mode"]): void {
  if (current === "managed_db" && requested !== undefined && requested !== "managed_db") {
    throw new HttpError(400, "El backend gestionado no se puede convertir a API externa aquí");
  }
}

/** Capabilities válidas para el modo que quedará vigente tras el PATCH. */
export function assertCapabilitiesAllowed(
  effectiveMode: string,
  capabilities: UpdateBackendInput["capabilities"]
): void {
  if (capabilities === undefined) return;
  if (effectiveMode !== "managed_db" && effectiveMode !== "external_api") {
    throw new HttpError(
      400,
      "Las capabilities requieren un backend configurado (managed_db o external_api)"
    );
  }
  if (effectiveMode === "external_api" && capabilities.some((c) => !EXTERNAL_API_CAPABILITIES.has(c))) {
    throw new HttpError(400, "external_api solo admite las capabilities: reservas, leads");
  }
}

/**
 * Merge superficial sobre un campo JSON de Prisma.
 *
 * Superficial a propósito: el PATCH manda sólo las claves que cambian, así que las ausentes deben
 * sobrevivir. Un `update` a secas sustituiría el objeto entero y borraría lo que no viajó.
 */
function shallowMerge(
  current: Prisma.JsonValue | null,
  patch: Record<string, unknown>
): Prisma.InputJsonValue {
  // El cast final: `InputJsonValue` es un union recursivo que TypeScript no infiere desde un
  // `Record<string, unknown>` (no puede probar que los valores sean JSON). El contenido sí lo es
  // —viene de Zod o de la propia columna— así que el cast es correcto y era el mismo que hacía el
  // handler original (`as any` sobre `dbSchema`), sólo que acotado a un tipo real.
  return {
    ...(((current as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
    ...patch,
  } as Prisma.InputJsonValue;
}

/**
 * Construye el `data` del `update` de Prisma.
 *
 * Cada campo se incluye SÓLO si viajó en el PATCH (el patrón `...(x !== undefined ? {x} : {})`):
 * mandar `undefined` a Prisma no es lo mismo que no mandar la clave en un update parcial, y un
 * campo ausente nunca debe interpretarse como "ponlo a vacío".
 *
 * No toca `dbUrlEncrypted` ni llama a provisionar: eso vive en su propio endpoint.
 */
export function buildBackendUpdateData(
  backend: AgentDataBackend,
  data: UpdateBackendInput
): Prisma.AgentDataBackendUpdateInput {
  const dbSchemaMerge =
    data.businessId !== undefined || data.locationId !== undefined
      ? shallowMerge(backend.dbSchema, {
          ...(data.businessId !== undefined ? { businessId: data.businessId } : {}),
          ...(data.locationId !== undefined ? { locationId: data.locationId } : {}),
        })
      : undefined;

  return {
    ...(data.capabilities !== undefined ? { capabilities: data.capabilities } : {}),
    ...(data.notificationConfig !== undefined
      ? { notificationConfig: shallowMerge(backend.notificationConfig, data.notificationConfig) }
      : {}),
    ...(data.mode !== undefined ? { mode: data.mode } : {}),
    ...(data.apiBaseUrl !== undefined ? { apiBaseUrl: data.apiBaseUrl } : {}),
    // `apiKey` truthy, no `!== undefined`: "" significa "conserva la que hay", no "bórrala".
    ...(data.apiKey ? { apiKeyEncrypted: encryptToken(data.apiKey) } : {}),
    ...(dbSchemaMerge !== undefined ? { dbSchema: dbSchemaMerge } : {}),
  };
}

/**
 * Vista del backend que se devuelve al panel.
 *
 * NUNCA incluye `apiKeyEncrypted` ni `dbUrlEncrypted`: la key del cliente es write-only.
 *
 * `provisioned` (aa-managed-db-conexion-compartida F2): `managed_db` usa la conexión compartida de
 * la app y está listo al instante, sin aprovisionar nada; los demás modos siguen dependiendo de
 * que exista una URL cifrada.
 */
export function serializeBackend(backend: AgentDataBackend) {
  return {
    mode: backend.mode,
    capabilities: backend.capabilities ?? [],
    notificationConfig: backend.notificationConfig ?? {},
    provisioned: backend.mode === "managed_db" ? true : Boolean(backend.dbUrlEncrypted),
  };
}
