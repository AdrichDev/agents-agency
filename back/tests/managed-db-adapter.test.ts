/**
 * T2 — aa-agent-backend-foundation Fase 2 (AC2).
 * Cubre: (1) contrato `AgentBackendAdapter`; (2) adapter `managed_db` con
 * ejecutor SQL inyectado (mock); (3) disponibilidad DELEGA en
 * `booking/slots.ts:generateSlots`; (4) escrituras solo por plantilla
 * parametrizada — el texto del LLM jamas entra en el SQL; (5) resolucion +
 * descifrado de `dbUrlEncrypted` (patron OAuth enc:v1:); (6) provisionamiento
 * de rol Postgres de minimo privilegio.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { DateTime } from "luxon";

// Clave de cifrado de tests (mismo mecanismo que tokens OAuth — 32 bytes hex).
process.env.CHANNEL_ENCRYPTION_KEY ??= "a".repeat(64);

// ── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  prisma: { agentDataBackend: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/booking/slots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booking/slots")>();
  return { generateSlots: vi.fn(actual.generateSlots) };
});

import { prisma } from "@/lib/db";
import { generateSlots } from "@/lib/booking/slots";
import { encryptToken } from "@/lib/integrations/oauth";
import { SQL_TEMPLATES, type SqlTemplateKey } from "@/lib/agent-backend/sql-templates";
import {
  ManagedDbAdapter,
  resolveAgentBackendAdapter,
  clearAgentBackendExecutors,
  CapabilityNotEnabledError,
  SlotNoDisponibleError,
  type SqlExecutor,
  type QueryResultLike,
} from "@/lib/agent-backend/managed-db";
import type { AgentBackendAdapter } from "@/lib/agent-backend/types";
import {
  AGENT_ROLE_GRANTS,
  buildAgentDbRoleName,
  buildLeastPrivilegeProvisioningSql,
  generateAgentDbPassword,
  STANDARD_SCHEMA_DDL,
} from "@/lib/agent-backend/provisioning";

const mockFindUnique = prisma.agentDataBackend.findUnique as ReturnType<typeof vi.fn>;
const mockGenerateSlots = generateSlots as unknown as ReturnType<typeof vi.fn>;

// ── Ejecutor fake: registra cada query y responde por plantilla ────────────

type Call = { text: string; values: unknown[] };

function templateKeyOf(text: string): SqlTemplateKey | undefined {
  return (Object.keys(SQL_TEMPLATES) as SqlTemplateKey[]).find((k) => SQL_TEMPLATES[k] === text);
}

function makeExecutor(
  responses: Partial<Record<SqlTemplateKey, Array<Record<string, unknown>>>>
): { executor: SqlExecutor; calls: Call[] } {
  const calls: Call[] = [];
  const query = async (text: string, values: unknown[] = []): Promise<QueryResultLike> => {
    calls.push({ text, values });
    const key = templateKeyOf(text);
    const rows = (key && responses[key]) ?? [];
    return { rows, rowCount: rows.length };
  };
  return {
    calls,
    executor: {
      query,
      transaction: async (fn) => fn(query),
      end: async () => {},
    },
  };
}

/** Todo texto ejecutado debe ser EXACTAMENTE una plantilla del mapa congelado. */
function assertOnlyTemplates(calls: Call[]): void {
  const templates = new Set<string>(Object.values(SQL_TEMPLATES));
  for (const c of calls) expect(templates.has(c.text)).toBe(true);
}

const AGENT_ID = "agent-managed-1";
const TZ = "Europe/Madrid";
// Dia de referencia y clave de horario derivada igual que slots.ts (EEEE lowercase).
const DAY = DateTime.fromISO("2026-07-20T00:00:00", { zone: TZ });
const DAY_KEY = DAY.toFormat("EEEE").toLowerCase();
const RANGO = { desde: DAY.toJSDate(), hasta: DAY.endOf("day").toJSDate() };

