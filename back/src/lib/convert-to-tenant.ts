import { prisma } from "@/lib/db";
import { withCodeRetry } from "@/lib/codes";
import type { Prisma, Tenant } from "@/lib/generated/prisma/client";
import type { TenantCreateInput } from "@/lib/generated/prisma/models";

/**
 * Señal de que la fuente (lead/contacto) ya fue convertida por otra petición
 * concurrente. Se lanza DENTRO de la transacción cuando `alreadyConvertedCheck`
 * detecta que otra request ya ganó la carrera; el caller la captura para
 * resolver al mismo contrato de "ya convertido" que expone el endpoint, sin
 * crear un tenant duplicado.
 */
export class AlreadyConvertedError extends Error {
  constructor() {
    super("already_converted");
    this.name = "AlreadyConvertedError";
  }
}

export interface ConvertSourceToTenantParams {
  /** Construye el payload de `tenant.create` (el código se resuelve dentro de la tx). */
  buildTenantData: (
    tx: Prisma.TransactionClient
  ) => Promise<TenantCreateInput> | TenantCreateInput;
  /** Vincula la fuente (lead/contacto) al tenant recién creado, en la misma tx. */
  linkSource: (tx: Prisma.TransactionClient, tenantId: string) => Promise<unknown>;
  /**
   * Re-chequeo DENTRO de la transacción, inmediatamente antes de crear el
   * tenant: cierra la ventana TOCTOU frente a conversiones concurrentes de la
   * misma fuente (dos requests que pasaron el chequeo previo a la tx antes de
   * que ninguna hubiera confirmado su commit). Si devuelve true, se lanza
   * AlreadyConvertedError y no se crea el tenant. Opcional: si no se provee,
   * no hay re-chequeo (comportamiento previo a este cambio).
   */
  alreadyConvertedCheck?: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

/**
 * Patrón común de conversión "fuente → tenant": código secuencial + create +
 * update atómicos dentro de una única transacción, con reintento de código
 * (`withCodeRetry`) envolviendo la transacción completa (ante carrera de
 * código P2002, se reintenta todo). Usado por convertToClientsHandler
 * (contacts.ts), convertirLeadHandler y convertirContactoHandler
 * (service-operator.ts) — antes triplicado.
 */
export async function convertSourceToTenant(
  params: ConvertSourceToTenantParams
): Promise<Tenant> {
  return withCodeRetry(() =>
    prisma.$transaction(async (tx) => {
      if (params.alreadyConvertedCheck && (await params.alreadyConvertedCheck(tx))) {
        throw new AlreadyConvertedError();
      }
      const tenant = await tx.tenant.create({ data: await params.buildTenantData(tx) });
      await params.linkSource(tx, tenant.id);
      return tenant;
    })
  );
}
