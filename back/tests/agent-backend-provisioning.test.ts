/**
 * T5 (aa-agent-backend-foundation) — provisionManagedDbBackend (tab "Datos del
 * negocio" dispara aquí el aprovisionamiento que en creación quedó null):
 *  - Ejecuta el DDL estándar + rol de mínimo privilegio (rol duplicado → rota
 *    password) y persiste la connection string del AGENTE cifrada.
 *  - Honesto sin infra: unavailable con paso manual; nunca aprovisiona a medias.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    agentDataBackend: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/integrations/oauth", () => ({
  encryptToken: vi.fn((s: string) => `enc:v1:${s}`),
  decryptToken: vi.fn((s: string) => s.replace(/^enc:v1:/, "")),
}));

import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/integrations/oauth";
import {
  provisionManagedDbBackend,
  buildAgentDbUrl,
  buildAgentDbRoleName,
  STANDARD_SCHEMA_DDL,
  AGENT_ROLE_GRANTS,
} from "@/lib/agent-backend/provisioning";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const ADMIN_URL = "postgres://owner:ownerpass@db.gestionada.local:5432/agentes";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENT_BACKEND_ADMIN_DB_URL;
});

describe("buildAgentDbUrl", () => {
  it("misma BD, credenciales del rol de mínimo privilegio (no las del owner)", () => {
    const url = buildAgentDbUrl(ADMIN_URL, "ag-1", "pass_segura_123456");
    const parsed = new URL(url);
    expect(parsed.username).toBe(buildAgentDbRoleName("ag-1"));
    expect(parsed.password).toBe("pass_segura_123456");
    expect(parsed.hostname).toBe("db.gestionada.local");
    expect(url).not.toContain("owner");
  });
});

describe("provisionManagedDbBackend", () => {
  it("invalid_mode si el backend no es managed_db", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "none_yet", dbUrlEncrypted: null });

    const r = await provisionManagedDbBackend("ag-1");

    expect(r.status).toBe("invalid_mode");
  });

  it("already_provisioned si ya hay dbUrlEncrypted (no re-ejecuta DDL)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({
      mode: "managed_db",
      dbUrlEncrypted: "enc:v1:algo",
    });

    const r = await provisionManagedDbBackend("ag-1");

    expect(r.status).toBe("already_provisioned");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });

  it("unavailable con paso manual documentado si falta AGENT_BACKEND_ADMIN_DB_URL", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });

    const r = await provisionManagedDbBackend("ag-1");

    expect(r.status).toBe("unavailable");
    expect(r.reason).toContain("AGENT_BACKEND_ADMIN_DB_URL");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });

  it("ejecuta DDL estándar + rol + grants y persiste la URL del agente CIFRADA", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });
    const executed: string[] = [];
    const executor = vi.fn(async (sql: string) => {
      executed.push(sql);
      return {};
    });

    const r = await provisionManagedDbBackend("ag-1", { executor, adminDbUrl: ADMIN_URL });

    expect(r.status).toBe("provisioned");
    // DDL estándar completo (idempotente) al principio
    for (const ddl of STANDARD_SCHEMA_DDL) expect(executed).toContain(ddl);
    // CREATE ROLE de mínimo privilegio + un GRANT por tabla de la matriz
    const role = buildAgentDbRoleName("ag-1");
    expect(executed.some((s) => s.startsWith(`CREATE ROLE "${role}"`) && s.includes("NOSUPERUSER"))).toBe(true);
    for (const table of Object.keys(AGENT_ROLE_GRANTS)) {
      expect(executed.some((s) => s.startsWith("GRANT") && s.includes(`"${table}"`))).toBe(true);
    }
    // Mapeo rol→agente insertado en agente_rol_map (upsert idempotente)
    expect(executed.some((s) => s.includes("agente_rol_map") && s.includes("INSERT"))).toBe(true);
    // Persistencia: URL del rol del agente, cifrada — nunca la del owner
    expect(prisma.agentDataBackend.update).toHaveBeenCalledTimes(1);
    const saved = asMock(prisma.agentDataBackend.update).mock.calls[0][0].data.dbUrlEncrypted as string;
    expect(saved.startsWith("enc:v1:postgres://")).toBe(true);
    expect(saved).toContain(role);
    expect(saved).not.toContain("owner");
    expect(encryptToken).toHaveBeenCalled();
  });

  it("rol ya existente (42710) → rota la password con ALTER ROLE y sigue", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });
    const executed: string[] = [];
    const executor = vi.fn(async (sql: string) => {
      executed.push(sql);
      if (sql.startsWith("CREATE ROLE")) {
        const err = new Error("role already exists") as Error & { code: string };
        err.code = "42710";
        throw err;
      }
      return {};
    });

    const r = await provisionManagedDbBackend("ag-1", { executor, adminDbUrl: ADMIN_URL });

    expect(r.status).toBe("provisioned");
    expect(executed.some((s) => s.startsWith("ALTER ROLE") && s.includes("PASSWORD"))).toBe(true);
  });

  it("un fallo del DDL NO deja el backend a medias (sin update, unavailable)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });
    const executor = vi.fn(async () => {
      throw new Error("permission denied");
    });

    const r = await provisionManagedDbBackend("ag-1", { executor, adminDbUrl: ADMIN_URL });

    expect(r.status).toBe("unavailable");
    expect(prisma.agentDataBackend.update).not.toHaveBeenCalled();
  });
});

// ── Hardening RLS ────────────────────────────────────────────────────────────

describe("RLS hardening — STANDARD_SCHEMA_DDL + buildLeastPrivilegeProvisioningSql", () => {
  const BUSINESS_TABLES = Object.keys(AGENT_ROLE_GRANTS);
  const DDL = STANDARD_SCHEMA_DDL.join("\n");

  it("el DDL habilita ENABLE + FORCE ROW LEVEL SECURITY en las 7 tablas de negocio", () => {
    for (const table of BUSINESS_TABLES) {
      expect(DDL).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(DDL).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  });

  it("el DDL define las dos policies por tabla: owner (prefijo) + agente (funcion)", () => {
    for (const table of BUSINESS_TABLES) {
      expect(DDL).toContain(`"${table}_rls_owner"`);
      expect(DDL).toContain(`"${table}_rls_agente"`);
    }
  });

  it("la funcion rls_agente_actual usa SECURITY DEFINER, session_user y search_path vacio", () => {
    expect(DDL).toContain("rls_agente_actual");
    expect(DDL).toContain("SECURITY DEFINER");
    expect(DDL).toContain("session_user");
    expect(DDL).toContain("SET search_path = ''");
    // current_user dentro de SECURITY DEFINER devolveria el definer, no el llamador.
    expect(DDL).not.toContain("current_user");
  });

  it("la tabla agente_rol_map existe en el DDL y el agente NO tiene ningun grant sobre ella", () => {
    expect(DDL).toContain(`CREATE TABLE IF NOT EXISTS "agente_rol_map"`);
    expect(Object.keys(AGENT_ROLE_GRANTS)).not.toContain("agente_rol_map");
  });

  it("las FKs compuestas atan agente_id en rango_bloqueo, franja_horaria y cita", () => {
    // rango_bloqueo → horario_agente(id, agente_id)
    expect(DDL).toContain(`REFERENCES "horario_agente"("id", "agente_id")`);
    // franja_horaria → servicio_agente(id, agente_id)
    expect(DDL).toContain(`REFERENCES "servicio_agente"("id", "agente_id")`);
    // cita → franja_horaria(id, agente_id)
    expect(DDL).toContain(`REFERENCES "franja_horaria"("id", "agente_id")`);
  });

  it("el provisionamiento inserta el mapeo rol→agente en agente_rol_map (upsert idempotente)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });
    const executed: string[] = [];
    const executor = vi.fn(async (sql: string) => {
      executed.push(sql);
      return {};
    });

    const r = await provisionManagedDbBackend("ag-1", { executor, adminDbUrl: ADMIN_URL });

    expect(r.status).toBe("provisioned");
    const insert = executed.find((s) => s.includes("agente_rol_map") && s.includes("INSERT"));
    expect(insert).toBeTruthy();
    expect(insert).toContain(buildAgentDbRoleName("ag-1"));
    expect(insert).toContain("ag-1");
    expect(insert).toContain("ON CONFLICT");
  });

  it("el provisionamiento inserta el mapeo tambien cuando el rol ya existia (42710)", async () => {
    asMock(prisma.agentDataBackend.findUnique).mockResolvedValue({ mode: "managed_db", dbUrlEncrypted: null });
    const executed: string[] = [];
    const executor = vi.fn(async (sql: string) => {
      executed.push(sql);
      if (sql.startsWith("CREATE ROLE")) {
        const err = new Error("role already exists") as Error & { code: string };
        err.code = "42710";
        throw err;
      }
      return {};
    });

    const r = await provisionManagedDbBackend("ag-1", { executor, adminDbUrl: ADMIN_URL });

    expect(r.status).toBe("provisioned");
    expect(executed.some((s) => s.includes("agente_rol_map") && s.includes("INSERT"))).toBe(true);
  });
});
