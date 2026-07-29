/**
 * aa-cupo-cache-y-prefijo — T3.3 y T3.4.
 *
 * El bloque base tiene un requisito funcional (las normas comunes llegan a TODOS los agentes) y uno
 * económico (el prefijo supera el mínimo cacheable del proveedor, 1024 tokens). El segundo es el que
 * necesita test: es un fallo INVISIBLE. Si alguien recorta el bloque, nada se rompe, nadie se queja,
 * y la única señal es que la factura del propietario y el cupo del cliente empeoran a la vez.
 *
 * El back no tiene tokenizer, así que el umbral se comprueba en caracteres con ratio conservador.
 * Que la caché acierte DE VERDAD no lo puede probar un test unitario —depende de cómo casa prefijos
 * OpenAI—: eso es T4, medición contra el proveedor real registrada en `evidence.md`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/embeddings", () => ({ searchKnowledge: vi.fn() }));
vi.mock("@/lib/agent/order-status", () => ({ fetchOrderStatus: vi.fn() }));
vi.mock("@/lib/openai", () => ({ openai: {}, getClientForAgent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ processNewLead: vi.fn() }));
vi.mock("@/lib/token-metering", () => ({
  deductTokens: vi.fn(),
  assertUsageAllowed: vi.fn(async () => ({ meteredTenantId: null, credentialMode: "platform" })),
}));

import { BASE_DIRECTIVES, BASE_DIRECTIVES_MIN_CHARS } from "@/lib/agent/base-directives";
import { buildSystemPrompt } from "@/lib/agent/engine";

/** Agente pelado: sin skills, sin capacidades, con el prompt más corto que un operador puede escribir. */
const AGENTE_MINIMO = { name: "Bot", systemPrompt: "Eres un asistente.", skills: [] };
const SIN_CAPS = { executableProviders: [], missingConnections: [], informationalSkills: [] };

function promptMinimo() {
  return buildSystemPrompt(AGENTE_MINIMO as any, SIN_CAPS as any, [], false, null);
}

describe("AC7 — el bloque supera el mínimo cacheable POR SÍ SOLO", () => {
  it("mide al menos BASE_DIRECTIVES_MIN_CHARS", () => {
    expect(BASE_DIRECTIVES.length).toBeGreaterThanOrEqual(BASE_DIRECTIVES_MIN_CHARS);
  });

  it("el umbral deja margen real sobre los 1024 tokens del proveedor", () => {
    // 4,0 chars/token es conservador para español. La caché casa en incrementos de 128 tokens, así
    // que rozar el mínimo es quedarse fuera del primer incremento útil: se exige ≥1.100.
    expect(BASE_DIRECTIVES_MIN_CHARS / 4).toBeGreaterThanOrEqual(1100);
  });

  it("no depende del prompt del operador: el agente más pelado posible ya pasa el umbral", () => {
    // Este es el test que importa. Si el umbral se cumpliera SUMANDO el prompt del agente, un
    // operador que escribe dos líneas volvería a caer por debajo y perdería la caché sin enterarse.
    expect(promptMinimo().length).toBeGreaterThanOrEqual(BASE_DIRECTIVES_MIN_CHARS);
  });
});

describe("T3.2 — posición: el bloque encabeza el prompt", () => {
  it("va el primero, antes del nombre del agente y de su prompt", () => {
    // La caché casa por PREFIJO. Al final del prompt el bloque no lo comparte ningún otro agente y
    // deja de servir para lo que se puso.
    expect(promptMinimo().startsWith(BASE_DIRECTIVES)).toBe(true);
  });

  it("el nombre y el prompt del operador siguen estando, detrás", () => {
    const s = promptMinimo();
    expect(s).toContain("Eres un asistente.");
    expect(s).toContain("Bot");
    expect(s.indexOf("Eres un asistente.")).toBeGreaterThan(s.indexOf(BASE_DIRECTIVES));
  });

  it("llega también a un agente sin ninguna capacidad", () => {
    // Antes de este bloque, un agente sin `leads` ni `citas` no recibía NINGUNA norma de veracidad
    // ni de datos personales: todas vivían en bloques condicionales.
    expect(promptMinimo()).toContain("VERACIDAD");
    expect(promptMinimo()).toContain("DATOS PERSONALES");
  });
});

