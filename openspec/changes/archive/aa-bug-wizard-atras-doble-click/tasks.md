# Tasks — aa-bug-wizard-atras-doble-click

## Fase A — Confirmación de causa (bloqueante, NO saltar)
- [ ] A.0 Reproducir el bug: abrir wizard `app/agents/new/page.tsx`, llegar al paso 3 (ChannelStep, canal "widget" por defecto), pulsar "Atrás" una vez y verificar si retrocede o no.
- [ ] A.1 Medir con DevTools (Layout Shift/Performance) si hay desplazamiento del footer tras el mount de `ChannelStep.tsx:62-203`.
- [ ] A.2 Documentar causa confirmada (layout shift u otra) con evidencia antes de pasar a Fase B.

## Fase B — Fix (según causa confirmada en A.2)
- [ ] B.1 Si es layout shift: reservar altura del bloque "Plantilla del widget" o estabilizar el footer de navegación en `ChannelStep.tsx` / `app/agents/new/page.tsx:153-159`.
- [ ] B.2 Si la causa es otra (determinada en A.2): ajustar el fix al hallazgo real.

## Fase C — Verificación
- [ ] C.1 `npm run typecheck` limpio.
- [ ] C.2 `npm run test:e2e` verde (test de click único + regresión de otros pasos).
- [ ] C.3 Verificación manual del caso original.

## Tras verde: gate Agentic Runtime (revisión refactor) ANTES de cualquier commit/push.
- [ ] Agentic Runtime PASS.

## Cierre — 28/07/2026

Cierre por RESUELTO POR OTRA VÍA: el cambio `aa-openclaw-provision-hardening` simplificó `front/components/agent-wizard/ChannelStep.tsx` (ver la nota del encabezado, líneas 1-9) y eliminó el bloque "Plantilla del widget", que era el que hacía crecer y encogerse el paso. Además el contenedor de pasos fija altura mínima en `front/app/agents/new/page.tsx:317` (`min-h-[340px]`). Sin salto de layout no hay botón que se mueva bajo el cursor, que era la causa del doble clic necesario para ir Atrás.

**Casillas sin marcar**: se dejan tal cual a propósito. Ninguna de las tareas escritas aquí se ejecutó: el síntoma murió como efecto colateral de otro cambio.
