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

export const operatorChatRouter = Router();

/** Sesión del operador en el gateway (hilo compartido con Telegram). */
function operatorSessionKey(): string {
  return process.env.OPENCLAW_OPERATOR_SESSION_KEY || "agent:main:main";
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

/** Texto visible de un content string | array de bloques. */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = asRecord(block);
        return b && b.type === "text" && typeof b.text === "string" ? b.text : "";
      })
      .filter(Boolean)
      .join("\n");
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
    const result = await chatSend(operatorSessionKey(), text, clientMessageId);
    if (!result.ok) {
      throw new HttpError(502, "El gateway OpenClaw rechazó el envío", "OPENCLAW_RPC_FAILED");
    }
    // 202: la respuesta del agente llega asíncrona a la transcripción (polling).
    res.status(202).json({ accepted: true, clientMessageId });
  })
);
