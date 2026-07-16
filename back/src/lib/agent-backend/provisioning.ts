/**
 * Provisionamiento de la BD gestionada (`managed_db`) — F2 T2.4.
 *
 * ## Patron de credenciales (documentado, AC2 + riesgo design.md)
 *
 * 1. Al aprovisionar, el operador (rol OWNER, solo en el proceso de alta)
 *    ejecuta `STANDARD_SCHEMA_DDL` y despues los statements de
 *    `buildLeastPrivilegeProvisioningSql(agentId, password)`.
 * 2. La connection string que se persiste en `AgentDataBackend.dbUrlEncrypted`
 *    es SIEMPRE la del rol de minimo privilegio (`agente_bot_*`), NUNCA la del
 *    owner/service-role.
 * 3. Se cifra con `encryptToken()` (`back/src/lib/integrations/oauth.ts`):
 *    AES-256-GCM via `@/lib/crypto` con clave `CHANNEL_ENCRYPTION_KEY`,
 *    envuelta con prefijo `enc:v1:` — mismo mecanismo que los tokens OAuth.
 * 4. Solo `resolveAgentBackendAdapter` (`managed-db.ts`) descifra la URL, justo
 *    antes de abrir el pool. El texto plano no se loguea ni se devuelve por API.
 *
 * ## Minimo privilegio
 *
 * El rol del agente solo puede operar las tablas del esquema estandar y solo
 * con las operaciones que sus capabilities necesitan (`AGENT_ROLE_GRANTS`).
 * Sin DELETE, sin TRUNCATE, sin DDL, sin acceso a otras tablas, sin crear
 * roles ni BDs, sin bypass de RLS.
 *
 * ## Aislamiento por RLS (hardening: tablas compartidas entre agentes)
 *
 * Las tablas estandar son COMPARTIDAS entre todos los agentes de la BD
 * gestionada, por lo que los grants por tabla no bastan: sin RLS cualquier
 * rol `agente_bot_*` podria leer/escribir filas de otro agente. El DDL
 * estandar habilita `ENABLE` + `FORCE ROW LEVEL SECURITY` en cada tabla con
 * dos policies permisivas (se combinan con OR):
 *
 *  1. `<tabla>_rls_owner`: acceso total para roles NO-agente (owner/admin),
 *     identificados porque `session_user` no empieza por `agente_bot_`.
 *     Un rol de agente no puede salirse del prefijo: no puede renombrarse
 *     (NOCREATEROLE), no tiene membresias para `SET ROLE` y
 *     `SET SESSION AUTHORIZATION` es solo-superuser.
 *  2. `<tabla>_rls_agente`: `agente_id = (SELECT public.rls_agente_actual())`
 *     en USING y WITH CHECK.
 *
 * ### Por que el atado rol→agente NO es falsificable
 *
 *  - El `agente_id` efectivo se deriva EXCLUSIVAMENTE de `session_user` (el
 *    rol de login) via la tabla-mapa `agente_rol_map`, que es propiedad del
 *    OWNER y sobre la que el rol de agente no tiene NINGUN grant (ni SELECT).
 *  - `rls_agente_actual()` es `SECURITY DEFINER` (owner) con
 *    `search_path = ''` y nombres cualificados: el agente puede ejecutarla
 *    pero no redefinirla (sin CREATE en el schema, no es owner) ni desviarla
 *    con objetos sombra en `pg_temp`.
 *  - Se usa `session_user` y NO `current_user` (dentro de SECURITY DEFINER
 *    seria el definer) y NO `current_setting()`/variables de sesion (un `SET`
 *    del propio agente las falsificaria). `session_user` solo cambia con
 *    `SET SESSION AUTHORIZATION` (superuser); el rol es NOSUPERUSER.
 *  - Rol de agente sin fila en el mapa → la funcion devuelve NULL → policy
 *    nunca-true → CERO filas visibles/escribibles (fail-closed).
 *  - `FORCE ROW LEVEL SECURITY` cubre tambien al owner de las tablas (que
 *    pasa por la policy 1, no por bypass implicito).
 *
 * Ademas, `rango_bloqueo`/`franja_horaria`/`cita` llevan `agente_id` NOT NULL
 * con FK COMPUESTA `(fk, agente_id)` hacia su padre: un agente no puede colgar
 * filas propias de un `servicio/horario/franja` de otro agente aunque conozca
 * sus ids (el WITH CHECK fija su `agente_id`; la FK exige que el padre tenga
 * ese mismo `agente_id`).
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { encryptToken } from "@/lib/integrations/oauth";

/** Prefijo del rol Postgres por agente. */
export const AGENT_DB_ROLE_PREFIX = "agente_bot_";