const SERVICIO_ROW = { id: "svc-1", nombre: "Corte", duracion: 30 };
const HORARIO_ROW = {
  id: "hor-1",
  zona_horaria: TZ,
  horario: { [DAY_KEY]: "09:00-11:00" },
};

function makeAdapter(
  responses: Partial<Record<SqlTemplateKey, Array<Record<string, unknown>>>>,
  capabilities: Array<"reservas" | "leads" | "pedidos"> = ["reservas", "leads", "pedidos"]
) {
  const { executor, calls } = makeExecutor(responses);
  return { adapter: new ManagedDbAdapter(AGENT_ID, capabilities, executor), calls };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockGenerateSlots.mockClear();
});

afterAll(async () => {
  await clearAgentBackendExecutors();
});

// ── T2.1 contrato ───────────────────────────────────────────────────────────

describe("T2.1 — contrato AgentBackendAdapter", () => {
  it("el adapter managed_db implementa los 6 metodos del contrato (design.md B.3)", () => {
    const { adapter } = makeAdapter({});
    const contract: AgentBackendAdapter = adapter; // asignabilidad TS
    for (const m of [
      "consultarDisponibilidad",
      "crearReserva",
      "cancelarReserva",
      "guardarLead",
      "consultarPedido",
      "notificar",
    ] as const) {
      expect(typeof contract[m]).toBe("function");
    }
  });
});

// ── Plantillas: estaticas y congeladas ──────────────────────────────────────

describe("plantillas SQL parametrizadas", () => {
  it("el mapa esta congelado y solo usa placeholders $n (sin interpolacion)", () => {
    expect(Object.isFrozen(SQL_TEMPLATES)).toBe(true);
    for (const text of Object.values(SQL_TEMPLATES)) {
      expect(text).not.toContain("${");
      expect(text).toMatch(/\$\d/);
    }
  });
});

// ── Disponibilidad: delegacion en generateSlots ─────────────────────────────

describe("consultarDisponibilidad — delega en booking/slots.ts:generateSlots (T2.3)", () => {
  const bloqueo = {
    fecha_inicio: DAY.plus({ days: 5 }).toJSDate(),
    fecha_fin: DAY.plus({ days: 6 }).toJSDate(),
  };
  // 09:30 local ya reservado
  const ocupada = { inicio: DAY.set({ hour: 9, minute: 30 }).toJSDate() };

  it("calcula slots con generateSlots y filtra las franjas ocupadas", async () => {
    const { adapter, calls } = makeAdapter({
      reservas_servicio: [SERVICIO_ROW],
      reservas_horario: [HORARIO_ROW],
      reservas_bloqueos: [bloqueo],
      reservas_ocupadas: [ocupada],
    });

    const slots = await adapter.consultarDisponibilidad("Corte", RANGO);

    // Delegacion real: generateSlots invocado con los datos leidos de la BD
    expect(mockGenerateSlots).toHaveBeenCalledTimes(1);
    expect(mockGenerateSlots).toHaveBeenCalledWith(
      RANGO.desde,
      RANGO.hasta,
      SERVICIO_ROW.duracion,
      HORARIO_ROW.horario,
      TZ,
      [{ startDate: bloqueo.fecha_inicio, endDate: bloqueo.fecha_fin }]
    );

    // 09:00-11:00 con paso 30 y duracion 30 → 4 teoricos; 09:30 ocupado → 3
    expect(slots).toHaveLength(3);
    const epochs = slots.map((s) => new Date(s.startTime).getTime());
    expect(epochs).not.toContain(ocupada.inicio.getTime());

    assertOnlyTemplates(calls);
  });

  it("rechaza si el servicio no existe en el backend", async () => {
    const { adapter } = makeAdapter({ reservas_servicio: [] });
    await expect(adapter.consultarDisponibilidad("Fantasma", RANGO)).rejects.toThrow(
      /Servicio no encontrado/
    );
  });

  it("rechaza sin capability reservas", async () => {
    const { adapter } = makeAdapter({}, ["leads"]);
    await expect(adapter.consultarDisponibilidad("Corte", RANGO)).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
  });
});

