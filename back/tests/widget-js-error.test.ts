// Pruebas del widget embebible frente a un fallo de `/api/chat` (aa-widget-error-visitante).
//
// Cargan `public/widget.js` DE VERDAD dentro de jsdom, como `widget-js-identidad.test.ts`: el
// fichero se sirve tal cual a navegadores de terceros y no pasa por ningún build.
//
// Lo que se ejercita es lo que ve el visitante cuando el chat NO responde. El back ya sanea su
// parte (`visitor-error.ts`), pero este fichero corre en la web de un cliente y no debe pintar
// "undefined", un "Error" pelado ni confundir un 502 del servidor con un fallo de red.
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, type NodoJsdom } from "jsdom";
import { describe, expect, it } from "vitest";

const FUENTE_WIDGET = readFileSync(path.join(process.cwd(), "public", "widget.js"), "utf8");
const CLAVE = "cmq9m0o4k0002n8fx06i31qtq";
const BASE = "https://back.example";

/** Un tick de macrotarea vacía la cola de microtareas del `fetch` simulado. */
function esperarMicrotareas(): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, 0));
}

/**
 * @param respuestaChat qué contesta `/api/chat`. Se pasa como objeto tipo Response a medias, que
 *   es justo lo que hace un servidor real cuando devuelve algo que no es JSON.
 */
function montar(respuestaChat: unknown) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
    url: "https://cliente.example/",
  });
  const doc = dom.window.document;

  dom.window.fetch = (url: string) => {
    if (String(url).includes("/api/chat")) return Promise.resolve(respuestaChat);
    if (String(url).includes("/api/widget/config")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: "AiAs" }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  const script = doc.createElement("script");
  script.setAttribute("data-agent-key", CLAVE);
  Object.defineProperty(script, "src", { value: `${BASE}/widget.js` });
  script.textContent = FUENTE_WIDGET;
  doc.body.appendChild(script);

  const burbuja = doc.querySelector("#aa-bubble") as NodoJsdom;
  const contenedor = doc.querySelector("#aa-msgs") as NodoJsdom;
  const entrada = doc.querySelector("#aa-input") as NodoJsdom & { value: string };
  const formulario = doc.querySelector("#aa-form") as NodoJsdom;

  burbuja.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

  return {
    async enviar(texto: string) {
      entrada.value = texto;
      formulario.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await esperarMicrotareas();
      await esperarMicrotareas();
    },
    /** Texto del último mensaje pintado, que es la respuesta del asistente. */
    ultimoMensaje(): string {
      const hijos = Array.from(contenedor.children) as NodoJsdom[];
      return (hijos[hijos.length - 1]?.textContent ?? "").trim();
    },
  };
}

const GENERICO = "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.";

describe("E8 — el widget pinta el mensaje saneado del back", () => {
  it("un 500 con mensaje genérico se muestra tal cual, sin '...' pendiente", async () => {
    const widget = montar({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: GENERICO, code: "INTERNAL" }),
    });

    await widget.enviar("hola");

    expect(widget.ultimoMensaje()).toBe(GENERICO);
    expect(widget.ultimoMensaje()).not.toBe("...");
  });

  it("un 402 de servicio no disponible también llega al visitante", async () => {
    const widget = montar({
      ok: false,
      status: 402,
      json: () =>
        Promise.resolve({
          error: "Este asistente no está disponible en este momento.",
          code: "SERVICE_LIMIT",
        }),
    });

    await widget.enviar("hola");

    expect(widget.ultimoMensaje()).toBe("Este asistente no está disponible en este momento.");
  });
});

describe("E9 — respuestas que no son JSON o vienen vacías", () => {
  /**
   * Caso real: Render devuelve una página HTML de error en arranque en frío. Antes `r.json()`
   * lanzaba, se caía al `.catch` y se pintaba "Error de conexión" — que es mentira: la conexión
   * funcionó, falló el servidor.
   */
  it("cuerpo HTML (502 de Render) → mensaje del widget, no 'undefined'", async () => {
    const widget = montar({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    });

    await widget.enviar("hola");

    const texto = widget.ultimoMensaje();
    expect(texto).toBe(GENERICO);
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("[object Object]");
  });

  it("JSON vacío → mensaje del widget, nunca la cadena pelada 'Error'", async () => {
    const widget = montar({ ok: false, status: 500, json: () => Promise.resolve({}) });

    await widget.enviar("hola");

    expect(widget.ultimoMensaje()).toBe(GENERICO);
  });

  it("el fallo de red de verdad sí dice que no hay conexión", async () => {
    const widget = montar(Promise.reject(new TypeError("Failed to fetch")));

    await widget.enviar("hola");

    expect(widget.ultimoMensaje()).toBe("No se pudo conectar con el asistente.");
  });

  it("una respuesta buena sigue pintándose igual (no hay regresión del camino feliz)", async () => {
    const widget = montar({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ conversationId: "c1", text: "Hola, ¿en qué te ayudo?" }),
    });

    await widget.enviar("hola");

    expect(widget.ultimoMensaje()).toBe("Hola, ¿en qué te ayudo?");
  });
});