// Identificador SQL seguro: minusculas/underscore, sin comillas ni espacios.
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;
// Password segura para inyectar en CREATE ROLE (charset sin comillas/escapes).
const PASSWORD_RE = /^[A-Za-z0-9_-]{16,128}$/;
// AgentId como valor literal SQL: sin comillas simples ni caracteres de escape.
const AGENT_ID_VALUE_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Matriz de privilegios del rol del agente — unica fuente de verdad.
 * Lectura de catalogo/horarios; escritura SOLO en franjas, citas y leads.
 */
export const AGENT_ROLE_GRANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  servicio_agente: Object.freeze(["SELECT"]),
  horario_agente: Object.freeze(["SELECT"]),
  rango_bloqueo: Object.freeze(["SELECT"]),
  franja_horaria: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  cita: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  lead: Object.freeze(["SELECT", "INSERT"]),
  pedido: Object.freeze(["SELECT"]),
});

/**
 * Deriva el nombre de rol Postgres del agente. Sanitiza a [a-z0-9] y valida
 * contra IDENTIFIER_RE — un agentId manipulado no puede inyectar SQL en DDL.
 */
export function buildAgentDbRoleName(agentId: string): string {
  const suffix = agentId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 32);
  if (!suffix) throw new Error("agentId invalido para derivar rol de BD");
  const role = `${AGENT_DB_ROLE_PREFIX}${suffix}`;
  if (!IDENTIFIER_RE.test(role)) {
    throw new Error(`Nombre de rol derivado invalido: ${role}`);
  }
  return role;
}

/** Genera una password aleatoria con charset seguro para el DDL de CREATE ROLE. */
export function generateAgentDbPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Statements de provisionamiento del rol de minimo privilegio del agente.
 * Los ejecuta el OWNER una sola vez al dar de alta el backend gestionado.
 * Tanto el rol como la password se validan contra charsets cerrados antes de
 * interpolarse (el DDL de Postgres no admite placeholders bind).
 * Al final se inserta el mapeo rol→agente en `agente_rol_map` (upsert
 * idempotente). El agente no tiene ningun grant sobre esa tabla.
 */
export function buildLeastPrivilegeProvisioningSql(agentId: string, password: string): string[] {
  const role = buildAgentDbRoleName(agentId);
  if (!PASSWORD_RE.test(password)) {
    throw new Error(
      "Password de rol invalida: usar generateAgentDbPassword() (16-128 chars [A-Za-z0-9_-])"
    );
  }
  if (!AGENT_ID_VALUE_RE.test(agentId)) {
    throw new Error(
      `agentId no es seguro como literal SQL (charset [A-Za-z0-9_-], max 128 chars): ${agentId}`
    );
  }
  const statements: string[] = [
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    // Partir de cero: sin privilegios heredados de PUBLIC u otros defaults.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}"`,
  ];
  for (const [table, ops] of Object.entries(AGENT_ROLE_GRANTS)) {
    statements.push(`GRANT ${ops.join(", ")} ON "${table}" TO "${role}"`);
  }
  // Registra el atado rol→agente; el agente no puede leer ni modificar esta tabla.
  // Upsert idempotente: re-aprovisionar actualiza el agente_id si cambiara.
  statements.push(
    `INSERT INTO "agente_rol_map" ("rol_login", "agente_id") VALUES ('${role}', '${agentId}') ON CONFLICT ("rol_login") DO UPDATE SET "agente_id" = EXCLUDED."agente_id"`
  );
  return statements;
}