// ── crearReserva ────────────────────────────────────────────────────────────

describe("crearReserva — plantilla parametrizada, sin SQL libre", () => {
  const SLOT = {
    startTime: DAY.set({ hour: 9 }).toISO()!,
    endTime: DAY.set({ hour: 9, minute: 30 }).toISO()!,
  };
  const INYECCION = `'; DROP TABLE "cita"; --`;

  it("inserta franja + cita por plantilla y devuelve la reserva", async () => {
    const { adapter, calls } = makeAdapter({
      reservas_servicio: [SERVICIO_ROW],
      reservas_insertar_franja: [{ id: "fr-1" }],
      reservas_insertar_cita: [{ id: "cita-1", estado: "scheduled" }],
    });

    const reserva = await adapter.crearReserva("Corte", SLOT, {
      nombre: "Ana",
      email: "ana@example.com",
    });

    expect(reserva).toMatchObject({
      id: "cita-1",
      servicioId: "svc-1",
      servicioNombre: "Corte",
      estado: "scheduled",
    });
    assertOnlyTemplates(calls);

    // El contacto viaja SOLO como bind values
    const citaCall = calls.find((c) => c.text === SQL_TEMPLATES.reservas_insertar_cita)!;
    expect(citaCall.values).toContain("ana@example.com");
  });

  it("rechaza el slot ya reservado (ON CONFLICT sin fila)", async () => {
    const { adapter } = makeAdapter({
      reservas_servicio: [SERVICIO_ROW],
      reservas_insertar_franja: [], // conflicto: DO NOTHING no devuelve fila
    });
    await expect(adapter.crearReserva("Corte", SLOT, {})).rejects.toBeInstanceOf(
      SlotNoDisponibleError
    );
  });

  it("un intento de inyeccion del LLM nunca toca el texto SQL (AC2)", async () => {
    const { adapter, calls } = makeAdapter({
      reservas_servicio: [SERVICIO_ROW],
      reservas_insertar_franja: [{ id: "fr-2" }],
      reservas_insertar_cita: [{ id: "cita-2", estado: "scheduled" }],
    });

    await adapter.crearReserva("Corte", SLOT, { nombre: INYECCION, notas: INYECCION });

    for (const c of calls) {
      expect(c.text).not.toContain(INYECCION);
      expect(c.text).not.toMatch(/DROP TABLE/i);
    }
    // ... pero SI viaja como dato bind (parametrizado)
    const citaCall = calls.find((c) => c.text === SQL_TEMPLATES.reservas_insertar_cita)!;
    expect(JSON.stringify(citaCall.values)).toContain("DROP TABLE");
    assertOnlyTemplates(calls);
  });

  it("rechaza fechas invalidas antes de tocar la BD", async () => {
    const { adapter, calls } = makeAdapter({});
    await expect(
      adapter.crearReserva("Corte", { startTime: "no-es-fecha", endTime: SLOT.endTime }, {})
    ).rejects.toThrow(/Fecha invalida/);
    expect(calls).toHaveLength(0);
  });
});

// ── cancelarReserva ─────────────────────────────────────────────────────────

describe("cancelarReserva", () => {
  it("cancela la cita (scoped por agente) y libera la franja", async () => {
    const { adapter, calls } = makeAdapter({
      reservas_cancelar_cita: [{ franja_id: "fr-1" }],
    });
    const res = await adapter.cancelarReserva("cita-1");
    expect(res).toEqual({ ok: true, estado: "cancelled" });

    const cancel = calls.find((c) => c.text === SQL_TEMPLATES.reservas_cancelar_cita)!;
    expect(cancel.values).toEqual(["cita-1", AGENT_ID]);
    expect(calls.some((c) => c.text === SQL_TEMPLATES.reservas_liberar_franja)).toBe(true);
    assertOnlyTemplates(calls);
  });

  it("rechaza si la reserva no existe o ya esta cancelada", async () => {
    const { adapter } = makeAdapter({ reservas_cancelar_cita: [] });
    await expect(adapter.cancelarReserva("nope")).rejects.toThrow(/no encontrada|cancelada/);
  });
});

