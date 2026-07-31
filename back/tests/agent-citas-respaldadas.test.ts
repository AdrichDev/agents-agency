/**
 * T2.1/T2.2 (aa-agente-no-inventa-datos-ni-politicas, AC2) — la cita apunta a un fragmento que
 * se entregó, o no hay cita.
 *
 * Los casos no son inventados: salen de las 36 respuestas citadas del histórico, medidas con
 * `scripts/diag-citas-respaldadas.ts`. Cada bloque dice de qué fila viene.
 */
import { describe, it, expect } from "vitest";
import {
  citaResuelve,
  filtrarCitasSinRespaldo,
  referenciasDeLaCita,
  resolverFragmento,
  type FragmentoCitable,
} from "@/lib/agent/citation-support";

const LAFAYETTE: FragmentoCitable[] = [
  {
    indice: 1,
    fuente: "https://www.brasserielafayette.es/contacto/",
    contenido:
      "HORARIO DE RESERVAS Lunes a Sábado: de 13:30 a 15:45 y de 20:00 a 22:45. Domingo: carta de 13:30 a 16:00.",
  },
  {
    indice: 2,
    fuente: "https://www.brasserielafayette.es/sobre-nosotros/",
    contenido: "Brasserie Lafayette nace en 2016 en el barrio de Salamanca.",
  },
];

/** Conocimiento subido como fichero: `publicSource` lo deja sin URL a propósito. */
const SIN_URL: FragmentoCitable[] = [
  { indice: 1, fuente: null, contenido: "Croquetas de jamón 11,00 €. Alérgenos: gluten, lácteos." },
];

describe("referenciasDeLaCita", () => {
  it("saca el índice de la forma que el modelo usa en la práctica", () => {
    expect(referenciasDeLaCita("[2]")).toEqual(["2"]);
  });

  it("saca la URL de un enlace markdown sin confundir sus corchetes con un índice", () => {
    // Histórico Lafayette: `(fuente: [web](https://www.brasserielafayette.es/contacto/))`.
    // Leer `[web]` como índice apuntaría a un fragmento cualquiera; y cortar en el primer `)`
    // dejaba la URL mutilada, que era como una cita legítima acababa pareciendo inventada.
    expect(referenciasDeLaCita("[web](https://www.brasserielafayette.es/contacto/)")).toEqual([
      "https://www.brasserielafayette.es/contacto/",
    ]);
  });

  it("saca las dos URLs cuando el modelo mete varias en la misma cita", () => {
    expect(referenciasDeLaCita("https://a.es/ciclismo, https://a.es/running")).toEqual([
      "https://a.es/ciclismo",
      "https://a.es/running",
    ]);
  });

  it("devuelve la prosa tal cual, para que no resuelva", () => {
    expect(referenciasDeLaCita("carta y alérgenos")).toEqual(["carta y alérgenos"]);
  });
});

describe("resolverFragmento", () => {
  it("resuelve por índice entregado", () => {
    expect(resolverFragmento("[1]", LAFAYETTE)?.indice).toBe(1);
  });

  it("no resuelve un índice que nadie entregó", () => {
    expect(resolverFragmento("[5]", LAFAYETTE)).toBeNull();
  });

  it("no resuelve `[0]`, que es como un fragmento de la tool acabaría avalando una cita inventada", () => {
    const deLaTool: FragmentoCitable[] = [{ indice: 0, fuente: null, contenido: "lo que sea" }];
    expect(resolverFragmento("[0]", deLaTool)).toBeNull();
  });

  it("resuelve por URL ignorando la barra final y las mayúsculas", () => {
    expect(resolverFragmento("HTTPS://WWW.BRASSERIELAFAYETTE.ES/CONTACTO", LAFAYETTE)?.indice).toBe(1);
  });

  it("no resuelve una URL que no se entregó", () => {
    expect(resolverFragmento("https://www.brasserielafayette.es/reservas/", LAFAYETTE)).toBeNull();
  });
});

describe("citaResuelve", () => {
  it("exige que TODAS las referencias resuelvan, no sólo una", () => {
    // Una URL entregada junto a otra que no lo fue le presta credibilidad a la segunda, y el
    // visitante no distingue cuál avala qué.
    const mezcla = "https://www.brasserielafayette.es/contacto/, https://www.brasserielafayette.es/reservas/";
    expect(citaResuelve("https://www.brasserielafayette.es/contacto/", LAFAYETTE)).toBe(true);
    expect(citaResuelve(mezcla, LAFAYETTE)).toBe(false);
  });

  it("una cita vacía no resuelve", () => {
    expect(citaResuelve("   ", LAFAYETTE)).toBe(false);
  });
});

