import { HttpError } from "@/lib/http";

/**
 * Traducción de un fallo del chat a lo que puede leer un visitante ANÓNIMO en la web de un
 * cliente.
 *
 * El problema que resuelve: `POST /api/chat` es público y su respuesta se pinta literalmente en
 * el sitio de un tercero. Devolver `e.message` filtraba el texto crudo del proveedor LLM
 * ("429 You exceeded your current quota…") y, peor, la condición comercial del cliente
 * ("hay un pago pendiente. Regulariza la suscripción") delante de sus propios clientes
 * potenciales.
 *
 * Diseño deliberado (§D2): DENY BY DEFAULT. El error de entrada sólo sirve para elegir fila de la
 * tabla; ni un carácter suyo viaja al visitante. Sanear el mensaje original con una lista negra
 * fallaría en silencio en cuanto el proveedor cambiase su texto.
 *
 * Lo que NO hace: cambiar el status. `channels/webhook-shared.ts` corta por `status === 402` y los
 * canales de mensajería siguen propagando el motivo real, que allí sí es correcto (decisión de H1).
 * Aquí cambia el texto, nunca el código.
 */
export type VisitorError = {
  status: number;
  /** Texto para el visitante. Siempre de la tabla, nunca del error original. */
  error: string;
  /** Motivo en forma de máquina. Conserva el diagnóstico para soporte sin filtrar la frase. */
  code: string;
};

const MSG_NO_DISPONIBLE = "Este asistente no está disponible en este momento.";
const MSG_INTERNO = "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.";
const MSG_PETICION = "No he podido procesar ese mensaje.";
const MSG_RITMO = "Estás enviando mensajes muy rápido. Espera un momento.";

/**
 * Tabla cerrada. Cupo agotado, impago y agente despublicado comparten frase a propósito: al
 * visitante le da igual cuál de los tres es —no puede actuar sobre ninguno— y cada matiz sería una
 * fuga. La distinción sobrevive en `code`.
 */
const TABLA: Record<number, { error: string; code: string }> = {
  400: { error: MSG_PETICION, code: "BAD_REQUEST" },
  402: { error: MSG_NO_DISPONIBLE, code: "SERVICE_LIMIT" },
  403: { error: MSG_NO_DISPONIBLE, code: "AGENT_UNAVAILABLE" },
  404: { error: MSG_NO_DISPONIBLE, code: "AGENT_NOT_FOUND" },
  429: { error: MSG_RITMO, code: "RATE_LIMITED" },
};

const OTROS_4XX = { error: MSG_NO_DISPONIBLE, code: "AGENT_UNAVAILABLE" };
const CUALQUIER_5XX = { error: MSG_INTERNO, code: "INTERNAL" };

/**
 * Textos prohibidos en cualquier fila de la tabla. Se exporta para que la prueba del invariante
 * (E7) recorra la política entera, y no una llamada concreta: una fila nueva mal redactada tiene
 * que ponerse roja sola.
 */
export const TERMINOS_PROHIBIDOS = [
  "openai",
  "gemini",
  "token",
  "cupo",
  "cuota",
  "pago",
  "suscripción",
  "clave",
  "tenant",
  "api key",
];

/** Filas de la tabla, para el invariante de E7. */
export function textosDeVisitante(): string[] {
  return [
    ...Object.values(TABLA).map((f) => f.error),
    OTROS_4XX.error,
    CUALQUIER_5XX.error,
  ];
}

/**
 * @param e error lanzado por el chat, de cualquier origen.
 * @returns qué contestar a un visitante anónimo. El status entrante se conserva.
 */
export function visitorError(e: unknown): VisitorError {
  // Sólo `HttpError` lleva un status pensado por nosotros. Un 429 del SDK de OpenAI trae su propio
  // `.status`, pero es el status del PROVEEDOR: reenviarlo diría que el visitante ha pasado de
  // ritmo cuando quien no tiene saldo somos nosotros. Todo lo que no sea nuestro es un 500.
  const status = e instanceof HttpError ? e.status : 500;
  if (status >= 500) return { status, ...CUALQUIER_5XX };
  const fila = TABLA[status] ?? OTROS_4XX;
  return { status, ...fila };
}
