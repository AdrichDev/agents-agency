import { randomBytes } from "node:crypto";
import { logger } from "@/lib/logger";
import { editMessageText, sendMessage, type TelegramReplyMarkup } from "@/lib/channels/telegram";

// ---------------------------------------------------------------------------
// Confirmación HUMANA de las escrituras del Operator Agent
// (odd/tasks/mcp-plataforma-read-surface, T8b, S4/S14; decisión del dueño: L24
// "En memoria, caducan en 10 minutos").
//
// Por qué existe: el protocolo anterior (`confirmado: true` en el body) lo podía
// cumplir el propio modelo — bastaba con que lo escribiera. Aquí la escritura
// queda EN ESPERA en este proceso, el resumen y los botones Confirmar/Cancelar
// los envía el BACKEND a Telegram (nunca el modelo), y sólo se ejecuta cuando una
// petición presenta el token secreto, caducado el plazo y sin usar antes.
//
// Propiedades que este módulo garantiza y que los tests fijan:
//   · token = crypto.randomBytes(24) en base64url (url-safe, 32 caracteres, muy
//     por debajo del límite de 64 bytes de `callback_data` de Telegram);
//   · un solo uso: `consumirPendiente` borra la entrada ANTES de devolverla, así
//     que un replay no puede ejecutar dos veces;
//   · caducidad de 10 minutos, purgada de forma perezosa;
//   · tamaño acotado: con el tope lleno no se aceptan más acciones (429);
//   · si no hay credenciales de Telegram o el envío falla, la acción NO se queda
//     pendiente (nadie podría confirmarla): se descarta y se responde 503;
//   · el token NUNCA se registra en los logs: sólo viaja al chat del operador
//     dentro de `callback_data`.
//
// S15 (petición textual del dueño, L28): el mensaje que lleva los botones es el
// que se reescribe al confirmar — "⏳ Creando contacto…" sin teclado, puntos en
// movimiento mientras la acción tarda, y "✅ Contacto creado" / "⚠️ …" / "❌ …"
// sin ids. Para eso se guarda el `message_id` que devuelve el envío.
//
// En memoria y por proceso: si el backend se reinicia, las acciones pendientes
// se pierden y el bot tiene que volver a pedirlas (coste aceptado, sin migración).
// ---------------------------------------------------------------------------

/** Vigencia de una acción pendiente: 10 minutos (L24). */
export const CONFIRMACION_TTL_MS = 10 * 60 * 1000;

/** Tope de acciones pendientes vivas en el proceso. */
export const CONFIRMACION_MAX_PENDIENTES = 50;

/** Bytes de entropía del token (>= 16 exigido; 24 → 32 caracteres base64url). */
const BYTES_TOKEN = 24;

/** Prefijos de `callback_data` que el gateway devuelve al agente como texto. */
const PREFIJO_CONFIRMAR = "confirmar:";
const PREFIJO_CANCELAR = "cancelar:";

/**
 * S15 (L28): el mensaje de los botones se convierte en el aviso de progreso.
 * Telegram no tiene animación nativa, así que los puntos en movimiento se
 * simulan editando el mismo mensaje: un paso cada 800 ms (Telegram tolera ~1
 * mensaje por segundo y chat) y como mucho un puñado de ediciones.
 */
export const PROGRESO_INTERVALO_MS = 800;
export const PROGRESO_MAX_PASOS = 4;

/** Textos fijos de la UX (sin ids y sin detalle técnico: los lee el humano). */
export const TEXTO_CANCELADA = "❌ Acción cancelada";
export const TEXTO_CADUCADA = "⌛ La confirmación caducó, pedí la acción de nuevo";

/** Mensaje de Telegram concreto que se puede reescribir (S15). */
export interface MensajeConfirmacion {
  chatId: number;
  messageId: number;
}

/**
 * Frases en castellano de cada acción (registro de las DOCE escrituras, en
 * routes/service-operator.ts). Sin ids y sin nombres técnicos: es lo único que
 * el dueño lee en el mensaje, así que no debe nombrar `agencia_*` ni ids.
 */
