/**
 * Sesión persistente y enlaces clicables del widget
 * (aa-servicios-completos-y-enlaces-clicables, C.2 y D).
 *
 * Dos defectos reportados desde la web real:
 * - Recargar la página empezaba de cero: `conversationId` vivía en un `var`, así que el
 *   agente volvía a saludar y a preguntar el nombre a alguien que ya se los había dado.
 * - Los enlaces del bot llegaban como corchetes literales.
 *
 * Se carga `public/widget.js` DE VERDAD dentro de jsdom: se sirve tal cual a webs de
 * terceros y no pasa por build, así que probar una copia no probaría nada.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, type NodoJsdom } from "jsdom";
import { describe, expect, it } from "vitest";

const FUENTE_WIDGET = readFileSync(path.join(process.cwd(), "public", "widget.js"), "utf8");
const CLAVE = "cms7uyve40002i8fxlwx7ar7c";
const BASE = "https://back.example";
const STORE_KEY = `aa-chat:${CLAVE}`;

type Respuesta = { text?: string; conversationId?: string };

function montar(respuesta: Respuesta = {}): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cliente.example/",
    runScripts: "dangerously",
  });
  // La config y el ping son best-effort; sólo /api/chat devuelve algo relevante aquí.
  (dom.window as any).fetch = (url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(String(url).includes("/api/chat") ? respuesta : {}),
    });
  return dom;
}

function cargarWidget(dom: JSDOM): void {
  const doc = dom.window.document;
  const script = doc.createElement("script");
  script.setAttribute("data-agent-key", CLAVE);
  Object.defineProperty(script, "src", { value: `${BASE}/widget.js` });
  script.textContent = FUENTE_WIDGET;
  doc.body.appendChild(script);
}

/** Escribe y envía un mensaje, y espera a que se resuelva la cadena de promesas del fetch. */
async function enviar(dom: JSDOM, texto: string): Promise<void> {
  const doc = dom.window.document;
  doc.getElementById("aa-input")!.value = texto;
  doc
    .getElementById("aa-form")!
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function burbujas(dom: JSDOM): NodoJsdom[] {
  return Array.from(dom.window.document.querySelectorAll("#aa-msgs .aa-m"));
}

describe("widget.js — la conversación vive lo que vive la pestaña", () => {
  it("guarda mensajes y conversationId en sessionStorage", async () => {
    const dom = montar({ text: "Encantado, Adrián.", conversationId: "conv-1" });
    cargarWidget(dom);
    await enviar(dom, "Hola, soy Adrián");

    const guardado = JSON.parse(dom.window.sessionStorage.getItem(STORE_KEY)!);
    expect(guardado.conversationId).toBe("conv-1");
    expect(guardado.messages).toEqual([
      { t: "Hola, soy Adrián", c: "aa-user" },
      { t: "Encantado, Adrián.", c: "aa-bot" },
    ]);
  });

  it("no guarda el '...' de la espera", async () => {
    // Una recarga a mitad de petición dejaría unos puntos suspensivos colgados para siempre.
    const dom = montar({ text: "Listo.", conversationId: "conv-1" });
    cargarWidget(dom);
    await enviar(dom, "¿Hacéis CRMs?");

    const guardado = JSON.parse(dom.window.sessionStorage.getItem(STORE_KEY)!);
    expect(guardado.messages.map((m: any) => m.t)).not.toContain("...");
  });

  it("al recargar repinta la conversación y no vuelve a saludar", () => {
    const dom = montar();
    dom.window.sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        conversationId: "conv-1",
        messages: [
          { t: "Hola, soy Adrián", c: "aa-user" },
          { t: "Encantado, Adrián.", c: "aa-bot" },
        ],
      }),
    );
    cargarWidget(dom);

    expect(burbujas(dom).map((b) => b.textContent)).toEqual([
      "Hola, soy Adrián",
      "Encantado, Adrián.",
    ]);

    // El saludo se pinta al abrir el panel sólo si no hay nada: aquí ya hay conversación.
    dom.window.document.getElementById("aa-bubble")!.dispatchEvent(new dom.window.Event("click"));
    expect(burbujas(dom)).toHaveLength(2);
  });

  it("reusa el conversationId guardado en la siguiente petición", async () => {
    const dom = montar({ text: "Sigo aquí." });
    const enviados: any[] = [];
    (dom.window as any).fetch = (url: string, init?: any) => {
      if (String(url).includes("/api/chat")) enviados.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ text: "Sigo aquí." }) });
    };
    dom.window.sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({ conversationId: "conv-1", messages: [{ t: "hola", c: "aa-user" }] }),
    );
    cargarWidget(dom);
    await enviar(dom, "¿seguimos?");

    expect(enviados[0].conversationId).toBe("conv-1");
  });

  it("tres turnos seguidos en la misma pestaña van con el mismo conversationId", async () => {
    // El caso que pidió el usuario: nombre, email y teléfono cada uno en su línea. El servidor
    // fusiona por `conversationId`, así que si el widget no lo arrastrase en CADA turno, la
    // fusión no tendría nada que fusionar y quedarían tres leads sueltos. Aquí se comprueba el
    // extremo del cliente, sin recargar la página en ningún momento.
    const dom = montar();
    const enviados: any[] = [];
    (dom.window as any).fetch = (url: string, init?: any) => {
      if (!String(url).includes("/api/chat")) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      enviados.push(JSON.parse(init.body));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ text: "Anotado.", conversationId: "conv-1" }),
      });
    };
    cargarWidget(dom);

    await enviar(dom, "Me llamo Marta Ibáñez");
    await enviar(dom, "marta.ibanez@tallerlospinos.es");
    await enviar(dom, "600 45 12 90");

    expect(enviados.map((e) => e.message)).toEqual([
      "Me llamo Marta Ibáñez",
      "marta.ibanez@tallerlospinos.es",
      "600 45 12 90",
    ]);
    // El primero no puede llevarlo: la conversación aún no existe y la crea el servidor.
    expect(enviados[0].conversationId).toBeFalsy();
    expect(enviados[1].conversationId).toBe("conv-1");
    expect(enviados[2].conversationId).toBe("conv-1");
  });

  it("un sessionStorage que se niega a escribir no rompe el chat", async () => {
    // Safari en navegación privada lanza al escribir. Un chat que no puede recordar tiene
    // que seguir siendo un chat que funciona.
    const dom = montar({ text: "Respondo igual." });
    Object.defineProperty(dom.window.sessionStorage, "setItem", {
      value: () => {
        throw new Error("QuotaExceededError");
      },
    });
    cargarWidget(dom);
    await enviar(dom, "hola");

    expect(burbujas(dom).map((b) => b.textContent)).toEqual(["hola", "Respondo igual."]);
  });
});

