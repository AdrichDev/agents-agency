/**
 * aa-reserva-contacto-real-del-visitante — el contacto de una reserva tiene que ser el del
 * visitante, no el que componga el modelo.
 *
 * Origen: fila SEC3 de la matriz de casuística, agente `barberia`, `gpt-4.1-nano`, n=4. En una
 * de las cuatro tiradas la cita se creó con el teléfono del propio negocio a nombre de
 * "Usuario". Estos tests fijan las dos guardas deterministas que lo impiden.
 */
import { describe, it, expect, vi } from "vitest";
import {
  mismoEmail,
  mismoTelefono,
  cargarContactoDelLead,
  cargarContactoDelNegocio,
  resolverContactoReserva,
  type ContactoReadClient,
} from "@/lib/agent/booking-contact";

const NEGOCIO = { telefono: "+34 910 00 00 02", email: "hola@barberia.es" };

function client(agent: unknown, lead: unknown): ContactoReadClient {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(agent) },
    lead: { findUnique: vi.fn().mockResolvedValue(lead) },
  };
}

describe("mismoTelefono — compara números, no cadenas", () => {
  it("reconoce el mismo número escrito de las dos formas que se dan de verdad", () => {
    // El tenant lo guarda con prefijo y espacios; el modelo lo escribió seguido. Sin la
    // normalización a los últimos 9 dígitos el caso MEDIDO no se detecta.
    expect(mismoTelefono("910000002", "+34 910 00 00 02")).toBe(true);
    expect(mismoTelefono("+34 910 00 00 02", "910-000-002")).toBe(true);
  });

  it("no confunde el teléfono del cliente con el del negocio", () => {
    expect(mismoTelefono("622334455", "+34 910 00 00 02")).toBe(false);
  });

  it("nunca casa con un lado ausente o demasiado corto", () => {
    // Un `null` a cada lado casaría con todo si la comparación fuese de cadenas vacías, y
    // entonces la guarda rechazaría cualquier reserva de un tenant sin teléfono.
    expect(mismoTelefono(null, "+34 910 00 00 02")).toBe(false);
    expect(mismoTelefono("910000002", null)).toBe(false);
    expect(mismoTelefono(undefined, undefined)).toBe(false);
    expect(mismoTelefono("1234", "1234")).toBe(false);
  });
});

describe("mismoEmail — caja y espacios, nada más", () => {
  it("iguala mayúsculas y espacios sobrantes", () => {
    expect(mismoEmail("  Hola@Barberia.es ", "hola@barberia.es")).toBe(true);
  });

  it("no iguala direcciones distintas ni ausencias", () => {
    expect(mismoEmail("iker@gmail.com", "hola@barberia.es")).toBe(false);
    expect(mismoEmail(null, "hola@barberia.es")).toBe(false);
    expect(mismoEmail("hola@barberia.es", undefined)).toBe(false);
  });
});

describe("resolverContactoReserva — el contacto del negocio no es un cliente", () => {
  it("rechaza el teléfono del propio negocio y dice qué pedir", () => {
    expect(() =>
      resolverContactoReserva({ telefono: "910000002", nombre: undefined } as never, NEGOCIO, null)
    ).toThrow(/PROPIO NEGOCIO/);
  });

  it("rechaza el email del propio negocio", () => {
    expect(() => resolverContactoReserva({ email: "HOLA@barberia.es" }, NEGOCIO, null)).toThrow(
      /PROPIO NEGOCIO/
    );
  });

  it("el mensaje es accionable: el loop agéntico se lo devuelve al modelo", () => {
    const err = (() => {
      try {
        resolverContactoReserva({ telefono: "+34 910 00 00 02" }, NEGOCIO, null);
      } catch (e) {
        return e as Error;
      }
    })()!;
    expect(err.message).toContain("crear_reserva");
    expect(err.message).toMatch(/su teléfono|SU teléfono/);
  });

  it("deja pasar el contacto real del cliente sin tocarlo", () => {
    expect(resolverContactoReserva({ telefono: "622334455" }, NEGOCIO, null)).toEqual({
      telefono: "622334455",
      email: undefined,
    });
  });

  it("un tenant sin contacto guardado no rechaza nada", () => {
    // AC7: los dos campos son nullable en el esquema. Sin ellos no hay con qué comparar, y la
    // guarda tiene que ser inerte, no lanzar.
    const sinDatos = { telefono: null, email: null };
    expect(resolverContactoReserva({ telefono: "910000002" }, sinDatos, null)).toEqual({
      telefono: "910000002",
      email: undefined,
    });
    expect(resolverContactoReserva({ telefono: "910000002" }, null, null)).toEqual({
      telefono: "910000002",
      email: undefined,
    });
  });
});

