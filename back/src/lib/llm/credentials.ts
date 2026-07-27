import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encryptToken, decryptToken } from "@/lib/integrations/oauth";
import {
  createGovernedClient,
  PROVIDER_LABEL,
  type LlmProviderId,
} from "@/lib/llm/governance";

/**
 * Almacén de claves LLM propias del cliente (H2 aa-credenciales-byok-multiproveedor, T3).
 *
 * Regla que gobierna todo este fichero: **la clave en claro no sale de aquí hacia arriba salvo
 * por `getDecryptedApiKey`, que sólo consume el resolutor de cliente LLM en el back.** Todo lo
 * que va hacia una respuesta HTTP pasa por `listCredentialsPublic`, que hace un `select`
 * EXPLÍCITO sin `api_key`.
 *
 * Por qué `select` explícito y no `include`: un `include` se trae la columna, y entonces el leak
 * ocurre sin que nadie haya escrito la palabra `apiKey` en ninguna parte. Lo sostiene una prueba
 * que afirma que el claro no aparece en el cuerpo de ninguna respuesta de lectura — una aserción
 * sobre el JSON completo, no sobre el nombre del campo, porque es la que sobrevive a un `include`
 * añadido por descuido dentro de seis meses.
 *
 * El cifrado es el que ya está en producción guardando tokens OAuth de Google, Slack, Notion y
 * Jira (`encryptToken` / `decryptToken`, prefijo `enc:v1:`, AES-256-GCM con
 * `CHANNEL_ENCRYPTION_KEY`). No se escribe cifrado nuevo.
 */

/** Estados posibles de una credencial. Ver el comentario del modelo en `schema.prisma`. */
export type CredentialStatus = "connected" | "invalid" | "undecryptable";

/** Vista pública de una credencial: lo que SÍ puede salir hacia el front. */
export interface PublicCredential {
  provider: LlmProviderId;
  keyHint: string;
  status: string;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

/** Campos que la API puede devolver. `apiKey` NO está aquí, y es el punto de todo el fichero. */
const PUBLIC_SELECT = {
  provider: true,
  keyHint: true,
  status: true,
  lastVerifiedAt: true,
  lastError: true,
  updatedAt: true,
} as const;

/**
 * Proyección explícita campo a campo. El `select` de arriba ya deja `apiKey` fuera de la
 * consulta, así que esto es la SEGUNDA barrera, no la primera: un `include` añadido más
 * adelante arrastraría la columna sin que nadie escriba `apiKey`, y un `as PublicCredential`
 * la dejaría pasar al JSON sin que el compilador dijera nada (un cast no filtra campos de
 * sobra). Esta función sí: lo que no está aquí no sale.
 */
function toPublic(row: Record<string, unknown>): PublicCredential {
  return {
    provider: row.provider as LlmProviderId,
    keyHint: row.keyHint as string,
    status: row.status as string,
    lastVerifiedAt: (row.lastVerifiedAt as Date | null) ?? null,
    lastError: (row.lastError as string | null) ?? null,
    updatedAt: row.updatedAt as Date,
  };
}

/** Últimos 4 caracteres, para que un humano reconozca la clave sin poder usarla. */
function hintFor(apiKey: string): string {
  return apiKey.slice(-4);
}

/**
 * Quita el secreto de un texto que va a persistirse o loguearse.
 *
 * Dos redes, en este orden:
 *  1. Sustitución literal de la clave que se está verificando. Es la fiable: aquí se sabe
 *     exactamente qué cadena hay que ocultar, no hay que adivinarla.
 *  2. Patrón genérico de clave, por si el proveedor devuelve una forma distinta a la enviada
 *     (truncada, con otro prefijo, o la de otra cuenta).
 */
function redactSecret(text: string, apiKey: string): string {
  const mask = `***${hintFor(apiKey)}`;
  const literal = apiKey.length >= 8 ? text.split(apiKey).join(mask) : text;
  return literal.replace(/\b(sk|sk-proj|sk-ant|AIza)[A-Za-z0-9_-]{12,}/g, "***");
}

/** Credenciales de un tenant en su forma pública (sin la clave). */
export async function listCredentialsPublic(tenantId: string): Promise<PublicCredential[]> {
  const rows = await prisma.tenantLlmCredential.findMany({
    where: { tenantId },
    select: PUBLIC_SELECT,
    orderBy: { provider: "asc" },
  });
  return rows.map(toPublic);
}

/**
 * Verifica una clave contra su proveedor **sin gastar tokens**: `models.list()` demuestra lo
 * único que hay que demostrar, que la clave autentica.
 *
 * Se descartó una completion mínima: gastaría dinero del cliente para responder a una pregunta
 * de autenticación, y `max_tokens: 1` además revienta en modelos razonadores.
 */
export async function verifyApiKey(
  provider: LlmProviderId,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = createGovernedClient({ provider, apiKey });
    await client.models.list();
    return { ok: true };
  } catch (e) {
    // El mensaje del proveedor se propaga porque es información del cliente sobre su propia
    // clave, no un interno de la plataforma — pero REDACTADO: OpenAI responde literalmente
    // "Incorrect API key provided: sk-proj-...", y `lastError` es un campo público. Sin esta
    // línea el secreto sale por la vía de lectura con nombre de "error", y además queda escrito
    // en los logs de Render. Lo cazó la prueba de T3.3.
    const raw = e instanceof Error ? e.message : "Error desconocido al verificar la clave";
    const error = redactSecret(raw, apiKey);
    logger.warn({ provider, error }, "[llm-credentials] verificación fallida");
    return { ok: false, error };
  }
}

