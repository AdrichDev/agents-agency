/**
 * S5 (conversation-persistence, T3) — la sesión del visitante en el widget.
 *
 * Lo que se fija aquí, y por qué:
 *  - **S1/S5 — no reanudar lo que el back va a rechazar.** La copia local de la conversación
 *    lleva una marca de tiempo de última actividad y el widget aplica la MISMA regla que el
 *    servidor (24 h, borde inclusivo). Si la copia es vieja o está cerrada, se borra y se empieza
 *    de cero: el visitante no ve un 410 en el chat.
 *  - **S1/S5 — el 410 se absorbe.** Si el back contesta `410 CONVERSATION_EXPIRED` de todas
 *    formas (TTL del servidor más corto, reloj del cliente mal, conversación cerrada en otra
 *    pestaña), el widget borra su copia y reintenta UNA sola vez el mismo mensaje como
 *    conversación nueva. Nunca un bucle, nunca el error técnico en pantalla.
 *  - **S2/S5 — señal de cierre.** Al cerrar el panel y en `pagehide`, `POST
 *    /api/chat/session-end` con el conversationId en curso: best-effort (keepalive, sin
 *    credenciales, cualquier fallo se ignora) y NUNCA por mensaje.
 *
 * Se carga `public/widget.js` DE VERDAD dentro de jsdom, como `widget-js-sesion.test.ts` y
 * `widget-js-error.test.ts`: el fichero se sirve tal cual a webs de terceros y no pasa por build,
 * así que probar una copia no probaría nada.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM, type NodoJsdom } from "jsdom";
import { describe, expect, it } from "vitest";

const FUENTE_WIDGET = readFileSync(path.join(process.cwd(), "public", "widget.js"), "utf8");
const CLAVE = "cmwidgetsesion0002n8fx0f0rm";
const BASE = "https://back.example";
const STORE_KEY = `aa-chat:${CLAVE}`;
const HORA = 60 * 60 * 1000;
const TTL = 24 * HORA;
const CADUCADA = "Esta conversación ya no está activa. Empieza de nuevo cuando quieras.";
const GENERICO = "Ahora mismo no puedo responder. Inténtalo de nuevo en un momento.";

type Llamada = { url: string; init: Record<string, any> };
type RespuestaChat = { status?: number; body: any };

/** Un mensaje guardado, tal y como lo escribe el widget. */
const guardado = (extra: Record<string, unknown> = {}) => ({
  conversationId: "conv-1",
  messages: [
    { t: "Hola, soy Adrián", c: "aa-user" },
    { t: "Encantado, Adrián.", c: "aa-bot" },
  ],
  ...extra,
});

/**
 * Monta un widget con `/api/chat` respondiendo la secuencia dada (la última se repite) y
 * registra TODAS las llamadas de red para poder afirmar qué se envió y qué no.
 */
function montar(respuestas: RespuestaChat[] = [{ status: 200, body: { text: "Vale." } }]) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://cliente.example/",
    runScripts: "dangerously",
  });

  const llamadas: Llamada[] = [];
  let i = 0;

  (dom.window as any).fetch = (url: string, init: Record<string, any> = {}) => {
    const destino = String(url);
    llamadas.push({ url: destino, init: init || {} });

    if (destino.includes("/api/chat/session-end")) {
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
    }
    if (destino.includes("/api/chat")) {
      const r = respuestas[Math.min(i++, respuestas.length - 1)];
      const status = r.status ?? 200;
      return Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(r.body),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };

  return { dom, llamadas };
}

function cargarWidget(dom: JSDOM): void {
  const doc = dom.window.document;
  const script = doc.createElement("script");
  script.setAttribute("data-agent-key", CLAVE);
  Object.defineProperty(script, "src", { value: `${BASE}/widget.js` });
  script.textContent = FUENTE_WIDGET;
  doc.body.appendChild(script);
}