export interface FrasesAccion {
  /** Gerundio: "Creando contacto". */
  progresivo: string;
  /** Resultado: "Contacto creado". */
  completado: string;
  /** Frase breve para el aviso de fallo: "crear el contacto". */
  fallo: string;
}

/** Texto inicial y de cada paso de la animación ("⏳ Creando contacto…"). */
export function textoProgreso(frases: FrasesAccion): string {
  return `⏳ ${frases.progresivo}…`;
}

/** Texto de éxito ("✅ Contacto creado"). */
export function textoCompletado(frases: FrasesAccion): string {
  return `✅ ${frases.completado}`;
}

/** Texto de fallo de negocio, sin detalle técnico. */
export function textoFallo(frases: FrasesAccion): string {
  return `⚠️ No se pudo completar: ${frases.fallo}`;
}

/** Acción pendiente de confirmación humana. */
export interface PendienteOperador {
  /** Nombre de la acción (el mismo que usa la auditoría: agencia_crear_cliente...). */
  accion: string;
  /** Payload YA validado que se ejecutará al confirmar. */
  payload: Record<string, unknown>;
  /** Parámetros de ruta necesarios para ejecutar (p. ej. `id`). */
  params: Record<string, string>;
  /** Resumen en lenguaje humano que se envía al operador. */
  resumen: string;
  /** Origen de la orden (cabecera x-operator-origin), para la auditoría. */
  origen: string;
  /** Instante de caducidad (epoch ms). */
  expiraEn: number;
  /**
   * Mensaje de los botones (S15). Ausente si Telegram no devolvió `message_id`:
   * en ese caso la acción funciona igual, sólo que sin editar el mensaje.
   */
  mensaje?: MensajeConfirmacion;
}

/** Lo que hay que guardar para poder ejecutar la acción más tarde. */
export interface EntradaPendiente {
  accion: string;
  payload: Record<string, unknown>;
  params: Record<string, string>;
  resumen: string;
  origen: string;
}

export type ResultadoRegistro =
  | { ok: true; pendiente: PendienteOperador }
  | {
      ok: false;
      status: 429 | 503;
      code: string;
      mensaje: string;
      /** Motivo corto para la auditoría (sin token). */
      detalle: string;
    };

export type ResultadoConsumo =
  | { estado: "ok"; pendiente: PendienteOperador }
  | { estado: "caducado"; mensaje?: MensajeConfirmacion }
  | { estado: "desconocido" };

export type ResultadoDescarte =
  | { estado: "ok"; accion: string; mensaje?: MensajeConfirmacion }
  | { estado: "caducado"; mensaje?: MensajeConfirmacion }
  | { estado: "desconocido" };

const pendientes = new Map<string, PendienteOperador>();
let capPendientes = CONFIRMACION_MAX_PENDIENTES;

/** Sólo para tests: fija el tope de acciones pendientes del proceso actual. */
export function configurarCapPendientes(cap: number) {
  capPendientes = cap;
}

/** Sólo para tests: número de acciones pendientes vivas (introspección del store). */
export function tamanoPendientes() {
  return pendientes.size;
}

/** Sólo para tests: vacía el store y restaura el tope por defecto. */
export function resetConfirmacionesPendientes() {
  pendientes.clear();
  capPendientes = CONFIRMACION_MAX_PENDIENTES;
}

/** Credenciales del bot del operador (nombres de env; NUNCA se leen ficheros aquí). */
function credencialesOperador(): { token: string; chatId: number } | null {
  const token = process.env.OPENCLAW_OPERATOR_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OPENCLAW_OPERATOR_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  const id = Number(chatId);
  if (!Number.isFinite(id)) return null;
  return { token, chatId: id };
}