/**
 * DDL del esquema ESTANDAR por vertical (v1, design.md §E.2: sin mapeo por
 * cliente — `AgentDataBackend.dbSchema` queda `{}`). Replica las tablas del
 * motor de reservas interno (`prisma/schema.prisma` @@map) para que
 * `generateSlots` y las plantillas de `sql-templates.ts` operen sin traduccion,
 * mas `lead.intencion` y la tabla `pedido` (vertical pedidos).
 * Lo ejecuta el OWNER al aprovisionar; es idempotente (IF NOT EXISTS).
 *
 * Hardening RLS incluido (ver docblock del modulo):
 *  - rango_bloqueo / franja_horaria / cita llevan `agente_id NOT NULL` +
 *    FKs COMPUESTAS para impedir asociar filas propias a padres de otro agente.
 *  - `agente_rol_map`: mapeo rol→agente, solo OWNER puede leer/escribir.
 *  - `rls_agente_actual()`: SECURITY DEFINER, resuelve el agentId del session_user.
 *  - ENABLE + FORCE ROW LEVEL SECURITY en las 7 tablas de negocio.
 *  - Dos policies permisivas (OR-combinadas) por tabla: owner + agente.
 */
export const STANDARD_SCHEMA_DDL: readonly string[] = Object.freeze([
  // ── 1. Tablas de negocio ───────────────────────────────────────────────────
  // servicio_agente: UNIQUE(id, agente_id) requerido para FKs compuestas desde franja_horaria.
  `CREATE TABLE IF NOT EXISTS "servicio_agente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "duracion" INTEGER NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_agente_agente_id_nombre_key" UNIQUE ("agente_id", "nombre"),
    CONSTRAINT "servicio_agente_id_agente_id_key" UNIQUE ("id", "agente_id")
  )`,
  // horario_agente: UNIQUE(id, agente_id) requerido para FKs compuestas desde rango_bloqueo.
  `CREATE TABLE IF NOT EXISTS "horario_agente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL UNIQUE,
    "zona_horaria" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "horario" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "horario_agente_id_agente_id_key" UNIQUE ("id", "agente_id")
  )`,
  // rango_bloqueo: agente_id NOT NULL + FK compuesta → horario_agente(id, agente_id).
  // Impide asociar un bloqueo a un horario que no pertenece al mismo agente.
  `CREATE TABLE IF NOT EXISTS "rango_bloqueo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horario_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rango_bloqueo_horario_id_agente_id_fkey"
      FOREIGN KEY ("horario_id", "agente_id") REFERENCES "horario_agente"("id", "agente_id") ON DELETE CASCADE
  )`,
  // franja_horaria: agente_id NOT NULL + FK compuesta → servicio_agente(id, agente_id).
  // UNIQUE(id, agente_id) requerido para FK compuesta desde cita.
  `CREATE TABLE IF NOT EXISTS "franja_horaria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "servicio_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "franja_horaria_servicio_id_inicio_key" UNIQUE ("servicio_id", "inicio"),
    CONSTRAINT "franja_horaria_id_agente_id_key" UNIQUE ("id", "agente_id"),
    CONSTRAINT "franja_horaria_servicio_id_agente_id_fkey"
      FOREIGN KEY ("servicio_id", "agente_id") REFERENCES "servicio_agente"("id", "agente_id") ON DELETE CASCADE
  )`,
  // cita: agente_id NOT NULL + FK compuesta → franja_horaria(id, agente_id).
  // Un agente no puede colgar una cita en una franja de otro agente aunque conozca su id.
  `CREATE TABLE IF NOT EXISTS "cita" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "franja_id" TEXT NOT NULL UNIQUE,
    "servicio_id" TEXT NOT NULL REFERENCES "servicio_agente"("id") ON DELETE RESTRICT,
    "agente_id" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'scheduled',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cita_franja_id_agente_id_fkey"
      FOREIGN KEY ("franja_id", "agente_id") REFERENCES "franja_horaria"("id", "agente_id") ON DELETE RESTRICT
  )`,
  `CREATE TABLE IF NOT EXISTS "lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL,
    "nombre_cliente" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "consentimiento" BOOLEAN NOT NULL DEFAULT false,
    "estado" TEXT NOT NULL DEFAULT 'new',
    "intencion" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "pedido" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "detalle" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pedido_agente_id_codigo_key" UNIQUE ("agente_id", "codigo")
  )`,
  // ── 2. Tabla de mapeo rol→agente (solo OWNER; el agente no tiene ningun grant) ──
  `CREATE TABLE IF NOT EXISTS "agente_rol_map" (
    "rol_login" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL
  )`,
  // ── 3. Funcion SECURITY DEFINER (debe existir ANTES de las policies) ────────
  // Devuelve el agente_id asociado al session_user consultando agente_rol_map.
  // SECURITY DEFINER + SET search_path = '': el agente puede ejecutarla pero
  // no redefinirla ni desviarla con objetos sombra en pg_temp.
  // Se usa session_user (no current_user ni current_setting) para impedir
  // falsificacion desde dentro de la sesion del agente.
  `CREATE OR REPLACE FUNCTION public.rls_agente_actual()
  RETURNS TEXT
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = ''
AS $$
  SELECT agente_id FROM public.agente_rol_map WHERE rol_login = session_user
$$`,
  // Permite que las expresiones de policy (evaluadas por el motor PG) invoquen
  // la funcion. El agente no puede redefinirla (no es dueno, sin CREATE en schema).
  `GRANT EXECUTE ON FUNCTION public.rls_agente_actual() TO PUBLIC`,
  // ── 4. RLS por tabla: ENABLE + FORCE + 2 policies permisivas (OR-combinadas) ─
  // Policy owner: acceso total para roles que NO son agente_bot_* (owner/admin).
  // Policy agente: acceso solo a filas con agente_id del rol en sesion.
  // DROP POLICY IF EXISTS hace el bloque idempotente ante re-ejecuciones.
  // servicio_agente
  `ALTER TABLE "servicio_agente" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "servicio_agente" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "servicio_agente_rls_owner" ON "servicio_agente"`,
  `CREATE POLICY "servicio_agente_rls_owner" ON "servicio_agente"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "servicio_agente_rls_agente" ON "servicio_agente"`,
  `CREATE POLICY "servicio_agente_rls_agente" ON "servicio_agente"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // horario_agente
  `ALTER TABLE "horario_agente" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "horario_agente" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "horario_agente_rls_owner" ON "horario_agente"`,
  `CREATE POLICY "horario_agente_rls_owner" ON "horario_agente"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "horario_agente_rls_agente" ON "horario_agente"`,
  `CREATE POLICY "horario_agente_rls_agente" ON "horario_agente"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // rango_bloqueo
  `ALTER TABLE "rango_bloqueo" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "rango_bloqueo" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "rango_bloqueo_rls_owner" ON "rango_bloqueo"`,
  `CREATE POLICY "rango_bloqueo_rls_owner" ON "rango_bloqueo"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "rango_bloqueo_rls_agente" ON "rango_bloqueo"`,
  `CREATE POLICY "rango_bloqueo_rls_agente" ON "rango_bloqueo"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // franja_horaria
  `ALTER TABLE "franja_horaria" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "franja_horaria" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "franja_horaria_rls_owner" ON "franja_horaria"`,
  `CREATE POLICY "franja_horaria_rls_owner" ON "franja_horaria"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "franja_horaria_rls_agente" ON "franja_horaria"`,
  `CREATE POLICY "franja_horaria_rls_agente" ON "franja_horaria"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // cita
  `ALTER TABLE "cita" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "cita" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "cita_rls_owner" ON "cita"`,
  `CREATE POLICY "cita_rls_owner" ON "cita"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "cita_rls_agente" ON "cita"`,
  `CREATE POLICY "cita_rls_agente" ON "cita"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // lead
  `ALTER TABLE "lead" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "lead" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "lead_rls_owner" ON "lead"`,
  `CREATE POLICY "lead_rls_owner" ON "lead"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "lead_rls_agente" ON "lead"`,
  `CREATE POLICY "lead_rls_agente" ON "lead"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
  // pedido
  `ALTER TABLE "pedido" ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE "pedido" FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS "pedido_rls_owner" ON "pedido"`,
  `CREATE POLICY "pedido_rls_owner" ON "pedido"
    FOR ALL
    USING (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')
    WITH CHECK (session_user NOT LIKE 'agente!_bot!_%' ESCAPE '!')`,
  `DROP POLICY IF EXISTS "pedido_rls_agente" ON "pedido"`,
  `CREATE POLICY "pedido_rls_agente" ON "pedido"
    FOR ALL
    USING (agente_id = (SELECT public.rls_agente_actual()))
    WITH CHECK (agente_id = (SELECT public.rls_agente_actual()))`,
]);