/**
 * Guarda (o reemplaza) la clave de un proveedor para un tenant, verificándola.
 *
 * Una clave inválida **se guarda igual**, marcada `invalid` con el motivo. Rechazar el guardado
 * perdería lo que el humano acaba de teclear por un fallo que puede ser de red. Lo que no se
 * hace es servir con ella: el resolutor corta por `status !== "connected"`.
 */
export async function upsertCredential(
  tenantId: string,
  provider: LlmProviderId,
  apiKey: string
): Promise<PublicCredential> {
  const verification = await verifyApiKey(provider, apiKey);
  const data = {
    apiKey: encryptToken(apiKey),
    keyHint: hintFor(apiKey),
    status: verification.ok ? "connected" : "invalid",
    lastVerifiedAt: verification.ok ? new Date() : null,
    lastError: verification.ok ? null : verification.error,
  };

  const row = await prisma.tenantLlmCredential.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    create: { tenantId, provider, ...data },
    update: data,
    select: PUBLIC_SELECT,
  });
  return toPublic(row);
}

/** Revuelve a verificar la clave ya guardada, sin que el humano la vuelva a teclear. */
export async function reverifyCredential(
  tenantId: string,
  provider: LlmProviderId
): Promise<PublicCredential | null> {
  const row = await prisma.tenantLlmCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { apiKey: true },
  });
  if (!row) return null;

  let plain: string;
  try {
    plain = decryptToken(row.apiKey);
  } catch {
    const updated = await prisma.tenantLlmCredential.update({
      where: { tenantId_provider: { tenantId, provider } },
      data: {
        status: "undecryptable",
        lastError: "No se pudo descifrar la clave guardada. Revisa CHANNEL_ENCRYPTION_KEY.",
      },
      select: PUBLIC_SELECT,
    });
    return toPublic(updated);
  }

  const verification = await verifyApiKey(provider, plain);
  const updated = await prisma.tenantLlmCredential.update({
    where: { tenantId_provider: { tenantId, provider } },
    data: {
      status: verification.ok ? "connected" : "invalid",
      lastVerifiedAt: verification.ok ? new Date() : null,
      lastError: verification.ok ? null : verification.error,
    },
    select: PUBLIC_SELECT,
  });
  return toPublic(updated);
}

export async function deleteCredential(
  tenantId: string,
  provider: LlmProviderId
): Promise<boolean> {
  const deleted = await prisma.tenantLlmCredential.deleteMany({
    where: { tenantId, provider },
  });
  return deleted.count > 0;
}

/** Motivo por el que una credencial no sirve. Distinguibles a propósito (design.md §B). */
export type CredentialFailure =
  | { kind: "missing" }
  | { kind: "not_connected"; status: string }
  | { kind: "undecryptable" };

export interface ResolvedCredential {
  apiKey: string;
  /** Cambia cuando la clave cambia: se usa como parte de la clave de caché de instancias. */
  updatedAt: Date;
}

/**
 * Devuelve la clave EN CLARO de un tenant para un proveedor, o el motivo por el que no se puede
 * usar. Único consumidor legítimo: el resolutor de cliente LLM (`lib/openai.ts`).
 *
 * Devuelve un motivo tipado en vez de lanzar porque quien llama tiene que poder traducirlo a un
 * mensaje distinto según el caso: "falta configurar la clave de X" no se arregla igual que "no
 * puedo descifrar lo que guardé".
 */
export async function getDecryptedApiKey(
  tenantId: string,
  provider: LlmProviderId
): Promise<{ ok: true; credential: ResolvedCredential } | { ok: false; failure: CredentialFailure }> {
  const row = await prisma.tenantLlmCredential.findUnique({
    where: { tenantId_provider: { tenantId, provider } },
    select: { apiKey: true, status: true, updatedAt: true },
  });
  if (!row) return { ok: false, failure: { kind: "missing" } };
  if (row.status !== "connected") {
    return { ok: false, failure: { kind: "not_connected", status: row.status } };
  }
  try {
    return { ok: true, credential: { apiKey: decryptToken(row.apiKey), updatedAt: row.updatedAt } };
  } catch {
    logger.error({ tenantId, provider }, "[llm-credentials] clave ilegible (¿CHANNEL_ENCRYPTION_KEY?)");
    return { ok: false, failure: { kind: "undecryptable" } };
  }
}

/** Mensaje de cara al cliente para cada motivo de fallo. Nunca revela la clave ni el interno. */
export function failureMessage(provider: LlmProviderId, failure: CredentialFailure): string {
  const label = PROVIDER_LABEL[provider];
  switch (failure.kind) {
    case "missing":
      return `Este asistente usa la clave propia del cliente y no hay ninguna clave de ${label} configurada. Contacta con el administrador.`;
    case "not_connected":
      return `La clave de ${label} de este cliente no está verificada (${failure.status}). Contacta con el administrador.`;
    case "undecryptable":
      return `No se pudo leer la clave de ${label} de este cliente. Contacta con el administrador.`;
  }
}
