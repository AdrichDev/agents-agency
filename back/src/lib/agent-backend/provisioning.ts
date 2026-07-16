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
 */
export function buildLeastPrivilegeProvisioningSql(agentId: string, password: string): string[] {
  const role = buildAgentDbRoleName(agentId);
  if (!PASSWORD_RE.test(password)) {
    throw new Error(
      "Password de rol invalida: usar generateAgentDbPassword() (16-128 chars [A-Za-z0-9_-])"
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
  return statements;
}

/**
 * DDL del esquema ESTANDAR por vertical (v1, design.md §E.2: sin mapeo por
 * cliente — `AgentDataBackend.dbSchema` queda `{}`). Replica las tablas del
 * motor de reservas interno (`prisma/schema.prisma` @@map) para que
 * `generateSlots` y las plantillas de `sql-templates.ts` operen sin traduccion,
 * mas `lead.intencion` y la tabla `pedido` (vertical pedidos).
 * Lo ejecuta el OWNER al aprovisionar; es idempotente (IF NOT EXISTS).
 */
export const STANDARD_SCHEMA_DDL: readonly string[] = Object.freeze([
  `CREATE TABLE IF NOT EXISTS "servicio_agente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "duracion" INTEGER NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_agente_agente_id_nombre_key" UNIQUE ("agente_id", "nombre")
  )`,
  `CREATE TABLE IF NOT EXISTS "horario_agente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agente_id" TEXT NOT NULL UNIQUE,
    "zona_horaria" TEXT NOT NULL DEFAULT 'Europe/Madrid',
    "horario" JSONB NOT NULL DEFAULT '{}',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "rango_bloqueo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "horario_id" TEXT NOT NULL REFERENCES "horario_agente"("id") ON DELETE CASCADE,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "franja_horaria" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "servicio_id" TEXT NOT NULL REFERENCES "servicio_agente"("id") ON DELETE CASCADE,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "disponible" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "franja_horaria_servicio_id_inicio_key" UNIQUE ("servicio_id", "inicio")
  )`,
  `CREATE TABLE IF NOT EXISTS "cita" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "franja_id" TEXT NOT NULL UNIQUE REFERENCES "franja_horaria"("id") ON DELETE RESTRICT,
    "servicio_id" TEXT NOT NULL REFERENCES "servicio_agente"("id") ON DELETE RESTRICT,
    "email" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'scheduled',
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
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
