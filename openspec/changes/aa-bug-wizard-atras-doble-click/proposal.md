# Proposal — Botón "Atrás" del wizard requiere doble click (aa-bug-wizard-atras-doble-click)

**Nivel Gru: 1 — Pequeño.** Un componente front, pero causa raíz sin confirmar todavía.

## Contexto
El diagnóstico previo (debounce/validación faltante) **no está confirmado**. Realidad verificada: `front/app/agents/new/page.tsx:153-159`, el botón "Atrás" usa `onClick` directo `setStep(c => Math.max(1, c-1))`, con `disabled` solo cuando `step===1`. No hay debounce ni guard en el código.

Causa probable (sin confirmar): un layout shift. `front/components/agents/ChannelStep.tsx` (paso 3) renderiza por defecto el bloque "Plantilla del widget" (líneas 62-203), visible porque `channel` inicial es `"widget"`. Ese bloque desplazaría el footer de navegación justo después del mount, de forma que el primer click en "Atrás" aterriza en una posición del footer que aún no se asentó (el click "cae" antes de que el layout final esté listo), y por eso parece necesitar doble click.

## Intención
Que "Atrás" funcione siempre al primer click, sin depender de si el layout ya se asentó.

## Alcance
- **T0 (bloqueante)**: reproducir y confirmar la causa real con DevTools (Layout Shift / Performance panel, o grabación de replay) ANTES de tocar código. No fijar el fix sin esta confirmación.
- Si se confirma layout shift: reservar altura del bloque "Plantilla del widget" (o del footer) para evitar el desplazamiento tras el mount, o estabilizar la posición del footer de navegación de otra forma.
- Si T0 revela otra causa (p. ej. doble binding de evento, re-render que resetea el handler): ajustar el alcance del fix a la causa real encontrada.

## Fuera de alcance
- Rediseño del wizard de creación de agentes.
- Fix especulativo sin confirmación de causa (explícitamente prohibido por este proposal).

## Open questions (resolver en T0, bloqueante)
- ¿Es realmente un layout shift del bloque "Plantilla del widget" en `ChannelStep.tsx`? ¿O es otra causa (doble listener, timing de render, StrictMode double-invoke en dev)? No fijar fix hasta confirmar con evidencia (grabación, medición de layout shift, o log de clicks).

## Riesgos
- Bajo, cambio acotado a un componente. El riesgo real es fijar un fix equivocado si no se confirma la causa en T0 — de ahí el bloqueo explícito.
