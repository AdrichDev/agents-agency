# Tareas — aa-deuda-p3

## WU3 — rutas finas (back) — COMPLETO
- [x] T3.1 `routes/landing.ts`: YA era thin (cabecera "All domain logic lives in lib/landing/"); 13 handlers = validate → findUnique → lib (`lib/landing/*`) → persist → respond. Sin trabajo pendiente.
- [x] T3.2 `routes/market-studies.ts`: extraídos los 2 bloques de orquestación inline a `generate-orchestrator.ts`: `searchAndMergeProspects` (POST /:id/prospect) y `regenerateStudySection` (POST /:id/sections/:key/regenerate). Handlers = findUnique → orquestador → persist → respond. Rutas/payloads/status idénticos.
- [x] T3.3 Imports huérfanos eliminados del route (tsc limpio); `git grep console src` = 0; sin ficheros nuevos (reuso del orquestador existente).

## WU4 — front mantenibilidad — COMPLETO (trabajo previo, verificado)
- [x] T4.1 `app/configuracion/page.tsx` y `app/clientes/page.tsx`: 0 `any` (verificado). tsc limpio.
- [x] T4.2 `app/configuracion/page.tsx` (145 LOC): fetch+estado en hook `useSystemConfig`; secciones en subcomponentes `AppearanceSection`/`BrandIdentitySection`/`GoogleOAuthSection`. UI idéntica.
- [x] T4.3 `app/clientes/page.tsx` (252 LOC): fetch vía `useResource` + `usePagination`; filas/modal en `ClientRow`/`ClientModal`; UI vía `Table`/`EmptyState`/`Pagination`.

## Verificación
- [x] back: `tsc --noEmit` limpio + `npm test` (vitest) verde (427 pass / 3 skip).
- [x] front: `tsc --noEmit` limpio (WU4 ya refactorizado en trabajo previo; 0 `any` en las páginas objetivo). `next build` no corrido aquí (cubierto por CI).
- [x] `git grep "console\." src` = 0 (back).

## Estado: COMPLETO. WU3 (back) = extracción orquestadores market-studies (esta tanda). WU4 (front) ya estaba refactorizado (hooks+subcomponentes) en trabajo previo, verificado.
