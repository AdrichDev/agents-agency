/**
 * Módulo de consulta de estado de pedido.
 * Sin Prisma: recibe config descifrada + orderId, llama al endpoint genérico.
 */

import { safeFetch } from "@/lib/ssrf";
import { logger } from "@/lib/logger";

export interface OrderStatusConfig {
  url: string;
  apiKey?: string;
}

export interface OrderStatusResult {
  ok: boolean;
  raw?: unknown;
  error?: string;
}

/**
 * Consulta el endpoint externo de estado de pedido.
 * Devuelve la respuesta raw sin asumir formato. (R5-6)
 * Timeout de 8 segundos. (R5-3)
 */
export async function fetchOrderStatus(
  cfg: OrderStatusConfig,
  orderId: string
): Promise<OrderStatusResult> {
  try {
    const separator = cfg.url.includes("?") ? "&" : "?";
    const url = `${cfg.url}${separator}orderId=${encodeURIComponent(orderId)}`;

    const res = await safeFetch(url, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      timeoutMs: 8000,
      allowRedirects: false,
    });

    if (!res.ok) {
      logger.error(`[order-status] endpoint respondió ${res.status} para orderId=${orderId}`);
      return { ok: false, error: `El sistema de pedidos respondió ${res.status}` }; // R5-3
    }

    // Parseo raw: intenta JSON, si falla devuelve texto (R5-6)
    const raw = await res.json().catch(async () => res.text());
    return { ok: true, raw };
  } catch (e) {
    logger.error({ err: e }, "[order-status] fallo consultando endpoint:");
    return { ok: false, error: "No pude consultar el estado del pedido en este momento" }; // R5-3
  }
}
