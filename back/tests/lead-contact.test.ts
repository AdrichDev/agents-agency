/**
 * Respaldo determinista del contacto del lead
 * (aa-servicios-completos-y-enlaces-clicables, F.2).
 *
 * Origen: una conversación REAL contra producción (conversationId
 * `cms80jwt900071cgil1pnfxvz`). La visitante dio nombre, email y teléfono en tres turnos
 * distintos. El fusionado por `conversationId` hizo su trabajo — una sola fila —, pero el
 * teléfono quedó a `null`: el modelo llamó a `guardar_lead` cuando llegó el email y no volvió
 * a llamarla cuando llegó el teléfono.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  lead: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { avisoContactoEnMensaje, completarContactoDelLead, extraerEmail, extraerTelefono } = await import(
  "@/lib/agent/lead-contact"
);

beforeEach(() => {
  prismaMock.lead.findUnique.mockReset();
  prismaMock.lead.update.mockReset();
});

describe("extracción", () => {
  it("saca el teléfono tal y como lo escribe la gente", () => {
    expect(extraerTelefono("Y el teléfono es 600 45 12 90, llamadme por la tarde")).toBe(
      "600451290"
    );
    expect(extraerTelefono("mi móvil: 600-451-290")).toBe("600451290");
    expect(extraerTelefono("+34 600451290")).toBe("+34600451290");
  });

  it("no confunde un importe con un teléfono", () => {
    // "900 000 000" son nueve dígitos que empiezan por 9 y encajan con el patrón.
    expect(extraerTelefono("Facturamos 900 000 000 € al año")).toBeNull();
    expect(extraerTelefono("el proyecto sale por 950000000 euros")).toBeNull();
  });

  it("un importe en la frase no invalida un teléfono que también está", () => {
    expect(extraerTelefono("Cuesta 300 € y mi móvil es 611223344")).toBe("611223344");
  });

  it("saca el email", () => {
    expect(extraerEmail("Mi correo es marta.ibanez@tallerlospinos.es")).toBe(
      "marta.ibanez@tallerlospinos.es"
    );
    expect(extraerEmail("no hay correo aquí")).toBeNull();
  });
});

describe("avisoContactoEnMensaje", () => {
  // El respaldo arregla la BD y NO arregla la conversación. Medido tres veces contra producción
  // (`cms821hj1…`, `cms825k9v…`, `cms82bzwc…`), con tres redacciones distintas de la directriz:
  // el visitante escribe "600 45 12 90" suelto y el agente contesta "¿podrías aclarar qué quieres
  // decir con esos números?". Tres intentos por prosa, tres fallos: el aviso deja de ser una norma
  // general y pasa a ser un hecho del turno.
  it("avisa del teléfono que trae el mensaje cuando el lead no lo tiene", () => {
    const aviso = avisoContactoEnMensaje("600 45 12 90", { email: "m@t.es", phone: null });
    expect(aviso).toContain("600451290");
    expect(aviso).toMatch(/teléfono/i);
  });

  it("no avisa de un dato que ya consta", () => {
    // Avisar de lo ya guardado invitaría a dar las gracias dos veces por lo mismo.
    expect(avisoContactoEnMensaje("600 45 12 90", { email: null, phone: "600451290" })).toBeNull();
  });

  it("no avisa cuando el mensaje no trae contacto", () => {
    // Coste cero en la inmensa mayoría de los turnos.
    expect(avisoContactoEnMensaje("¿cuánto cuesta una landing?", null)).toBeNull();
  });

  it("sin lead todavía, el aviso se emite igual", () => {
    // El lead puede crearse en ESTE turno; el aviso es lo que empuja a llamar a la herramienta.
    const aviso = avisoContactoEnMensaje("soy marta@taller.es", null);
    expect(aviso).toContain("marta@taller.es");
    expect(aviso).toMatch(/guardar_lead/);
  });

  it("no confunde un importe con un teléfono", () => {
    expect(avisoContactoEnMensaje("Facturamos 900 000 000 € al año", null)).toBeNull();
  });
});

describe("completarContactoDelLead", () => {
  it("rellena el teléfono que el modelo no volvió a guardar", async () => {
    prismaMock.lead.findUnique.mockResolvedValue({
      id: "l1",
      email: "marta.ibanez@tallerlospinos.es",
      phone: null,
    });

    await completarContactoDelLead("conv-1", "Y el teléfono es 600 45 12 90");

    expect(prismaMock.lead.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { phone: "600451290" },
    });
  });

  it("no pisa un dato que ya está guardado", async () => {
    // Corregir un dato es una decisión; esa la toma el modelo llamando a la herramienta.
    prismaMock.lead.findUnique.mockResolvedValue({
      id: "l1",
      email: "marta@taller.es",
      phone: "600451290",
    });

    await completarContactoDelLead("conv-1", "mejor escríbeme a otro@taller.es o al 611223344");

    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("no crea un lead cuando no hay ninguno", async () => {
    // Quien pregunta un precio y deja su móvil de pasada no ha declarado interés: guardarlo
    // sería recoger un dato personal por nuestra cuenta.
    prismaMock.lead.findUnique.mockResolvedValue(null);

    await completarContactoDelLead("conv-1", "mi móvil es 600451290");

    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("no consulta la BD si el mensaje no trae contacto", async () => {
    await completarContactoDelLead("conv-1", "¿y cuánto tardáis en entregarlo?");

    expect(prismaMock.lead.findUnique).not.toHaveBeenCalled();
  });

  it("rellena los dos campos si llegan juntos", async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: "l1", email: null, phone: null });

    await completarContactoDelLead("conv-1", "soy marta@taller.es, tel 611223344");

    expect(prismaMock.lead.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { email: "marta@taller.es", phone: "611223344" },
    });
  });
});