/** Deja correr la cola de promesas del fetch (y del reintento, que encadena otra). */
async function esperar(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

async function enviar(dom: JSDOM, texto: string): Promise<void> {
  const doc = dom.window.document;
  doc.getElementById("aa-input")!.value = texto;
  doc
    .getElementById("aa-form")!
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
  await esperar();
}

/** Clic en la burbuja: alterna el panel y devuelve el estado en que queda. */
function alternarPanel(dom: JSDOM): string {
  dom.window.document.getElementById("aa-bubble")!.dispatchEvent(new dom.window.Event("click"));
  const panel = dom.window.document.getElementById("aa-panel") as NodoJsdom;
  return panel.style.display;
}

/** El visitante cierra la pestaña o navega fuera: `pagehide` en el `window`. */
function salir(dom: JSDOM): void {
  (dom.window as any).dispatchEvent(new dom.window.Event("pagehide"));
}

function guardar(dom: JSDOM, payload: unknown): void {
  dom.window.sessionStorage.setItem(STORE_KEY, JSON.stringify(payload));
}

function leer(dom: JSDOM): any {
  const raw = dom.window.sessionStorage.getItem(STORE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function burbujas(dom: JSDOM): NodoJsdom[] {
  return Array.from(dom.window.document.querySelectorAll("#aa-msgs .aa-m"));
}

function textos(dom: JSDOM): string[] {
  return burbujas(dom).map((b) => b.textContent ?? "");
}

const chatsEnviados = (llamadas: Llamada[]) =>
  llamadas
    .filter((l) => l.url.endsWith("/api/chat"))
    .map((l) => JSON.parse(String(l.init.body)));

const cierres = (llamadas: Llamada[]) => llamadas.filter((l) => l.url.includes("/session-end"));

// ── S1/S5: al abrir, sólo se reanuda una sesión viva ─────────────────────────

describe("widget.js — la copia local caduca como caduca el servidor", () => {
  it("con más de 24 h de inactividad se borra y la siguiente petición va sin conversationId", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-2", text: "Hola otra vez." } }]);
    guardar(dom, guardado({ t: Date.now() - TTL - 1000 }));

    cargarWidget(dom);

    // No hay conversación que repintar y la copia muerta ya no está.
    expect(burbujas(dom)).toHaveLength(0);
    expect(leer(dom)).toBeNull();

    await enviar(dom, "Hola de nuevo");

    expect(chatsEnviados(llamadas)[0].conversationId).toBeFalsy();
    expect(leer(dom).conversationId).toBe("conv-2");
  });

  it("justo en el borde de 24 h ya caducó (misma lectura inclusiva que el back)", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-2", text: "Hola." } }]);
    guardar(dom, guardado({ t: Date.now() - TTL }));

    cargarWidget(dom);
    expect(leer(dom)).toBeNull();

    await enviar(dom, "¿seguimos?");
    expect(chatsEnviados(llamadas)[0].conversationId).toBeFalsy();
  });

  it("una conversación de hace un rato se reanuda y repinta como siempre", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { text: "Sigo aquí." } }]);
    guardar(dom, guardado({ t: Date.now() - HORA }));

    cargarWidget(dom);

    expect(textos(dom)).toEqual(["Hola, soy Adrián", "Encantado, Adrián."]);

    await enviar(dom, "¿sigues?");
    expect(chatsEnviados(llamadas)[0].conversationId).toBe("conv-1");
  });

  it("una copia sin marca de tiempo y sin cierre se reanuda (compatibilidad)", async () => {
    // Las copias escritas antes de este cambio no llevan `t`: no se puede afirmar caducidad, así
    // que se reanudan como hasta ahora. Borrarlas sería romper sesiones vivas.
    const { dom, llamadas } = montar([{ status: 200, body: { text: "Sigo aquí." } }]);
    guardar(dom, guardado());

    cargarWidget(dom);

    expect(textos(dom)).toHaveLength(2);

    await enviar(dom, "¿sigues?");
    expect(chatsEnviados(llamadas)[0].conversationId).toBe("conv-1");
  });

  it("una copia marcada como cerrada no se reanuda aunque no tenga marca de tiempo", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-2", text: "Hola." } }]);
    guardar(dom, guardado({ closed: true }));

    cargarWidget(dom);

    expect(burbujas(dom)).toHaveLength(0);
    expect(leer(dom)).toBeNull();

    await enviar(dom, "Empezamos");
    expect(chatsEnviados(llamadas)[0].conversationId).toBeFalsy();
  });
});

// ── S1/S5: el 410 se absorbe sin que el visitante lo vea ─────────────────────