describe("resolverContactoReserva — el hueco se rellena con lo que escribió el visitante", () => {
  it("usa el teléfono del lead cuando el modelo no manda ninguno", () => {
    expect(resolverContactoReserva({}, NEGOCIO, { telefono: "622334455" })).toEqual({
      telefono: "622334455",
      email: undefined,
    });
  });

  it("no pisa lo que el modelo sí mandó", () => {
    // Corregir un dato es una decisión, y esa la toma el modelo llamando a la tool. Misma
    // regla que `completarContactoDelLead`.
    expect(
      resolverContactoReserva({ telefono: "600111222" }, NEGOCIO, { telefono: "622334455" })
    ).toEqual({ telefono: "600111222", email: undefined });
  });

  it("un valor traído del lead pasa también por la guarda del negocio", () => {
    expect(() => resolverContactoReserva({}, NEGOCIO, { telefono: "910000002" })).toThrow(
      /PROPIO NEGOCIO/
    );
  });

  it("sin lead y sin dato suministrado no inventa nada: devuelve los dos huecos vacíos", () => {
    // El vacío lo sigue rechazando `assertContactChannel`, con su mensaje de siempre. Aquí lo
    // que se fija es que este resolver no rellene con nada de su cosecha.
    expect(resolverContactoReserva({}, NEGOCIO, null)).toEqual({
      telefono: undefined,
      email: undefined,
    });
  });

  it("trata la cadena vacía como ausencia y cae al lead", () => {
    expect(resolverContactoReserva({ telefono: "  " }, NEGOCIO, { telefono: "622334455" })).toEqual(
      { telefono: "622334455", email: undefined }
    );
  });
});

describe("lecturas — una consulta pequeña, sin caché", () => {
  it("cargarContactoDelNegocio saca el contacto del tenant del agente", async () => {
    const c = client({ tenant: { phone: "+34 910 00 00 02", email: "hola@barberia.es" } }, null);
    await expect(cargarContactoDelNegocio("ag-1", c)).resolves.toEqual({
      telefono: "+34 910 00 00 02",
      email: "hola@barberia.es",
    });
  });

  it("un agente sin tenant devuelve null y no rechaza nada", async () => {
    await expect(cargarContactoDelNegocio("ag-1", client({ tenant: null }, null))).resolves.toBeNull();
    await expect(cargarContactoDelNegocio("ag-1", client(null, null))).resolves.toBeNull();
  });

  it("cargarContactoDelLead devuelve el contacto de la conversación", async () => {
    const c = client(null, { email: null, phone: "622334455" });
    await expect(cargarContactoDelLead("conv-1", c)).resolves.toEqual({
      email: null,
      telefono: "622334455",
    });
  });

  it("sin conversationId no consulta la BD siquiera", async () => {
    const c = client(null, null);
    await expect(cargarContactoDelLead(undefined, c)).resolves.toBeNull();
    expect(c.lead.findUnique).not.toHaveBeenCalled();
  });

  it("una conversación sin lead devuelve null", async () => {
    await expect(cargarContactoDelLead("conv-1", client(null, null))).resolves.toBeNull();
  });
});