/* ------------------------------------------------------------------------- */
/* Aprovisionamiento ejecutable (F5, T5.1)                                    */
/* ------------------------------------------------------------------------- */

/**
 * Rotación de password si el rol ya existe (re-aprovisionar es idempotente:
 * CREATE ROLE fallaría con duplicate_object y en su lugar se resetea la clave).
 */
export function buildRolePasswordResetSql(agentId: string, password: string): string {
  const role = buildAgentDbRoleName(agentId);
  if (!PASSWORD_RE.test(password)) {
    throw new Error(
      "Password de rol invalida: usar generateAgentDbPassword() (16-128 chars [A-Za-z0-9_-])"
    );
  }
  return `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${password}'`;
}

/**
 * Deriva la connection string del AGENTE a partir de la del owner: mismo
 * host/puerto/BD, credenciales del rol de mínimo privilegio.
 */
export function buildAgentDbUrl(adminDbUrl: string, agentId: string, password: string): string {
  const url = new URL(adminDbUrl);
  url.username = buildAgentDbRoleName(agentId);
  url.password = password;
  return url.toString();
}

/** Ejecutor SQL del OWNER, inyectable en tests (sin BD real). */
export type OwnerSqlExecutor = (sql: string) => Promise<unknown>;

export interface ProvisionManagedDbResult {
  status: "provisioned" | "already_provisioned" | "unavailable" | "invalid_mode";
  reason?: string;
}

