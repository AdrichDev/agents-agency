// Pruebas del widget embebible (aa-widget-saludo-identidad).
//
// Cargan `public/widget.js` DE VERDAD dentro de jsdom, no una copia ni una
// reimplementación: el fichero se sirve tal cual a navegadores de terceros y no
// pasa por ningún build, así que probar otra cosa no probaría nada.
//
// Lo que se ejercita es la carrera real: el visitante abre el panel ANTES de que
// `/api/widget/config` conteste (arranque en frío de Render). El `fetch` está
// simulado con una promesa que se resuelve a mano, así el orden es determinista
// en vez de depender de la latencia.
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, type DocumentoJsdom, type NodoJsdom } from "jsdom";
import { describe, expect, it } from "vitest";

const FUENTE_WIDGET = readFileSync(path.join(process.cwd(), "public", "widget.js"), "utf8");
const CLAVE = "cmq9m0o4k0002n8fx06i31qtq";
const BASE = "https://back.example";

type RespuestaConfig = Record<string, unknown>;

interface Montaje {
  doc: DocumentoJsdom;
  /** Simula el clic del visitante en la burbuja. */
  abrirPanel(): void;
  /** Resuelve `/api/widget/config` con estos datos y deja correr las microtareas. */
  entregarConfig(datos: RespuestaConfig): Promise<void>;
  /** Hace fallar `/api/widget/config`. */
  romperConfig(): Promise<void>;
  /** Simula que el visitante escribe y envía un mensaje. */
  escribirMensaje(texto: string): void;
  mensajes(): NodoJsdom[];
  textoSaludo(): string;
  titulo(): string;
}

/** Un tick de macrotarea vacía la cola de microtareas del `fetch` simulado. */
function esperarMicrotareas(): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, 0));
}

function montar(): Montaje {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
    url: "https://cliente.example/",
  });
  const ventana = dom.window;
  const doc = ventana.document;

  let resolverConfig!: (respuesta: unknown) => void;
  let rechazarConfig!: (error: unknown) => void;
  const promesaConfig = new Promise((resolver, rechazar) => {
    resolverConfig = resolver;
    rechazarConfig = rechazar;
  });
  // El `.catch` del widget se encarga del rechazo, pero Node se queja si nadie
  // ha observado la promesa todavía cuando se rechaza.
  promesaConfig.catch(() => {});

  ventana.fetch = (url: string) => {
    if (String(url).includes("/api/widget/config")) return promesaConfig;
    // ping y /api/chat: no son objeto de esta prueba.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  const script = doc.createElement("script");
  script.setAttribute("data-agent-key", CLAVE);
  // El widget deriva su BASE de `script.src`. Se define como propiedad propia en
  // vez de como atributo para que jsdom no intente descargar el fichero y el
  // contenido inline sí se ejecute (con `document.currentScript` apuntando aquí).
  Object.defineProperty(script, "src", { value: `${BASE}/widget.js` });
  script.textContent = FUENTE_WIDGET;
  doc.body.appendChild(script);

  const burbuja = doc.querySelector("#aa-bubble") as NodoJsdom;
  const contenedor = doc.querySelector("#aa-msgs") as NodoJsdom;

  return {
    doc,
    abrirPanel() {
      burbuja.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    },
    async entregarConfig(datos) {
      resolverConfig({ ok: true, json: () => Promise.resolve(datos) });
      await esperarMicrotareas();
    },
    async romperConfig() {
      rechazarConfig(new Error("config caida"));
      await esperarMicrotareas();
    },
    escribirMensaje(texto) {
      const entrada = doc.querySelector("#aa-input") as NodoJsdom;
      entrada.value = texto;
      const formulario = doc.querySelector("#aa-form") as NodoJsdom;
      formulario.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    },
    mensajes() {
      return Array.from(contenedor.children);
    },
    textoSaludo() {
      return contenedor.querySelector(".aa-bot")?.textContent ?? "";
    },
    titulo() {
      return (doc.querySelector("#aa-head-title") as NodoJsdom).textContent ?? "";
    },
  };
}

