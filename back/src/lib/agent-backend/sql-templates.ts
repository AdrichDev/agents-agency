/**
 * Plantillas SQL del adapter `managed_db` — aa-agent-backend-foundation F2
 * (T2.2). UNICA fuente de SQL del adapter.
 *
 * Reglas de seguridad (AC2 — "nada de SQL libre generado por LLM"):
 *  - Todas las queries son ESTATICAS y parametrizadas con placeholders `$n`.
 *  - El input del usuario/LLM viaja EXCLUSIVAMENTE en el array de valores
 *    bind de pg; jamas se concatena ni interpola en el texto SQL.
 *  - El objeto esta congelado (`Object.freeze`) y el adapter solo puede
 *    ejecutar claves de este mapa (tipado `SqlTemplateKey`), de modo que no
 *    existe ningun camino para ejecutar SQL arbitrario.
 *
 * Esquema: v1 usa el esquema ESTANDAR por vertical (design.md §E.2 resuelta:
 * `dbSchema` queda en `{}` y no hay mapeo por cliente). Las tablas replican
 * el motor de reservas interno (`prisma/schema.prisma` @@map): `servicio_agente`,
 * `horario_agente`, `rango_bloqueo`, `franja_horaria`, `cita`, `lead` (+ columna
 * `intencion`) y `pedido`. Ver DDL en `provisioning.ts`.
 */

export const SQL_TEMPLATES = Object.freeze({
  // ── capability: reservas ──────────────────────────────────────────────────
  /** $1 agenteId, $2 servicio (id o nombre, case-insensitive). */
  reservas_servicio: `SELECT "id", "nombre", "duracion" FROM "servicio_agente" WHERE "agente_id" = $1 AND "activo" = true AND ("id" = $2 OR lower("nombre") = lower($2)) LIMIT 1`,

  /** $1 agenteId. */
  reservas_horario: `SELECT "id", "zona_horaria", "horario" FROM "horario_agente" WHERE "agente_id" = $1 LIMIT 1`,

  /** $1 agenteId, $2 desde, $3 hasta. */
  reservas_bloqueos: `SELECT rb."fecha_inicio", rb."fecha_fin" FROM "rango_bloqueo" rb JOIN "horario_agente" h ON rb."horario_id" = h."id" WHERE h."agente_id" = $1 AND rb."fecha_fin" >= $2 AND rb."fecha_inicio" <= $3`,

  /** $1 agenteId, $2 servicioId, $3 desde, $4 hasta. */
  reservas_ocupadas: `SELECT f."inicio" FROM "franja_horaria" f JOIN "servicio_agente" s ON f."servicio_id" = s."id" WHERE s."agente_id" = $1 AND f."servicio_id" = $2 AND f."disponible" = false AND f."inicio" >= $3 AND f."inicio" <= $4`,

  /**
   * $1 franjaId, $2 servicioId, $3 inicio, $4 fin, $5 agenteId.
   * El unique (servicio_id, inicio) + ON CONFLICT DO NOTHING garantiza que dos
   * reservas concurrentes sobre el mismo slot no se dupliquen: la segunda no
   * devuelve fila y el adapter la rechaza.
   * agente_id obligatorio: la FK compuesta (servicio_id, agente_id) verifica que
   * la franja no se asocie a un servicio de otro agente; el WITH CHECK de RLS
   * garantiza que el valor sea el del rol en sesion (no falsificable).
   */
  reservas_insertar_franja: `INSERT INTO "franja_horaria" ("id", "servicio_id", "agente_id", "inicio", "fin", "disponible", "creado_en") VALUES ($1, $2, $5, $3, $4, false, CURRENT_TIMESTAMP) ON CONFLICT ("servicio_id", "inicio") DO NOTHING RETURNING "id"`,

  /** $1 citaId, $2 franjaId, $3 servicioId, $4 email, $5 telefono, $6 notas, $7 agenteId. */
  reservas_insertar_cita: `INSERT INTO "cita" ("id", "franja_id", "servicio_id", "agente_id", "email", "telefono", "notas", "estado", "creado_en", "actualizado_en") VALUES ($1, $2, $3, $7, $4, $5, $6, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING "id", "estado"`,

  /** $1 citaId, $2 agenteId (scoping: solo citas de servicios del agente). */
  reservas_cancelar_cita: `UPDATE "cita" SET "estado" = 'cancelled', "actualizado_en" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "estado" <> 'cancelled' AND "servicio_id" IN (SELECT "id" FROM "servicio_agente" WHERE "agente_id" = $2) RETURNING "franja_id"`,

  /** $1 franjaId. */
  reservas_liberar_franja: `UPDATE "franja_horaria" SET "disponible" = true WHERE "id" = $1`,

  // ── capability: leads ─────────────────────────────────────────────────────
  /** $1 leadId, $2 agenteId, $3 nombre, $4 email, $5 telefono, $6 consentimiento, $7 intencion. */
  leads_insertar: `INSERT INTO "lead" ("id", "agente_id", "nombre_cliente", "email", "telefono", "consentimiento", "estado", "intencion", "creado_en") VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, CURRENT_TIMESTAMP) RETURNING "id", "creado_en"`,

  // ── capability: pedidos ───────────────────────────────────────────────────
  /** $1 agenteId, $2 codigo de pedido. */
  pedidos_consultar: `SELECT "codigo", "estado", "detalle" FROM "pedido" WHERE "agente_id" = $1 AND "codigo" = $2 LIMIT 1`,
} as const);

export type SqlTemplateKey = keyof typeof SQL_TEMPLATES;