describe("widget.js — una conversación muerta se continúa sin que se note", () => {
  it("el 410 CONVERSATION_EXPIRED se reintenta una sola vez como conversación nueva", async () => {
    const { dom, llamadas } = montar([
      { status: 410, body: { error: CADUCADA, code: "CONVERSATION_EXPIRED" } },
      { status: 200, body: { conversationId: "conv-nueva", text: "Claro, dime." } },
    ]);
    guardar(dom, guardado({ t: Date.now() - HORA }));

    cargarWidget(dom);
    await enviar(dom, "Quiero una cita");

    const enviados = chatsEnviados(llamadas);
    // Un reintento exacto: mismo texto, sin el id muerto. Ni uno más.
    expect(enviados).toHaveLength(2);
    expect(enviados[0]).toMatchObject({ message: "Quiero una cita", conversationId: "conv-1" });
    expect(enviados[1]).toMatchObject({ message: "Quiero una cita", conversationId: null });

    // El visitante sólo ve la continuación: lo que ya tenía en pantalla sigue ahí y la respuesta
    // nueva se añade debajo. El texto de sesión caducada no aparece por ningún lado.
    expect(textos(dom).slice(-2)).toEqual(["Quiero una cita", "Claro, dime."]);
    expect(textos(dom).join(" ")).not.toContain(CADUCADA);
    // Y la copia local ya apunta a la conversación nueva.
    expect(leer(dom).conversationId).toBe("conv-nueva");
  });

  it("basta el status 410 aunque la respuesta no traiga código", async () => {
    const { dom, llamadas } = montar([
      { status: 410, body: { error: CADUCADA } },
      { status: 200, body: { conversationId: "conv-nueva", text: "Seguimos." } },
    ]);
    guardar(dom, guardado({ t: Date.now() - HORA }));

    cargarWidget(dom);
    await enviar(dom, "hola");

    expect(chatsEnviados(llamadas)).toHaveLength(2);
    expect(textos(dom).at(-1)).toBe("Seguimos.");
  });

  it("si el reintento también falla se muestra el texto del servidor y NO hay bucle", async () => {
    const { dom, llamadas } = montar([{ status: 410, body: { error: CADUCADA, code: "CONVERSATION_EXPIRED" } }]);
    guardar(dom, guardado({ t: Date.now() - HORA }));

    cargarWidget(dom);
    await enviar(dom, "hola");

    expect(chatsEnviados(llamadas)).toHaveLength(2);
    expect(textos(dom).at(-1)).toBe(CADUCADA);
    // La conversación muerta no queda guardada: la copia local no arrastra su id.
    expect(leer(dom)?.conversationId ?? null).toBeNull();
  });

  it("un error que no es 410 no se reintenta", async () => {
    const { dom, llamadas } = montar([{ status: 500, body: { error: GENERICO, code: "INTERNAL" } }]);

    cargarWidget(dom);
    await enviar(dom, "hola");

    expect(chatsEnviados(llamadas)).toHaveLength(1);
    expect(textos(dom).at(-1)).toBe(GENERICO);
  });
});

// ── S2/S5: señal de cierre, best-effort y sólo al cerrar ─────────────────────

describe("widget.js — cierre de sesión al cerrar el panel", () => {
  it("cerrar el panel manda session-end con el conversationId, keepalive y sin credenciales", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Anotado." } }]);
    cargarWidget(dom);
    await enviar(dom, "Me llamo Adrián");

    expect(alternarPanel(dom)).toBe("flex"); // abrir no cierra nada
    expect(cierres(llamadas)).toHaveLength(0);

    expect(alternarPanel(dom)).toBe("none"); // cerrar sí

    const [cierre] = cierres(llamadas);
    expect(cierre.url).toBe(`${BASE}/api/chat/session-end`);
    expect(cierre.init.method).toBe("POST");
    expect(JSON.parse(String(cierre.init.body))).toEqual({ conversationId: "conv-1" });
    expect(cierre.init.keepalive).toBe(true);
    // Nada de cookies del sitio del cliente en una petición a un tercero.
    expect(cierre.init.credentials).toBe("omit");
  });

  it("no manda la señal por cada mensaje", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Vale." } }]);
    cargarWidget(dom);

    await enviar(dom, "uno");
    await enviar(dom, "dos");
    await enviar(dom, "tres");

    expect(chatsEnviados(llamadas)).toHaveLength(3);
    expect(cierres(llamadas)).toHaveLength(0);
  });

  it("pagehide manda la señal con la conversación en curso", async () => {
    const { dom, llamadas } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Vale." } }]);
    cargarWidget(dom);
    await enviar(dom, "hola");

    salir(dom);

    const [cierre] = cierres(llamadas);
    expect(cierre.init.keepalive).toBe(true);
    expect(JSON.parse(String(cierre.init.body))).toEqual({ conversationId: "conv-1" });
  });

  it("sin conversación no se manda nada (ni al abrir ni al cerrar ni al salir)", async () => {
    const { dom, llamadas } = montar();
    cargarWidget(dom);

    expect(alternarPanel(dom)).toBe("flex");
    expect(alternarPanel(dom)).toBe("none");
    salir(dom);

    expect(cierres(llamadas)).toHaveLength(0);
  });

  it("cerrar borra la copia local: reabrir empieza de cero y sin conversationId", async () => {
    const { dom, llamadas } = montar([
      { status: 200, body: { conversationId: "conv-1", text: "Anotado." } },
      { status: 200, body: { conversationId: "conv-2", text: "Hola otra vez." } },
    ]);
    cargarWidget(dom);
    await enviar(dom, "Me llamo Adrián");

    alternarPanel(dom); // abrir
    alternarPanel(dom); // cerrar

    expect(leer(dom)).toBeNull();
    expect(burbujas(dom)).toHaveLength(0);

    // Reabrir saluda como una sesión nueva.
    expect(alternarPanel(dom)).toBe("flex");
    expect(textos(dom)).toEqual(["Hola, soy Asistente. ¿Cómo te llamas?"]);

    await enviar(dom, "Hola");
    expect(chatsEnviados(llamadas)[1].conversationId).toBeFalsy();
    expect(leer(dom).conversationId).toBe("conv-2");
  });

  it("un fallo de la señal de cierre no rompe el chat (best-effort)", async () => {
    const { dom } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Anotado." } }]);
    const original = (dom.window as any).fetch;
    (dom.window as any).fetch = (url: string, init: Record<string, any>) => {
      if (String(url).includes("/session-end")) return Promise.reject(new TypeError("Failed to fetch"));
      return original(url, init);
    };

    cargarWidget(dom);
    await enviar(dom, "Me llamo Adrián");
    alternarPanel(dom); // abrir
    alternarPanel(dom); // cerrar (la señal falla)

    await enviar(dom, "¿sigues ahí?");
    expect(textos(dom).at(-1)).toBe("Anotado.");
  });
});

