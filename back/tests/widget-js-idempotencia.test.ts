// Idempotencia del widget embebible (aa-widget-3a-en-su-propia-web, T3.2).
//
// Dos escenarios reales, no hipotéticos:
//  - El cliente pega el snippet en la cabecera Y en el pie de su plantilla.
//  - Una SPA (la propia web de 3A) monta y desmonta el widget al navegar entre rutas.
//
// En ambos el script se evalúa dos veces sobre el mismo documento. Se carga
// `public/widget.js` DE VERDAD dentro de jsdom, por la misma razón que el resto de
// pruebas del fichero: se sirve tal cual a navegadores de terceros y no pasa por build.
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, type DocumentoJsdom } from "jsdom";
import { describe, expect, it } from "vitest";

const FUENTE_WIDGET = readFileSync(path.join(process.cwd(), "public", "widget.js"), "utf8");
const CLAVE = "cms7uyve40002i8fxlwx7ar7c";
const BASE = "https://back.example";

/** Evalúa `widget.js` una vez sobre `doc`, como haría un `<script src>` del navegador. */
function cargarWidget(dom: JSDOM): void {
  const doc = dom.window.document;
  const script = doc.createElement("script");
  script.setAttribute("data-agent-key", CLAVE);
  // `src` como propiedad propia y no como atributo: así jsdom no intenta descargar el
  // fichero y sí ejecuta el contenido inline, con `document.currentScript` apuntando aquí.
  Object.defineProperty(script, "src", { value: `${BASE}/widget.js` });
  script.textContent = FUENTE_WIDGET;
  doc.body.appendChild(script);
}

function montarDocumento(): { dom: JSDOM; doc: DocumentoJsdom } {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    runScripts: "dangerously",
    url: "https://cliente.example/",
  });
  // El widget hace un ping best-effort al cargar; no es objeto de esta prueba.
  dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  return { dom, doc: dom.window.document };
}

describe("widget.js — una sola instancia por documento", () => {
  it("cargarlo dos veces deja una sola burbuja", () => {
    const { dom, doc } = montarDocumento();

    cargarWidget(dom);
    cargarWidget(dom);

    expect(doc.querySelectorAll("#aa-bubble")).toHaveLength(1);
    expect(doc.querySelectorAll("#aa-panel")).toHaveLength(1);
    expect(doc.querySelectorAll("#aa-style")).toHaveLength(1);
  });

  it("la hoja de estilo lleva id para poder retirarla", () => {
    const { dom, doc } = montarDocumento();

    cargarWidget(dom);

    // Sin id no hay forma de localizarla al desmontar, y los estilos del widget se quedan
    // aplicados sobre la página a la que se navega.
    const estilo = doc.getElementById("aa-style");
    expect(estilo).not.toBeNull();
    expect(estilo?.tagName.toLowerCase()).toBe("style");
    expect(estilo?.textContent).toContain("#aa-bubble");
  });

  it("tras retirar los nodos, volver a cargarlo lo remonta", () => {
    const { dom, doc } = montarDocumento();

    cargarWidget(dom);
    for (const id of ["aa-panel", "aa-bubble", "aa-style"]) doc.getElementById(id)?.remove();
    expect(doc.getElementById("aa-bubble")).toBeNull();

    // La guarda mira `#aa-bubble`: si se retiró, el widget debe poder volver. Es el ciclo
    // que hace `SiteWidget` al entrar y salir de una ruta pública.
    cargarWidget(dom);

    expect(doc.querySelectorAll("#aa-bubble")).toHaveLength(1);
  });
});
