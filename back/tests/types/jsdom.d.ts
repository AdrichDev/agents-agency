// Tipos mínimos de jsdom para las pruebas del widget embebible.
//
// `jsdom` no publica tipos, y `@types/jsdom` hace `/// <reference lib="dom" />`:
// eso metería toda la librería DOM en el programa del back, y entonces
// `document.querySelector` compilaría dentro de `src/`, que es código de
// servidor y reventaría en Node en tiempo de ejecución. El `tsconfig.json` del
// back declara `lib: ["ES2022"]` a propósito y esa red se respeta.
//
// Se declara aquí sólo la superficie que usan las pruebas.
declare module "jsdom" {
  export interface NodoJsdom {
    id: string;
    tagName: string;
    textContent: string | null;
    innerHTML: string;
    value: string;
    style: Record<string, string>;
    children: ArrayLike<NodoJsdom>;
    setAttribute(nombre: string, valor: string): void;
    getAttribute(nombre: string): string | null;
    querySelector(selector: string): NodoJsdom | null;
    querySelectorAll(selector: string): ArrayLike<NodoJsdom>;
    appendChild(hijo: NodoJsdom): NodoJsdom;
    remove(): void;
    dispatchEvent(evento: unknown): boolean;
  }

  export interface DocumentoJsdom {
    body: NodoJsdom;
    createElement(etiqueta: string): NodoJsdom;
    getElementById(id: string): NodoJsdom | null;
    querySelector(selector: string): NodoJsdom | null;
    querySelectorAll(selector: string): ArrayLike<NodoJsdom>;
  }

  export interface VentanaJsdom {
    document: DocumentoJsdom;
    fetch: unknown;
    // La conversación del widget vive aquí mientras la pestaña esté abierta.
    sessionStorage: {
      getItem(clave: string): string | null;
      setItem(clave: string, valor: string): void;
    };
    Event: new (
      tipo: string,
      opciones?: { bubbles?: boolean; cancelable?: boolean }
    ) => unknown;
  }

  export class JSDOM {
    constructor(html: string, opciones?: { runScripts?: string; url?: string });
    readonly window: VentanaJsdom;
  }
}