// ── La marca de tiempo de la copia local ─────────────────────────────────────

describe("widget.js — la copia local se refresca en cada turno", () => {
  it("un turno bueno actualiza la marca de tiempo de última actividad", async () => {
    const { dom } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Anotado." } }]);
    const antes = Date.now() - 20 * HORA;
    guardar(dom, guardado({ t: antes }));

    cargarWidget(dom);
    await enviar(dom, "¿sigues?");

    const copia = leer(dom);
    expect(typeof copia.t).toBe("number");
    expect(copia.t).toBeGreaterThanOrEqual(Date.now() - 5000);
  });

  it("sigue guardando como mucho 100 mensajes", async () => {
    const { dom } = montar([{ status: 200, body: { conversationId: "conv-1", text: "Vale." } }]);
    const muchos = Array.from({ length: 100 }, (_, i) => ({ t: `mensaje ${i}`, c: "aa-user" }));
    guardar(dom, { conversationId: "conv-1", messages: muchos, t: Date.now() - HORA });

    cargarWidget(dom);
    await enviar(dom, "el 101");

    const copia = leer(dom);
    expect(copia.messages).toHaveLength(100);
    expect(copia.messages.at(-1).t).toBe("Vale.");
  });
});

describe("R3-close-race · una respuesta en vuelo no resucita la sesión cerrada", () => {
  it("descarta la respuesta y no restaura nada si el panel se cerró mientras volaba", async () => {
    const { dom, llamadas } = montar([
      { status: 200, body: { conversationId: "conv-1", text: "Vale." } },
      // La segunda respuesta se controla a mano abajo (promise diferida).
    ]);
    cargarWidget(dom);
    await enviar(dom, "primera");
    expect(alternarPanel(dom)).toBe("flex");

    // Respuesta diferida: cerramos el panel antes de que llegue.
    let resolver: (v: unknown) => void = () => {};
    const enVuelo = new Promise((r) => (resolver = r));
    const win = dom.window as any;
    const originalFetch = win.fetch;
    win.fetch = (url: string, init: any) => {
      if (String(url).includes("/api/chat") && !String(url).includes("session-end")) {
        llamadas.push({ url: String(url), init: init || {} });
        return enVuelo.then((v: any) => ({ ok: true, status: 200, json: () => Promise.resolve(v) }));
      }
      return originalFetch(url, init);
    };
    await enviar(dom, "segunda");
    expect(alternarPanel(dom)).toBe("none"); // cierra y manda session-end

    resolver({ conversationId: "conv-1", text: "tarde" });
    await esperar();

    expect(dom.window.sessionStorage.getItem(STORE_KEY)).toBeNull();
    // Y el siguiente mensaje no reanuda la conversación muerta.
    await enviar(dom, "tercera");
    const chat = llamadas.filter((l) => l.url.includes("/api/chat") && !l.url.includes("session-end"));
    const ultimo = JSON.parse(chat.at(-1)!.init.body);
    expect(ultimo.conversationId).toBeNull();
  });
});
