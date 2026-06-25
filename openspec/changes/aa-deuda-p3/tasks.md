# Tareas — aa-deuda-p3

## WU3 — rutas finas (back)
- [ ] T3.1 `routes/landing.ts`: mover la lógica de negocio inline de cada handler a
  funciones en `lib/landing/` (reusar las existentes donde aplique). Handler = parse →
  lib → respond. Sin cambiar rutas/payloads/status.
- [ ] T3.2 `routes/market-studies.ts`: idem hacia `lib/market-study/`.
- [ ] T3.3 Sin imports huérfanos; logging sigue por `logger` (pino).

## WU4 — front mantenibilidad
- [ ] T4.1 Tipar `any` con shape conocido (lib/api + páginas tocadas). No forzar tipos
  inventados: si el shape no es claro, dejar y reportar.
- [ ] T4.2 `app/configuracion/page.tsx`: extraer fetch+estado a hook(s) (patrón
  `useResource`) y partir secciones (tema/colores, identidad/logo, emisor) en
  subcomponentes. UI y comportamiento idénticos.
- [ ] T4.3 `app/clientes/page.tsx`: extraer fetch a hook + filas/modal a subcomponentes.

## Verificación
- [ ] back: `npx tsc --noEmit` limpio + `npm test` (vitest) verde (422/3skip).
- [ ] front: `npx tsc --noEmit` limpio + `npx next build` OK + e2e si existe.
- [ ] `git grep "console\." src` sigue en 0 (no reintroducir console).