// ── guardarLead ─────────────────────────────────────────────────────────────

describe("guardarLead", () => {
  it("inserta por plantilla y la intencion maliciosa solo viaja como bind", async () => {
    const creado = new Date("2026-07-20T10:00:00Z");
    const { adapter, calls } = makeAdapter({
      leads_insertar: [{ id: "lead-1", creado_en: creado }],
    });
    const evil = `x'); DELETE FROM "lead"; --`;

    const lead = await adapter.guardarLead(
      { nombre: "Bruno", telefono: "600111222" },
      evil
    );

    expect(lead).toEqual({ id: "lead-1", creadoEn: creado.toISOString() });
    const call = calls.find((c) => c.text === SQL_TEMPLATES.leads_insertar)!;
    expect(call.text).not.toContain(evil);
    expect(call.values).toContain(evil);
    assertOnlyTemplates(calls);
  });

  it("rechaza lead sin nombre y sin capability leads", async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.guardarLead({ nombre: "  " }, "reserva")).rejects.toThrow(
      /requiere nombre/
    );
    const { adapter: sinLeads } = makeAdapter({}, ["reservas"]);
    await expect(sinLeads.guardarLead({ nombre: "Ana" }, "x")).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
  });

  it("rechaza parametros no escalares (defensa en profundidad)", async () => {
    const { adapter, calls } = makeAdapter({});
    await expect(
      adapter.guardarLead(
        { nombre: "Ana", email: { $ne: null } as unknown as string },
        "reserva"
      )
    ).rejects.toThrow(/no escalar/);
    expect(calls).toHaveLength(0);
  });
});

// ── consultarPedido ─────────────────────────────────────────────────────────

describe("consultarPedido", () => {
  it("devuelve el estado si el pedido existe", async () => {
    const { adapter, calls } = makeAdapter({
      pedidos_consultar: [{ codigo: "P-1", estado: "enviado", detalle: { tracking: "T1" } }],
    });
    const res = await adapter.consultarPedido("P-1");
    expect(res).toEqual({
      encontrado: true,
      codigo: "P-1",
      estado: "enviado",
      detalle: { tracking: "T1" },
    });
    assertOnlyTemplates(calls);
  });

  it("devuelve encontrado=false si no existe", async () => {
    const { adapter } = makeAdapter({ pedidos_consultar: [] });
    const res = await adapter.consultarPedido("NADA");
    expect(res).toEqual({ encontrado: false, codigo: "NADA" });
  });
});

// ── notificar (stub F6, best-effort) ────────────────────────────────────────