describe("widget.js — enlaces", () => {
  const PRIVACIDAD = "https://3aestudio.vercel.app/privacidad";

  async function responder(dom: JSDOM): Promise<NodoJsdom> {
    cargarWidget(dom);
    await enviar(dom, "¿dónde está la política de privacidad?");
    return burbujas(dom)[1];
  }

  it("pinta el enlace markdown como ancla a pestaña nueva", async () => {
    const dom = montar({ text: `Aquí: [Política de privacidad](${PRIVACIDAD})` });
    const bot = await responder(dom);
    const a = bot.querySelector("a")!;

    expect(a.getAttribute("href")).toBe(PRIVACIDAD);
    expect(a.textContent).toBe("Política de privacidad");
    expect(a.getAttribute("target")).toBe("_blank");
    // Sin noopener, la página que se abre recibe un window.opener vivo hacia la web del
    // cliente. No es decoración.
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("enlaza también una URL suelta, sin llevarse el punto final", async () => {
    const dom = montar({ text: `Está en ${PRIVACIDAD}.` });
    const bot = await responder(dom);

    expect(bot.querySelector("a")!.getAttribute("href")).toBe(PRIVACIDAD);
    expect(bot.textContent).toBe(`Está en ${PRIVACIDAD}.`);
  });

  it("no convierte en enlace un esquema que no sea http(s)", async () => {
    const dom = montar({ text: "[Pulsa aquí](javascript:alert(1))" });
    const bot = await responder(dom);

    expect(bot.querySelector("a")).toBeNull();
    expect(bot.textContent).toBe("[Pulsa aquí](javascript:alert(1))");
  });

  it("escapa el marcado de la etiqueta en vez de ejecutarlo", async () => {
    const dom = montar({ text: `[<img src=x onerror=1>](${PRIVACIDAD})` });
    const bot = await responder(dom);

    expect(bot.querySelector("img")).toBeNull();
    expect(bot.querySelector("a")!.textContent).toBe("<img src=x onerror=1>");
  });
});
