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

## Tras verde: gate Ruflo (revisión refactor) ANTES de cualquier commit/push.
- [ ] Ruflo PASS.