/**
 * Aprovisiona la BD gestionada de un agente `managed_db` (disparado desde la
 * tab "Datos del negocio" del panel — en creación `dbUrlEncrypted` queda null):
 *  1. DDL del esquema estándar (idempotente).
 *  2. Rol de mínimo privilegio + grants (rol existente → rotación de password).
 *  3. Persiste en `AgentDataBackend.dbUrlEncrypted` la connection string del
 *     ROL DEL AGENTE cifrada con encryptToken (patrón OAuth `enc:v1:`).
 *
 * Requiere `AGENT_BACKEND_ADMIN_DB_URL` (owner de la BD gestionada). Sin ella
 * devuelve `unavailable` con el paso manual documentado — NUNCA aprovisiona a
 * medias ni usa la BD de la plataforma como fallback silencioso.
 */
export async function provisionManagedDbBackend(
  agentId: string,
  opts?: { executor?: OwnerSqlExecutor; adminDbUrl?: string }
): Promise<ProvisionManagedDbResult> {
  const backend = await prisma.agentDataBackend.findUnique({ where: { agentId } });
  if (!backend || backend.mode !== "managed_db") {
    return { status: "invalid_mode", reason: "El agente no tiene backend managed_db" };
  }
  if (backend.dbUrlEncrypted) {
    return { status: "already_provisioned" };
  }

  const adminDbUrl = opts?.adminDbUrl ?? process.env.AGENT_BACKEND_ADMIN_DB_URL;
  if (!adminDbUrl && !opts?.executor) {
    return {
      status: "unavailable",
      reason:
        "AGENT_BACKEND_ADMIN_DB_URL no configurada. Paso manual: crear la BD gestionada, " +
        "definir la env y volver a pulsar Aprovisionar (ver tasks.md F5).",
    };
  }

  // Ejecutor real: pool pg efímero con la URL del owner (solo durante el alta).
  let ownerPoolEnd: (() => Promise<void>) | null = null;
  let executor = opts?.executor;
  if (!executor) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: adminDbUrl, max: 1 });
    ownerPoolEnd = () => pool.end();
    executor = (sql: string) => pool.query(sql);
  }

  try {
    for (const ddl of STANDARD_SCHEMA_DDL) await executor(ddl);

    const password = generateAgentDbPassword();
    const [createRole, ...grants] = buildLeastPrivilegeProvisioningSql(agentId, password);
    try {
      await executor(createRole);
    } catch (err: unknown) {
      // 42710 duplicate_object: el rol ya existe (re-aprovisionamiento) → rotar password.
      const code = (err as { code?: string })?.code;
      if (code !== "42710") throw err;
      await executor(buildRolePasswordResetSql(agentId, password));
    }
    for (const grant of grants) await executor(grant);

    const agentDbUrl = buildAgentDbUrl(adminDbUrl ?? "postgres://managed-db/agentes", agentId, password);
    await prisma.agentDataBackend.update({
      where: { agentId },
      data: { dbUrlEncrypted: encryptToken(agentDbUrl) },
    });
    return { status: "provisioned" };
  } catch (err: unknown) {
    logger.error({ err, agentId }, "[agent-backend] provisioning failed:");
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.message : "Error de aprovisionamiento",
    };
  } finally {
    await ownerPoolEnd?.().catch(() => {});
  }
}
