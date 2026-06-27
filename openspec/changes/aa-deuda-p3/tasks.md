# Tareas — aa-deuda-p3

## WU3 — rutas finas (back) — COMPLETO
- [x] T3.1 `routes/landing.ts`: YA era thin (cabecera "All domain logic lives in lib/landing/"); 13 handlers = validate → findUnique → lib (`lib/landing/*`) → persist → respond. Sin trabajo pendiente.
- [x] T3.2 `routes/market-studies.ts`: extraídos los 2 bloques de orquestación inline a `generate-orchestrator.ts`: `searchAndMergeProspects` (POST /:id/prospect) y `regenerateStudySection` (POST /:id/sections/:key/regenerate). Handlers = findUnique → orquestador → persist → respond. Rutas/payloads/status idénticos.
- [x] T3.3 Imports huérfanos eliminados del route (tsc limpio); `git grep console src` = 0; sin ficheros nuevos (reuso del orquestador existente).

## WU4 — front mantenibilidad
- [ ] T4.1 Tipar `any` con shape conocido (lib/api + páginas tocadas). No forzar tipos
  inventados: si el shape no es claro, dejar y reportar.
- [ ] T4.2 `app/configuracion/page.tsx`: extraer fetch+estado a hook(s) (patrón
  `useResource`) y partir secciones (tema/colores, identidad/logo, emisor) en
  subcomponentes. UI y comportamiento idénticos.
- [ ] T4.3 `app/clientes/page.tsx`: extraer fetch a hook + filas/modal a subcomponentes.

## Verificación
- [x] back: `tsc --noEmit` limpio + `npm test` (vitest) verde (427 pass / 3 skip).
- [ ] front: pendiente (WU4 no abordado en esta tanda).
- [x] `git grep "console\." src` = 0 (back).

## Estado: WU3 (back) COMPLETO. WU4 (front) PENDIENTE — refactor de configuracion/clientes a hooks+subcomponentes, front AA sin tests unit (validación tsc+next build).