describe("AC10 — precedencia declarada", () => {
  it("el bloque cierra diciendo que lo que sigue prevalece", () => {
    // Sin esta línea, adelantar el bloque al principio sería un cambio de comportamiento
    // encubierto: hasta ahora el prompt del operador era lo primero que leía el modelo.
    expect(BASE_DIRECTIVES).toMatch(/PREVALECEN/);
  });

  it("los límites que NO se pueden levantar desde el prompt del negocio están nombrados", () => {
    // La precedencia no puede ser total: un prompt de operador no debe poder autorizar que el bot
    // pida datos bancarios por el chat ni que dé consejo médico.
    const cierre = BASE_DIRECTIVES.slice(-400);
    expect(cierre).toMatch(/datos sensibles/i);
    expect(cierre).toMatch(/urgencias/i);
    expect(cierre).toMatch(/consejo profesional/i);
  });

  it("el límite blindado es el subconjunto duro, no la categoría entera de datos personales", () => {
    // Encontrado en T5.2 y medido en conversación real: la primera redacción blindaba "datos
    // personales" enteros contra el prompt del operador, y 7 de los 11 agentes de producción piden
    // email y teléfono para captar el lead. El bot llegó a responder "no necesito el teléfono para
    // seguir por ahora" a un usuario que se lo estaba dando. El blindaje tiene que nombrar lo que
    // de verdad no se puede levantar (bancarios, identidad, salud), no la categoría completa.
    const cierre = BASE_DIRECTIVES.slice(-400);
    expect(cierre).toMatch(/bancarios/i);
    expect(cierre).toMatch(/identidad/i);
    expect(cierre).toMatch(/salud/i);
  });
});

describe("T5.2 — la base no bloquea la captación de leads", () => {
  it("autoriza explícitamente pedir datos de contacto cuando el negocio lo indica", () => {
    // Es el producto: 7 de los 11 prompts de producción terminan pidiendo nombre, email y
    // teléfono para que una persona del equipo llame. Una directriz de minimización redactada sin
    // esta excepción convierte al agente en un obstáculo para lo que el operador le pidió.
    expect(BASE_DIRECTIVES).toMatch(/nombre, email, teléfono/i);
    expect(BASE_DIRECTIVES).toMatch(/hazlo con normalidad/i);
  });

  it("sigue prohibiendo por el chat lo que no puede pedirse nunca", () => {
    expect(BASE_DIRECTIVES).toMatch(/datos bancarios/i);
    expect(BASE_DIRECTIVES).toMatch(/contraseñas/i);
    expect(BASE_DIRECTIVES).toMatch(/documentos de identidad/i);
  });
});

describe("T5.2 — el bloque no invade lo que ya decide otro sitio", () => {
  it("no habla de citas, pedidos ni herramientas concretas", () => {
    // Esas instrucciones se inyectan condicionalmente y sólo cuando la herramienta existe. Aquí
    // le dirían a un agente sin calendario que reserve citas.
    expect(BASE_DIRECTIVES).not.toMatch(/reservar_cita|crear_pedido|usar_skill|search_knowledge/);
  });

  it("no redefine el estilo conversacional (emojis, longitud, fórmulas)", () => {
    // `CONVERSATION_STYLE_GUIDE` ya lo fija y su versión comprimida está verificada (T5.3 de
    // aa-agentes-economia-tokens). Dos fuentes para la misma regla es una contradicción esperando.
    expect(BASE_DIRECTIVES).not.toMatch(/emoji/i);
    expect(BASE_DIRECTIVES).not.toMatch(/1-3 frases|Markdown/i);
  });
});
