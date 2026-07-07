/**
 * Proxy del chat del OPERADOR contra el gateway de OpenClaw (5.5a
 * aa-centro-mando-agenda-telegram). La conversación del operador vive en una
 * ÚNICA sesión del gateway (la misma que el hilo de Telegram, por defecto
 * `agent:main:main`); este proxy la expone al front autenticado sin que el
 * token del gateway (credencial de operador con poder total) llegue jamás al
 * browser.
 *
 * Montado bajo /api → protegido por el gate central de index.ts (NO está en
 * la allowlist de lib/public-routes.ts). A diferencia del resto de usos del
 * admin RPC (fail-soft/noop), aquí un gateway sin configurar es un error
 * visible: 503 con código claro — el usuario está mirando un chat que no
 * puede funcionar, no debe parecer vacío.
 */
import { Router } from "express";
import { z } from "zod";
import { asyncHandler, validate, HttpError } from "@/lib/http";
import { chatHistory, chatSend, isConfigured } from "@/lib/openclaw/admin-rpc";
import { sendMessage as tgSendMessage } from "@/lib/channels/telegram";
import { logger } from "@/lib/logger";

export const operatorChatRouter = Router();

/** Sesión del operador en el gateway (hilo compartido con Telegram). */
function operatorSessionKey(): string {
  return process.env.OPENCLAW_OPERATOR_SESSION_KEY || "agent:main:main";
}

/* ── Espejo del hilo del operador hacia el bot de Telegram ───────────────────
 * (5.5d aa-centro-mando-agenda-telegram / aa-espejo-movil-operador-telegram).
 *
 * Objetivo: cuando el operador escribe DESDE la web (AA/OperaOS), la
 * conversación ENTERA (su turno + la respuesta del asistente) debe verse en
 * Telegram, igual de completa que en el sentido inverso (Telegram→web, que ya
 * funciona nativo). El RPC admin-http-rpc de OpenClaw NO expone envío de
 * mensajes (solo channels.status/start/stop/logout) y `config.get` redacta el
 * token del bot — así que se llama DIRECTO a la Bot API con credenciales
 * propias de AA (mismo patrón que `service-telegram.ts`), no vía el gateway.
 *
 * Dedup (crítico): el espejo se dispara SOLO desde `POST /send` (turnos de
 * origen web). Los turnos que entran POR Telegram el gateway ya los entrega
 * nativo — nunca pasan por `/send`, así que este mecanismo no los toca y no
 * puede duplicarlos. No hace falta inspeccionar marcas `openclawDeliveryMirror`.
 *
 * Ambos lados (turno del operador y respuesta del asistente) salen del MISMO
 * bot, así que Telegram no puede atribuir remitentes distintos; se marca el
 * turno del operador con un emoji discreto (✍️) y la respuesta se envía en
 * limpio, tal cual la vería un usuario nativo de Telegram.
 *
 * Fail-soft en todo: si Telegram falla, nunca rompe la respuesta al operador
 * ni el polling normal de `/history`.
 */

/** Distintivo discreto del turno escrito por el operador (no la palabra "Operador"). */
const OPERATOR_TURN_MARK = "✍️";