/** Borra las pendientes caducadas (purga perezosa: no hay temporizadores). */
function purgarExpirados(ahora = Date.now()) {
  for (const [token, pendiente] of pendientes) {
    if (pendiente.expiraEn <= ahora) pendientes.delete(token);
  }
}

/** Token nuevo, url-safe y suficientemente largo. */
function nuevoToken(): string {
  return randomBytes(BYTES_TOKEN).toString("base64url");
}

/** Texto que ve el humano en Telegram. */
export function mensajeConfirmacion(pendiente: Pick<PendienteOperador, "accion" | "resumen">): string {
  return [
    "🔐 Escritura pendiente de tu confirmación",
    "",
    pendiente.resumen,
    "",
    `Acción: ${pendiente.accion}`,
    "Caduca en 10 minutos. Pulsa Confirmar o Cancelar.",
  ].join("\n");
}

/**
 * Teclado inline con los dos botones. `callback_data` = prefijo + token: el
 * gateway lo reenvía al agente como texto y el agente llama al endpoint de
 * confirmación con ese token (OpenClaw no procesa el botón por su cuenta).
 */
export function tecladoConfirmacion(token: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✅ Confirmar", callback_data: `${PREFIJO_CONFIRMAR}${token}` },
        { text: "❌ Cancelar", callback_data: `${PREFIJO_CANCELAR}${token}` },
      ],
    ],
  };
}

/**
 * Registra la acción y se la presenta al humano por Telegram.
 *
 * Devuelve `ok:false` (429/503) cuando NO hay forma segura de continuar: tope de
 * pendientes alcanzado, credenciales del bot ausentes o envío fallido. En esos
 * casos no queda ninguna entrada viva y la escritura no se ha ejecutado.
 */
export async function registrarPendiente(entrada: EntradaPendiente): Promise<ResultadoRegistro> {
  const credenciales = credencialesOperador();
  if (!credenciales) {
    return {
      ok: false,
      status: 503,
      code: "confirmacion_no_disponible",
      mensaje:
        "No se puede pedir confirmación: el Telegram del operador no está configurado. La acción no se ha ejecutado.",
      detalle: "telegram_not_configured",
    };
  }

  purgarExpirados();
  if (pendientes.size >= capPendientes) {
    return {
      ok: false,
      status: 429,
      code: "confirmaciones_llenas",
      mensaje:
        "Hay demasiadas acciones esperando confirmación. Resuélvelas o espera a que caduquen. La acción no se ha ejecutado.",
      detalle: "confirmations_full",
    };
  }

  const token = nuevoToken();
  const pendiente: PendienteOperador = { ...entrada, expiraEn: Date.now() + CONFIRMACION_TTL_MS };
  pendientes.set(token, pendiente);

  try {
    const messageId = await sendMessage(credenciales.token, credenciales.chatId, mensajeConfirmacion(pendiente), {
      replyMarkup: tecladoConfirmacion(token),
    });
    // S15: se guarda el mensaje exacto para poder reescribirlo en el progreso.
    // Si Telegram no devuelve message_id se sigue igual, sin editar (limitación
    // conocida y declarada, nunca un fallo de la escritura).
    if (typeof messageId === "number") {
      pendiente.mensaje = { chatId: credenciales.chatId, messageId };
    }
  } catch (e) {
    // Nadie puede confirmar lo que no ha llegado: se descarta y se avisa.
    pendientes.delete(token);
    logger.error({ err: describirError(e) }, "[operator-confirmations] no se pudo enviar la confirmación por Telegram:");
    return {
      ok: false,
      status: 503,
      code: "confirmacion_no_disponible",
      mensaje:
        "No se pudo enviar la confirmación a Telegram. La acción no se ha ejecutado; vuelve a pedirla.",
      detalle: "telegram_send_failed",
    };
  }

  return { ok: true, pendiente };
}

/**
 * Consume la acción pendiente de un token. Un solo uso: la entrada se borra
 * ANTES de devolverla, así que un segundo intento (replay) ya no la encuentra.
 */
