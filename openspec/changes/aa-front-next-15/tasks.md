# Tasks — aa-front-next-15  (Nivel 3 — APROBADO)

> F3 del plan de versiones. Validación = typecheck + next build (no hay unit suite).

## Fase A — Upgrade
- [x] A.1 `front/package.json`: `next` → `^15.5.19` (= CRM front). `npm install`. React se queda en ^18.3.1.
- [x] A.2 NO hizo falta React 19: Next 15 instaló sin ERESOLVE con React 18.3.1. (F4 sube React aparte.)

## Fase B — Verificación
- [x] B.1 `npm run typecheck` limpio. (2026-06-28)
- [x] B.2 `npm run build` (next build) OK — todas las rutas (static + dynamic) compilan.
- [x] B.3 SIN cambios de código necesarios (pages client useSearchParams, sin cookies/headers async).

## Tras verde: gate Ruflo ANTES de cualquier commit/push.
- [x] Ruflo PASS — bump de framework sin cambios de código; gate = `next build` verde (no hay diff que revisar).
