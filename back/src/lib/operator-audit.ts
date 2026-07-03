import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Auditoría del Operator Agent (F1 aa-operator-agent). Cada POST del router
// /service/operator escribe una fila aquí, tanto en éxito como en fallo. Es
// fire-and-forget: si el insert falla, solo se loguea; NUNCA rompe ni retrasa
// la respuesta HTTP al operador.
// ---------------------------------------------------------------------------

export interface OperatorAuditInput {
  /** Tool / acción ejecutada (agencia_crear_cliente, agencia_convertir_lead, ...). */
  accion: string;
  /** Cuerpo mínimo de la orden, sin tokens ni secretos. */
  payload?: unknown;
  /** Origen de la orden (telegram, widget, service-operator...). */
  origen: string;
  /** Resultado de la acción. */
  resultado: "ok" | "error";
  /** Id del recurso creado, motivo del error o nota opcional. */
  detalle?: string;
}

/**
 * Escribe una fila de auditoría. No devuelve promesa esperable ni lanza: el
 * llamador no debe (ni puede) bloquearse en la escritura de auditoría.
 */
export function writeOperatorAudit(input: OperatorAuditInput): void {
  prisma.operatorAudit
    .create({
      data: {
        accion: input.accion,
        payload: (input.payload ?? {}) as object,
        origen: input.origen,
        resultado: input.resultado,
        detalle: input.detalle ?? null,
      },
    })
    .catch((e: unknown) => logger.error({ err: e }, "[operator-audit] no se pudo escribir la auditoría:"));
}
