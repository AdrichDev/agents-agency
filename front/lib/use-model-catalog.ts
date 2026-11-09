"use client";

/**
 * S7 (model-catalog) — el catálogo del selector, leído de `GET /api/models`.
 *
 * Antes de este hook, `front/lib/models.ts` era una lista escrita a mano que alguien tenía que
 * acordarse de sincronizar con el back. La fuente es ahora el catálogo del back (que lo lee de
 * pi.dev y lo cruza con lo que cada proveedor sirve); la lista estática sobrevive SÓLO como
 * respaldo si la llamada falla.
 *
 * Dos detalles deliberados, y los dos son sobre no romper el panel:
 *
 *  - El primer render usa el respaldo estático, no una lista vacía. `fetch` no ocurre en el
 *    render, así que cualquier otro diseño pintaría un `<select>` vacío durante un instante y,
 *    con el modelo del agente ya elegido, el navegador mostraría la primera opción como
 *    seleccionada — un cambio de modelo que nadie pidió.
 *  - Toda la lógica (pedir, validar la forma, caer al respaldo) vive en `loadModelCatalog`, que es
 *    una función pura de la respuesta y se prueba sin React. Aquí sólo queda el cableado.
 *
 * La petición va por el cliente del panel (`lib/api`), así que lleva el token de la sesión
 * (`Authorization: Bearer`) igual que el resto de llamadas de `/api`: `/api/models` exige usuario
 * del panel o el token de servicio del CRM.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { LLM_PROVIDERS, loadModelCatalog, type ModelCatalog } from "@/lib/models";

export function useModelCatalog(): ModelCatalog {
  const [catalog, setCatalog] = useState<ModelCatalog>({
    providers: LLM_PROVIDERS,
    source: "static",
  });

  useEffect(() => {
    // `alive` evita el setState de un componente que ya se desmontó (y el aviso de React por
    // ello). La petición no se cancela: es idempotente y cacheable, y abortarla no ahorra nada.
    let alive = true;
    void loadModelCatalog((path) => api(path)).then((next) => {
      if (alive && next.source === "api") setCatalog(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return catalog;
}