describe("notificar", () => {
  it("resuelve sin lanzar y no ejecuta SQL (best-effort)", async () => {
    const { adapter, calls } = makeAdapter({});
    await expect(
      adapter.notificar("nueva_reserva", { citaId: "c1" })
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

// ── Resolucion + descifrado (resolveAgentBackendAdapter) ───────────────────

describe("resolveAgentBackendAdapter — descifrado enc:v1: y modos", () => {
  it("devuelve null sin fila o con mode none_yet / external_api (backlog v1)", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await resolveAgentBackendAdapter("a1")).toBeNull();

    mockFindUnique.mockResolvedValueOnce({ mode: "none_yet" });
    expect(await resolveAgentBackendAdapter("a2")).toBeNull();

    mockFindUnique.mockResolvedValueOnce({ mode: "external_api", apiBaseUrl: "https://x" });
    expect(await resolveAgentBackendAdapter("a3")).toBeNull();
  });

  it("managed_db sin dbUrlEncrypted es error de configuracion", async () => {
    mockFindUnique.mockResolvedValueOnce({ mode: "managed_db", dbUrlEncrypted: null });
    await expect(resolveAgentBackendAdapter("a4")).rejects.toThrow(/sin dbUrlEncrypted/);
  });

  it("descifra la connection string (mismo cifrado que tokens OAuth) y abre el ejecutor", async () => {
    const plainUrl = "postgresql://agente_bot_a5:pwd-secreta@db.example.com:5432/negocio";
    mockFindUnique.mockResolvedValueOnce({
      mode: "managed_db",
      dbUrlEncrypted: encryptToken(plainUrl),
      capabilities: ["reservas", "leads"],
    });

    const factory = vi.fn(() => makeExecutor({}).executor);
    const adapter = await resolveAgentBackendAdapter("a5", { createExecutor: factory });

    expect(factory).toHaveBeenCalledWith(plainUrl); // URL en claro solo aqui
    expect(adapter).toBeInstanceOf(ManagedDbAdapter);
    // capabilities respetadas: pedidos NO habilitado
    await expect(adapter!.consultarPedido("P-1")).rejects.toBeInstanceOf(
      CapabilityNotEnabledError
    );
  });
});

// ── Provisionamiento: rol de minimo privilegio (T2.4) ───────────────────────

describe("provisioning — usuario Postgres de minimo privilegio", () => {
  it("el nombre de rol se sanea: un agentId hostil no inyecta DDL", () => {
    const role = buildAgentDbRoleName(`ag'; DROP ROLE postgres; --`);
    expect(role).toMatch(/^agente_bot_[a-z0-9]+$/);
    expect(role).not.toContain("'");
    expect(role).not.toContain(";");
  });

  it("la matriz de grants no concede DELETE/TRUNCATE ni nada fuera de las tablas estandar", () => {
    const allowedTables = [
      "servicio_agente",
      "horario_agente",
      "rango_bloqueo",
      "franja_horaria",
      "cita",
      "lead",
      "pedido",
    ];
    expect(Object.keys(AGENT_ROLE_GRANTS).sort()).toEqual([...allowedTables].sort());
    for (const ops of Object.values(AGENT_ROLE_GRANTS)) {
      for (const op of ops) expect(["SELECT", "INSERT", "UPDATE"]).toContain(op);
    }
    // solo lectura en catalogo/horarios; escritura acotada
    expect(AGENT_ROLE_GRANTS.servicio_agente).toEqual(["SELECT"]);
    expect(AGENT_ROLE_GRANTS.horario_agente).toEqual(["SELECT"]);
  });

  it("el DDL de provisionamiento crea un rol sin privilegios peligrosos", () => {
    const pwd = generateAgentDbPassword();
    const stmts = buildLeastPrivilegeProvisioningSql("agent-abc123", pwd);

    const createRole = stmts[0];
    expect(createRole).toContain("NOSUPERUSER");
    expect(createRole).toContain("NOCREATEDB");
    expect(createRole).toContain("NOCREATEROLE");
    expect(createRole).toContain("NOBYPASSRLS");

    const joined = stmts.join("\n");
    expect(joined).not.toMatch(/GRANT\s+ALL/i);
    expect(joined).not.toMatch(/\bDELETE\b/);
    expect(joined).not.toMatch(/\bTRUNCATE\b/);
    expect(joined).not.toMatch(/\bDROP\b/);
    expect(joined).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public");
  });

  it("rechaza passwords fuera del charset seguro (no interpolables)", () => {
    expect(() => buildLeastPrivilegeProvisioningSql("agent-x", `pw'; DROP ROLE x; --`)).toThrow(
      /Password de rol invalida/
    );
  });

  it("el esquema estandar cubre las tablas que usan las plantillas", () => {
    const ddl = STANDARD_SCHEMA_DDL.join("\n");
    for (const table of Object.keys(AGENT_ROLE_GRANTS)) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
    // El anti-doble-reserva de crearReserva depende de este unique
    expect(ddl).toContain(`UNIQUE ("servicio_id", "inicio")`);
  });
});
