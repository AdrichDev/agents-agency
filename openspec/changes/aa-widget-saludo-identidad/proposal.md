# Propuesta — aa-widget-saludo-identidad

## Intención

El widget se presenta al visitante de la web del cliente como **"Asistente"** en vez de con el nombre
del agente contratado. Es la primera frase que lee un cliente potencial en el sitio del negocio que
nos paga.

## Evidencia

Reproducido de forma determinista retrasando `/api/widget/config` 3 s con Playwright
(`prueba-carrera.py`, que es como pasa en la vida real: Render arranca en frío):

```
saludo al abrir (config aun en vuelo): 'Hola, soy Asistente. ¿Cómo te llamas?'
titulo tras la config:                 'AiAs'
saludo tras la config:                 'Hola, soy Asistente. ¿Cómo te llamas?'
```

El título **sí** se corrige. El saludo **no**: queda fijado. También se observó en el E9 corriente de
`aa-widget-entrega-cross-origin`, sin retraso artificial.

## Causa

`back/public/widget.js`:

- La config real llega asíncrona. `applyConfig()` actualiza el título, pero el saludo ya está pintado
  en el DOM y nada lo revisa.
- El saludo se pinta en el `click` de la burbuja bajo `if (!msgs.children.length)`. Una vez pintado,
  esa guarda impide que se vuelva a tocar — que es justo lo que lo deja mal para siempre.

## Segundo defecto, mismo fichero

Línea 67: `config.template = Object.assign(config.template, config.template || {})`. Se referencia a
sí mismo; lo que quería es mezclar `next.template`. Como el back manda `template: {}`, la línea
anterior (`Object.assign(config, next)`) ya ha pisado `config.template` con `{}` y los defaults
`position` / `launcherShape` / `panelSize` se pierden. Hoy no se nota porque los ternarios de abajo
recaen en el mismo valor por defecto, pero es un fallo latente: en cuanto un default deje de
coincidir con la rama `else` del ternario, la posición o el tamaño del panel cambiarán solos.

## Alcance

**Dentro:** `back/public/widget.js` — corregir el saludo ya pintado cuando llega la identidad real, y
arreglar la mezcla de `template`.

**Fuera:** el `net::ERR_ABORTED` de `POST /api/widget/ping` (deuda aparte, no afecta a lo que ve el
visitante); cualquier cambio de copy del saludo; el back, que ya devuelve el nombre correcto
(`{"name":"AiAs",...}` verificado en producción).

## Riesgos

- **R1 — pisar un mensaje real.** La corrección debe tocar el saludo y sólo el saludo. Si el visitante
  ya escribió, no se toca nada. Se acota exigiendo que el saludo siga siendo el único mensaje.
- **R2 — parpadeo de texto.** El visitante puede ver el nombre cambiar. Es preferible a quedarse con
  el nombre equivocado, y sólo ocurre si abre el panel durante el arranque en frío.
- **R3 — el fichero es JS de navegador sin build.** Nada de sintaxis moderna que rompa navegadores
  viejos: el fichero usa `var` y `function` a propósito. Se respeta.