function operatorTelegramCreds(): { token: string; chatId: number } | null {
  const token = process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null; // noop si no configurado, igual que isConfigured()
  return { token, chatId: Number(chatId) };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Espeja el turno escrito por el operador. Fail-soft. */
async function mirrorOperatorTurn(text: string): Promise<void> {
  const creds = operatorTelegramCreds();
  if (!creds) return;
  try {
    await tgSendMessage(creds.token, creds.chatId, `${OPERATOR_TURN_MARK} ${text}`);
  } catch (err) {
    logger.error({ err }, "[operator-chat] fallo espejo del turno del operador a Telegram:");
  }
}

/** Ids de los turnos assistant ya presentes (para detectar la respuesta NUEVA). */
async function snapshotAssistantIds(sessionKey: string): Promise<Set<string>> {
  try {
    const r = await chatHistory(sessionKey, { limit: 50 });
    if (!r.ok) return new Set();
    return new Set(
      normalizeTranscript(r.payload).filter((m) => m.role === "assistant").map((m) => m.id)
    );
  } catch {
    return new Set();
  }
}

/** Texto del assistant si el payload de chat.completions ya lo trae (OpenAI-compat). */
function assistantReplyFromSendPayload(payload: unknown): string | null {
  const rec = asRecord(payload);
  const choices = rec && Array.isArray(rec.choices) ? rec.choices : null;
  const first = choices && choices.length ? asRecord(choices[0]) : null;
  const message = first ? asRecord(first.message) : null;
  const content = message ? extractText(message.content) : "";
  return content.trim() ? content : null;
}

const MIRROR_POLL_ATTEMPTS = () => Number(process.env.OPENCLAW_OPERATOR_MIRROR_ATTEMPTS) || 20;
const MIRROR_POLL_DELAY_MS = () =>
  Number.isFinite(Number(process.env.OPENCLAW_OPERATOR_MIRROR_DELAY_MS))
    ? Number(process.env.OPENCLAW_OPERATOR_MIRROR_DELAY_MS)
    : 1500;

/**
 * Espeja a Telegram la respuesta del asistente a un turno de origen web.
 * `POST /send` devuelve 202 antes de que la respuesta exista; se sondea la
 * transcripción hasta detectar un turno assistant NUEVO (no presente en
 * `knownAssistantIds`) y se envía en limpio. Ejecutado en background sin
 * bloquear el 202. Fail-soft. Exportada para prueba directa.
 */
export async function mirrorAssistantReply(
  sessionKey: string,
  knownAssistantIds: Set<string>,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<void> {
  const creds = operatorTelegramCreds();
  if (!creds) return;
  const attempts = opts.attempts ?? MIRROR_POLL_ATTEMPTS();
  const delayMs = opts.delayMs ?? MIRROR_POLL_DELAY_MS();
  try {
    for (let i = 0; i < attempts; i++) {
      const r = await chatHistory(sessionKey, { limit: 50 });
      if (r.ok) {
        const fresh = normalizeTranscript(r.payload).filter(
          (m) => m.role === "assistant" && !knownAssistantIds.has(m.id)
        );
        if (fresh.length) {
          // El último assistant nuevo es la respuesta a este turno.
          await tgSendMessage(creds.token, creds.chatId, fresh[fresh.length - 1].text);
          return;
        }
      }
      if (i < attempts - 1) await sleep(delayMs);
    }
    logger.warn(
      "[operator-chat] espejo respuesta asistente: no apareció turno nuevo en el tiempo esperado"
    );
  } catch (err) {
    logger.error({ err }, "[operator-chat] fallo espejo de la respuesta del asistente a Telegram:");
  }
}

/** Envía a Telegram un texto de respuesta ya conocido. Fail-soft. */
async function mirrorAssistantText(text: string): Promise<void> {
  const creds = operatorTelegramCreds();
  if (!creds) return;
  try {
    await tgSendMessage(creds.token, creds.chatId, text);
  } catch (err) {
    logger.error({ err }, "[operator-chat] fallo espejo de la respuesta del asistente a Telegram:");
  }
}

function assertGatewayConfigured(): void {
  if (!isConfigured()) {
    throw new HttpError(
      503,
      "Gateway OpenClaw no configurado (OPENCLAW_ADMIN_URL/OPENCLAW_GATEWAY_TOKEN)",
      "OPENCLAW_UNCONFIGURED"
    );
  }
}

/* ── Normalización de la transcripción ──────────────────────────────────────
 * El payload de chat.history NO tiene contrato tipado estable, así que se
 * inspecciona defensivamente. Reglas de filtrado (qué se descarta y por qué):
 *
 *  1. Solo turnos con role "user" | "assistant". Fuera: entradas de
 *     herramienta (role tool/toolResult), system, y cualquier role desconocido.
 *  2. Espejos de entrega (delivery-mirror): registros que duplican un turno
 *     para reflejarlo hacia un canal (Telegram). Marcas reales confirmadas en
 *     vivo: campo `openclawDeliveryMirror` y `model: "delivery-mirror"`. Se
 *     mantienen las heurísticas previas (`type: "delivery"`, campo
 *     `deliveredTo`, o kind que contenga "delivery") como respaldo. Se
 *     descartan — el turno original ya está en el hilo.
 *  3. Turnos sin texto visible (p. ej. assistant con solo bloques tool_use,
 *     o adjuntos sin texto) — no hay nada que pintar en el front.
 *
 * Formas aceptadas:
 *  - Lista: payload.messages | payload.transcript | payload.entries |
 *    payload.history | payload (si ya es array).
 *  - Entrada: el mensaje puede venir envuelto en `entry.message` (formato
 *    JSONL de sesión) o plano.
 *  - content: string, o array de bloques [{ type: "text", text }, ...].
 *  - timestamp: entry.timestamp | createdAt | time | ts — epoch (ms o s) o
 *    string ISO → se normaliza a ISO; si no hay, null.
 */

export interface OperatorChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extrae la lista de entradas del payload crudo del gateway. */
function transcriptEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const rec = asRecord(payload);
  if (!rec) return [];
  for (const key of ["messages", "transcript", "entries", "history"]) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

/**
 * Directivas internas que el gateway antepone al texto del asistente para
 * indicarle al canal cómo entregarlo (p. ej. `[[audio_as_voice]]` le dice al
 * plugin de Telegram que convierta la respuesta a nota de voz). No son texto
 * de cara al operador — se filtran antes de mostrar en AA/OperaOS.
 */
function stripGatewayDirectives(text: string): string {
  return text.replace(/^\s*\[\[[a-z_]+\]\]\s*\n?/i, "");
}

/** Texto visible de un content string | array de bloques. */
function extractText(content: unknown): string {
  if (typeof content === "string") return stripGatewayDirectives(content);
  if (Array.isArray(content)) {
    return stripGatewayDirectives(
      content
        .map((block) => {
          const b = asRecord(block);
          return b && b.type === "text" && typeof b.text === "string" ? b.text : "";
        })
        .filter(Boolean)
        .join("\n")
    );
  }
  return "";
}

/** Epoch (ms o s) o string parseable → ISO; cualquier otra cosa → null. */
function normalizeCreatedAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heurística: epochs en segundos son < 1e12 (hasta el año ~33658).
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** true si la entrada es un espejo de entrega hacia un canal (regla 2). */
function isDeliveryMirror(raw: Record<string, unknown>, entry: Record<string, unknown>): boolean {
  if ("openclawDeliveryMirror" in entry || "openclawDeliveryMirror" in raw) return true;
  if (entry.model === "delivery-mirror" || raw.model === "delivery-mirror") return true;
  if (raw.type === "delivery" || entry.type === "delivery") return true;
  if ("deliveredTo" in entry || "deliveredTo" in raw) return true;
  const kind = entry.kind ?? raw.kind;
  return typeof kind === "string" && kind.includes("delivery");
}

/** Normaliza una entrada cruda a DTO; null si no es un turno pintable. */
function toOperatorChatMessage(rawValue: unknown, index: number): OperatorChatMessage | null {
  const raw = asRecord(rawValue);
  if (!raw) return null;
  // Desenvuelve el formato JSONL de sesión ({ type: "message", message: {...} }).
  const entry = asRecord(raw.message) ?? raw;

  const role = entry.role;
  if (role !== "user" && role !== "assistant") return null; // regla 1
  if (isDeliveryMirror(raw, entry)) return null; // regla 2

  const text = extractText(entry.content ?? entry.text);
  if (!text.trim()) return null; // regla 3

  const id = entry.id ?? raw.id ?? entry.messageId;
  const createdAt = normalizeCreatedAt(
    entry.timestamp ?? entry.createdAt ?? entry.time ?? entry.ts
  );
  return {
    // Fallback determinista por posición: el front lo usa solo como key.
    id: typeof id === "string" || typeof id === "number" ? String(id) : `entry-${index}`,
    role,
    text,
    createdAt,
  };
}

function normalizeTranscript(payload: unknown): OperatorChatMessage[] {
  return transcriptEntries(payload)
    .map(toOperatorChatMessage)
    .filter((m): m is OperatorChatMessage => m !== null);
}

/* ── Rutas ─────────────────────────────────────────────────────────────── */

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

operatorChatRouter.get(
  "/history",
  validate.query(historyQuerySchema),
  asyncHandler(async (req, res) => {
    assertGatewayConfigured();
    const { limit } = req.validatedQuery as z.infer<typeof historyQuerySchema>;
    const result = await chatHistory(operatorSessionKey(), { limit });
    if (!result.ok) {
      throw new HttpError(502, "El gateway OpenClaw no respondió al historial", "OPENCLAW_RPC_FAILED");
    }
    res.json({ messages: normalizeTranscript(result.payload) });
  })
);

const sendBodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  // Idempotencia extremo a extremo: el front genera el id, el gateway deduplica.
  clientMessageId: z.string().trim().min(1).max(128),
});

