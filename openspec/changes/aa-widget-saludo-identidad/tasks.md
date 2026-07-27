# Tareas — aa-widget-saludo-identidad

Nivel 2. Un fichero servido a navegadores de terceros, sin build. Reversible.
Una tarea está hecha sólo cuando su prueba está verde.

## T1 — El saludo se corrige cuando llega la identidad real

- [x] **T1.1** Extraer el saludo a una función (`greetingText()`) y guardar el nodo pintado en
      `greetingEl`.
      *Test:* E1 ✅
- [x] **T1.2** En `applyConfig()`, reescribir ese nodo sólo si sigue siendo el único mensaje del
      panel. Dos condiciones: referencia al nodo **y** `msgs.children.length === 1`.
      *Test:* E2 ✅ (se corrige), E2b ✅ (nace correcto si la config llegó antes) y E3 ✅ (no se
      toca una conversación empezada).
- [x] **T1.3** Config caída → saludo por defecto y widget usable.
      *Test:* E4 ✅ y E4b ✅ (config sin `name`: no se pinta `undefined`).

## T2 — Mezcla correcta de `template`

- [x] **T2.1** Defaults en `DEFAULT_TEMPLATE` y mezcla **sobre** ellos, no sobre el objeto ya pisado
      por la respuesta del servidor.
      *Test:* E5 ✅ y E5b ✅.

## T3 — Verificación

- [x] **T3.1** Suite del back en verde: **140/140 ficheros, 1606 pruebas**, 3 saltadas, 0 fallos.
      `tsc --noEmit` limpio. Los `market-study*` pasaron esta vez.
- [x] **T3.2** Revisión antes de commitear. Ver "Hallazgos de la revisión".
- [x] **T3.3** Desplegado en Render (`6ddbb7a` en `master`) y verificado contra producción.
      *Test:* E6 ✅

## Evidencia en producción (T3.3)

`aa-back-jmyo.onrender.com/widget.js` sirviendo el arreglo, embebido desde un dominio ajeno.

| Escenario | Antes | Después |
|---|---|---|
| **E6** — `/api/widget/config` retrasado 3 s, el visitante abre antes (`prueba-carrera.py`) | título `AiAs`, saludo `Hola, soy Asistente…` | título `AiAs`, saludo **`Hola, soy AiAs…`** ✅ |
| **Caso mayoritario** — abre y lee sin escribir (`prueba-abrir.py`) | — | título `AiAs`, saludo `Hola, soy AiAs…`, 1 mensaje ✅ |
| **E9** — conversación real de punta a punta (`prueba.py`) | — | `HTTP 200 /api/chat`, respuesta real del bot ✅ |

**Matiz honesto sobre E9.** En esa corrida el saludo se quedó en `"Asistente"`: el guion escribe
antes de que llegue la config, así que la guarda de AC3 impide reescribir un panel con conversación
empezada. Es el comportamiento diseñado (D2), no un fallo — pero significa que un visitante que
escriba durante el arranque en frío sí se queda con el saludo genérico. Se acepta: mover texto que
el visitante ya está leyendo es peor.

## Hallazgos de la revisión (T3.2)

- **Rojo-verde comprobado.** Con `git show HEAD:public/widget.js` en su sitio, **E2 falla**; con el
  arreglo, pasa. La prueba mide el defecto, no la implementación.
- **E5 es una guarda, no una prueba roja-verde.** El bug de `template` era latente: los defaults
  coinciden hoy con la rama `else` de cada ternario de `applyConfig`, así que no se observa desde el
  DOM. Queda anotado en el propio fichero de pruebas para que nadie lo lea como demostración.
- **Identificadores en inglés.** `widget.js` los tiene todos en inglés; la primera versión metía
  `PLANTILLA_POR_DEFECTO` / `saludoEl` / `textoSaludo`. Renombrados a `DEFAULT_TEMPLATE` /
  `greetingEl` / `greetingText`. Comentarios en español, como el resto del fichero.
- **`jsdom` sin `@types/jsdom`.** El `tsconfig.json` del back declara `lib: ["ES2022"]` y
  `types: ["node"]` a propósito: sin DOM. `@types/jsdom` hace `/// <reference lib="dom" />` y
  metería toda la librería DOM en el programa, con lo que `document.querySelector` compilaría dentro
  de `src/` — código de servidor. En vez de eso, `tests/types/jsdom.d.ts` declara la superficie
  mínima que usan las pruebas.
- **El saludo se reescribe con `renderText`**, que escapa HTML. El nombre del agente viene del
  servidor, así que no se inyecta como `innerHTML` crudo.

## Orden crítico

```
T1 → T2 → T3.1 → T3.2 → [desplegar] → T3.3
```

## Fuera de alcance, anotado como deuda

- ~~`POST /api/widget/ping` falla con `net::ERR_ABORTED`~~ — **descartado el 27/07: no era un
  fallo.** El `fetch` resuelve `HTTP 204` (con y sin `keepalive`), el cliente no ve nada en consola
  y la instalación se sella de verdad en producción. El `ERR_ABORTED` es cómo Playwright reporta una
  respuesta `204 No Content` ya recibida. Detalle en `aa-widget-entrega-cross-origin/tasks.md`.
- ~~El error crudo del proveedor LLM se pinta tal cual en la web del cliente cuando `/api/chat`
  falla~~ — **atacado en `aa-widget-error-visitante`.**