describe("widget.js — identidad del agente en el saludo", () => {
  it("E1 — el saludo aparece aunque la config no haya llegado", () => {
    const w = montar();
    w.abrirPanel();

    expect(w.mensajes()).toHaveLength(1);
    expect(w.textoSaludo()).toContain("Asistente");
  });

  it("E2 — el saludo se corrige solo cuando llega la identidad real", async () => {
    const w = montar();
    w.abrirPanel();
    expect(w.textoSaludo()).toContain("Asistente");

    await w.entregarConfig({ name: "AiAs", template: {} });

    expect(w.textoSaludo()).toContain("AiAs");
    expect(w.textoSaludo()).not.toContain("Asistente");
    expect(w.mensajes()).toHaveLength(1);
  });

  it("E2b — si el panel se abre después de la config, el saludo ya nace correcto", async () => {
    const w = montar();
    await w.entregarConfig({ name: "AiAs", template: {} });

    w.abrirPanel();

    expect(w.textoSaludo()).toContain("AiAs");
  });

  it("E3 — una conversación empezada es intocable", async () => {
    const w = montar();
    w.abrirPanel();
    w.escribirMensaje("hola");
    // La respuesta del bot se resuelve por su cuenta; se espera a que el panel
    // quede quieto antes de fotografiarlo, si no la comparación mide el chat y no
    // la llegada de la config.
    await esperarMicrotareas();
    const antes = w.mensajes().map((m) => m.textContent);
    expect(antes.length).toBeGreaterThan(1);

    await w.entregarConfig({ name: "AiAs", template: {} });

    expect(w.mensajes().map((m) => m.textContent)).toEqual(antes);
    // El saludo se queda como estaba: mal, pero intocado. Corregirlo a mitad de
    // conversación sería peor que dejarlo.
    expect(w.textoSaludo()).toContain("Asistente");
  });

  it("E4 — config caída: saludo por defecto y widget usable", async () => {
    const w = montar();
    await w.romperConfig();

    w.abrirPanel();

    expect(w.textoSaludo()).toContain("Asistente");
    expect(w.titulo()).toBe("Asistente");
    expect(w.doc.querySelector("#aa-input")).not.toBeNull();
  });

  it("E4b — config sin nombre: no se pinta 'undefined' al visitante", async () => {
    const w = montar();
    w.abrirPanel();

    await w.entregarConfig({ template: {} });

    expect(w.textoSaludo()).toContain("Asistente");
    expect(w.textoSaludo()).not.toContain("undefined");
  });
});

describe("widget.js — mezcla de template", () => {
  // GUARDA, no prueba roja-verde: hoy los defaults coinciden con la rama `else`
  // de cada ternario de `applyConfig`, así que el bug de la mezcla era latente y
  // no se observaba desde el DOM. Esto fija el render correcto para que, si
  // alguien cambia un default, la divergencia salte aquí.
  it("E5 — los defaults sobreviven a una config con template vacío", async () => {
    const w = montar();
    await w.entregarConfig({ name: "AiAs", template: {} });

    const burbuja = w.doc.querySelector("#aa-bubble") as NodoJsdom;
    const panel = w.doc.querySelector("#aa-panel") as NodoJsdom;

    expect(burbuja.style.right).toBe("24px");
    expect(burbuja.style.left).toBe("");
    expect(burbuja.style.borderRadius).toBe("50%");
    expect(panel.style.width).toBe("360px");
  });

  it("E5b — el template del servidor manda sobre los defaults", async () => {
    const w = montar();
    await w.entregarConfig({
      name: "AiAs",
      template: { position: "left", launcherShape: "rounded", panelSize: "wide" },
    });

    const burbuja = w.doc.querySelector("#aa-bubble") as NodoJsdom;
    const panel = w.doc.querySelector("#aa-panel") as NodoJsdom;

    expect(burbuja.style.left).toBe("24px");
    expect(burbuja.style.borderRadius).toBe("14px");
    expect(panel.style.width).toBe("440px");
  });

  it("E6 — el título muestra el nombre real (no se rompe lo que ya iba bien)", async () => {
    const w = montar();
    await w.entregarConfig({ name: "AiAs", template: {} });

    expect(w.titulo()).toBe("AiAs");
  });
});