export function consumirPendiente(token: string): ResultadoConsumo {
  const pendiente = token ? pendientes.get(token) : undefined;
  if (!pendiente) return { estado: "desconocido" };
  pendientes.delete(token);
  if (pendiente.expiraEn <= Date.now()) return { estado: "caducado", mensaje: pendiente.mensaje };
  return { estado: "ok", pendiente };
}

/** Descarta la acción pendiente de un token (cancelación humana). */
export function descartarPendiente(token: string): ResultadoDescarte {
  const pendiente = token ? pendientes.get(token) : undefined;
  if (!pendiente) return { estado: "desconocido" };
  pendientes.delete(token);
  if (pendiente.expiraEn <= Date.now()) return { estado: "caducado", mensaje: pendiente.mensaje };
  return { estado: "ok", accion: pendiente.accion, mensaje: pendiente.mensaje };
}

/* ---------- Progreso en el PROPIO mensaje (S15) ---------- */

/**
 * Error describible SIN secretos: el token del bot viaja en la URL de la Bot
 * API, así que un mensaje de error de red podría arrastrarlo al log. Se
 * enmascara cualquier `123456:ABC...` antes de registrar nada.
 */
function describirError(e: unknown): string {
  const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return texto.replace(/\d{6,}:[A-Za-z0-9_-]{10,}/g, "[bot-token]");
}

/**
 * Reescribe el mensaje de la confirmación. NUNCA lanza y NUNCA puede cambiar la
 * respuesta HTTP de la acción: si Telegram falla se registra (sin token) y se
 * sigue. Sin `messageId` conocido no intenta nada.
 */
export async function editarMensajeConfirmacion(
  mensaje: MensajeConfirmacion | undefined,
  texto: string
): Promise<void> {
  if (!mensaje) return;
  const credenciales = credencialesOperador();
  if (!credenciales) return;
  try {
    await editMessageText(credenciales.token, mensaje.chatId, mensaje.messageId, texto);
  } catch (e) {
    logger.warn(
      { err: describirError(e) },
      "[operator-confirmations] no se pudo editar el mensaje de la confirmación (ignorado):"
    );
  }
}

/** Control de la animación de puntos. */
export interface ProgresoConfirmacion {
  /** Detiene el ciclo (no programa ni edita nada más). */
  detener: () => void;
  /** Detiene y deja el texto final en el mensaje. */
  finalizar: (texto: string) => Promise<void>;
}

/**
 * Anima el progreso mientras la acción se ejecuta: un punto más cada 800 ms
 * (".", "..", "..." y vuelta a empezar), con un tope duro de ediciones y sin
 * mantener vivo el proceso (`unref`).
 *
 * Las ediciones de la animación van ENCADENADAS y `finalizar` espera a la última
 * en vuelo: el texto final nunca queda pisado por un punto que llegue tarde.
 */
export function animarProgreso(
  mensaje: MensajeConfirmacion | undefined,
  frases: FrasesAccion | undefined
): ProgresoConfirmacion {
  let pasos = 0;
  let detenida = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enVuelo: Promise<void> = Promise.resolve();

  const programar = () => {
    if (detenida || !mensaje || !frases || pasos >= PROGRESO_MAX_PASOS) return;
    const t = setTimeout(() => {
      temporizador = null;
      if (detenida || !mensaje || !frases) return;
      const puntos = ".".repeat((pasos % 3) + 1);
      pasos += 1;
      enVuelo = enVuelo.then(() => editarMensajeConfirmacion(mensaje, `⏳ ${frases.progresivo}${puntos}`));
      programar();
    }, PROGRESO_INTERVALO_MS);
    // Una animación no debe mantener el proceso abierto.
    (t as { unref?: () => void }).unref?.();
    temporizador = t;
  };

  programar();

  return {
    detener() {
      detenida = true;
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
    },
    async finalizar(texto: string) {
      detenida = true;
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      await enVuelo;
      await editarMensajeConfirmacion(mensaje, texto);
    },
  };
}