operatorChatRouter.post(
  "/send",
  validate.body(sendBodySchema),
  asyncHandler(async (req, res) => {
    assertGatewayConfigured();
    const { text, clientMessageId } = req.validatedBody as z.infer<typeof sendBodySchema>;
    const sessionKey = operatorSessionKey();
    const mirrorEnabled = operatorTelegramCreds() !== null;

    // Snapshot ANTES de enviar: fija los turnos assistant existentes para poder
    // detectar la respuesta nueva a este turno (solo si el espejo está activo).
    const priorAssistantIds = mirrorEnabled
      ? await snapshotAssistantIds(sessionKey)
      : new Set<string>();

    const result = await chatSend(sessionKey, text, clientMessageId);
    if (!result.ok) {
      throw new HttpError(502, "El gateway OpenClaw rechazó el envío", "OPENCLAW_RPC_FAILED");
    }

    // Espeja la conversación entera a Telegram (solo turnos de origen web).
    if (mirrorEnabled) {
      await mirrorOperatorTurn(text); // turno del operador — inmediato, fail-soft
      const direct = assistantReplyFromSendPayload(result.payload);
      if (direct) {
        void mirrorAssistantText(direct); // respuesta ya en el payload — sin sondeo
      } else {
        // La respuesta llega asíncrona: sondeo en background, sin bloquear el 202.
        void mirrorAssistantReply(sessionKey, priorAssistantIds);
      }
    }

    // 202: la respuesta del agente llega asíncrona a la transcripción (polling).
    res.status(202).json({ accepted: true, clientMessageId });
  })
);
