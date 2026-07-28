# Validación — aa-widget-saludo-identidad

## Historia de usuario

**Como** negocio que ha contratado un agente,
**quiero** que el asistente de mi web se presente con **su** nombre,
**para** que el visitante vea mi marca y no un genérico que parece una plantilla sin terminar.

## Criterios de aceptación

- **AC1** — Si el visitante abre el panel **antes** de que llegue `/api/widget/config`, el saludo se
  pinta igualmente (nunca un panel vacío).
- **AC2** — Cuando llega la config, ese saludo pasa a decir el nombre real del agente.
- **AC3** — Si el visitante ya ha escrito, la llegada de la config **no** toca ningún mensaje.
- **AC4** — Si `/api/widget/config` falla, el saludo se queda con el nombre por defecto y el widget
  sigue usable.
- **AC5** — Los defaults de `template` (`position`, `launcherShape`, `panelSize`) sobreviven a una
  config del servidor con `template: {}`.
- **AC6** — El título de la cabecera sigue mostrando el nombre real (no se rompe lo que ya iba bien).

## Escenarios

**E1 — el saludo aparece aunque la config no haya llegado (AC1)**
*Dado* un widget cuyo `/api/widget/config` aún está en vuelo,
*cuando* el visitante abre el panel,
*entonces* hay un mensaje de saludo visible.

**E2 — el saludo se corrige solo (AC2)**
*Dado* el saludo ya pintado con el nombre por defecto,
*cuando* llega la config con `name: "AiAs"`,
*entonces* el saludo pasa a contener `"AiAs"` y deja de contener `"Asistente"`.

**E3 — una conversación empezada es intocable (AC3)**
*Dado* que el visitante ya ha mandado un mensaje,
*cuando* llega la config,
*entonces* ningún mensaje del panel cambia de texto.

**E4 — config caída, widget vivo (AC4)**
*Dado* que `/api/widget/config` responde error,
*cuando* el visitante abre el panel,
*entonces* ve el saludo con el nombre por defecto y puede escribir.

**E5 — los defaults de template sobreviven (AC5)**
*Dado* una config del servidor con `template: {}`,
*cuando* se aplica,
*entonces* `position` sigue siendo `"right"`, `launcherShape` `"circle"` y `panelSize` `"normal"`.

**E6 — en producción, con la carrera forzada (AC2, AC6)**
*Dado* el `widget.js` realmente servido por Render y `/api/widget/config` retrasado 3 s,
*cuando* el visitante abre el panel antes de que llegue,
*entonces* al llegar la config **tanto el título como el saludo** dicen `"AiAs"`.

## Prueba por tarea

| Tarea | Prueba |
|---|---|
| T1 saludo reescribible | `widget-js-identidad.test.ts`: E1, E2, E3, E4 |
| T2 mezcla de `template` | `widget-js-identidad.test.ts`: E5 |
| T3 verificación en producción | `prueba-carrera.py` con Playwright: E6 |