describe("filtrarCitasSinRespaldo", () => {
  it("conserva la cita por índice que apunta a un fragmento entregado", () => {
    // Histórico Barbería Núñez, la forma más común: 6 de 6 citas por índice se conservan.
    const texto = "El servicio de corte y barba cuesta 24 € y dura 45 minutos (fuente: [1]).";
    const r = filtrarCitasSinRespaldo(texto, LAFAYETTE);
    expect(r.retiradas).toBe(0);
    expect(r.texto).toBe(texto);
  });

  it("retira la cita en prosa, que no apunta a nada", () => {
    // Histórico Casa Mendieta: 9 citas de esta clase, ninguna verificable por el visitante.
    const r = filtrarCitasSinRespaldo(
      "Las croquetas de jamón cuestan 11,00 € (fuente: carta y alérgenos).",
      SIN_URL
    );
    expect(r.retiradas).toBe(1);
    expect(r.texto).toBe("Las croquetas de jamón cuestan 11,00 €.");
  });

  it("retira la cita al nombre del fichero interno, que el modelo no debería ni ver", () => {
    // Histórico Casa Mendieta / 3A Estudio: `carta-alergenos.md`, `proceso.md`, `servicios.md`.
    // Es la fuga que `publicSource` cierra en origen; esto la borra también de lo ya emitido.
    const r = filtrarCitasSinRespaldo(
      "El menú incluye pescado, moluscos y sulfitos (fuente: carta-alergenos.md).",
      SIN_URL
    );
    expect(r.retiradas).toBe(1);
    expect(r.texto).not.toContain("carta-alergenos.md");
  });

  it("conserva la URL escrita como enlace markdown", () => {
    const texto =
      "Los domingos la carta cierra a las 16:00 (fuente: [web](https://www.brasserielafayette.es/contacto/)).";
    const r = filtrarCitasSinRespaldo(texto, LAFAYETTE);
    expect(r.retiradas).toBe(0);
    expect(r.texto).toBe(texto);
  });

  it("sin fragmentos entregados retira todas las citas", () => {
    const r = filtrarCitasSinRespaldo(
      "Abrimos a las 13:30 (fuente: [1]) y cerramos a las 16:00 (fuente: https://x.es/a).",
      []
    );
    expect(r.retiradas).toBe(2);
    expect(r.texto).not.toContain("fuente");
  });

  it("retira varias citas del mismo texto sin descuadrar las posiciones", () => {
    // El recorte va de atrás hacia delante justamente por esto: quitar la primera movería el
    // índice de la segunda y el corte caería en medio de la frase.
    const r = filtrarCitasSinRespaldo(
      "Abrimos a las 13:30 (fuente: inventada) y cerramos a las 16:00 (fuente: [1]) según la web.",
      LAFAYETTE
    );
    expect(r.retiradas).toBe(1);
    expect(r.texto).toBe(
      "Abrimos a las 13:30 y cerramos a las 16:00 (fuente: [1]) según la web."
    );
  });

  it("deja intacto un texto sin citas", () => {
    const texto = "¿Quieres que consulte disponibilidad para el sábado?";
    expect(filtrarCitasSinRespaldo(texto, LAFAYETTE)).toEqual({ texto, retiradas: 0 });
  });

  it("LÍMITE CONOCIDO: no juzga si el fragmento sostiene la afirmación", () => {
    // Fila H4. El fragmento sólo da el horario de RESERVAS; la respuesta lo sirve como hora de
    // cierre de LA COCINA. La cita se conserva, porque la URL sí se entregó.
    //
    // Esto está aquí a propósito y no es un descuido: se intentó con solape léxico y la medición
    // sobre el histórico lo tumbó — esta invención puntúa 0,78 y la respuesta honesta ("no tengo
    // confirmado a qué hora cierra la cocina") puntúa 0,33. Cualquier umbral que mate la primera
    // mata antes la segunda. Si algún día se cubre, este test debe cambiar de expectativa, no
    // desaparecer sin más.
    const r = filtrarCitasSinRespaldo(
      "La cocina cierra a las 15:45 (fuente: https://www.brasserielafayette.es/contacto/).",
      LAFAYETTE
    );
    expect(r.retiradas).toBe(0);
  });
});
