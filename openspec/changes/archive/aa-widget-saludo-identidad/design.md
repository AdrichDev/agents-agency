# Diseño — aa-widget-saludo-identidad

## D1 — Corregir el saludo, no retrasarlo

La alternativa evidente es no pintar el saludo hasta que la config resuelva. Se descarta: si
`/api/widget/config` tarda 20 s en un arranque en frío, o falla, el visitante abre el panel y se
encuentra un hueco vacío. Peor que un nombre que se corrige solo.

Se pinta enseguida con lo que haya y se **reescribe** cuando llega la identidad real. `applyConfig()`
ya es el punto por el que pasa toda actualización de identidad — el título se corrige ahí — así que
la corrección del saludo va en el mismo sitio, no en un callback aparte del `fetch`.

## D2 — Acotar qué se puede reescribir

Guardar el nodo del saludo en una variable y reescribirlo sólo si **sigue siendo el único mensaje del
panel**. Dos condiciones, no una:

- referencia al nodo concreto, para no buscar por selector y acertar en otro;
- `msgs.children.length === 1`, para que en cuanto haya conversación real no se toque nada.

Con eso, un visitante que ya escribió no ve nada moverse. Y como el saludo se genera desde una sola
función, el texto no se duplica en dos sitios que puedan divergir.

## D3 — La mezcla de `template`

`Object.assign(config, next)` pisa `config.template` entero con el del servidor. Los defaults se
recuperan mezclando **sobre** los defaults, no sobre el objeto ya pisado:

```js
var plantillaPorDefecto = { position: "right", launcherShape: "circle", panelSize: "normal" };
// …
config.template = Object.assign({}, plantillaPorDefecto, config.template || {});
```

Los defaults se sacan a una constante porque ahora hacen falta dos veces: al inicializar y en cada
mezcla. Tenerlos escritos dos veces es cómo se desincronizan.

## D4 — Qué no cambia

- El back. Ya devuelve `{"name":"AiAs",...}` correctamente, verificado en producción.
- El estilo del fichero: `var`, `function`, sin sintaxis moderna. Es JS servido tal cual a
  navegadores de terceros, sin transpilar.
- El copy del saludo.

## Ficheros

| Fichero | Cambio |
|---|---|
| `back/public/widget.js` | saludo reescribible + mezcla correcta de `template` |
| `back/tests/widget-js-identidad.test.ts` | nuevo: carga el fichero real en jsdom y prueba la carrera |

## Estrategia de prueba

Dos niveles, porque cada uno cubre lo que el otro no puede:

1. **jsdom, en la suite del back.** Carga `public/widget.js` *de verdad* (no una copia), con `fetch`
   simulado y controlable, y comprueba la carrera sin depender de la red ni de un despliegue. Es lo
   que evita que esto se vuelva a romper sin que nadie se entere.
2. **Playwright contra producción.** `prueba-carrera.py`, que retrasa `/api/widget/config` 3 s para
   que la carrera ocurra siempre. Es la prueba que encontró el fallo y la que confirma el arreglo
   sobre el fichero realmente servido por Render.
