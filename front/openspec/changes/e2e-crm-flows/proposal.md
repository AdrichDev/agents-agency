# Propuesta — E2E CRM Flows

> Estado: **verified** (pendiente archive + commit) · Nivel estimado: **3** (Grande) · Pilar: 3 (estabilidad)

## Intención

El frontend no tiene cobertura de comportamiento: los refactores de CRM (tablas
ordenables, paginación, modales, conversión a cliente, acciones icono) solo
estaban verificados por `tsc`+`build`. Se añaden E2E (Playwright) siguiendo el
patrón existente (mock del backend con `page.route` → sin backend/DB/auth real),
cubriendo los flujos críticos de `contactos` y `clientes`.

## Alcance
- `tests/helpers.ts`: `mockShell` (auth/me, logout) + factories.
- `tests/contactos.spec.ts`: render tabla, orden por columna, paginación 10/pág,
  modal de información, borrado con confirmación, modo selección → convertir a cliente.
- `tests/clientes.spec.ts`: render, alta (modal), acciones icono editar/eliminar.

## Fuera de alcance
- E2E contra backend real / DB (los specs mockean la API, como los existentes).
- Login real (se mockea `/api/auth/me`).

## Criterios de éxito
- [x] Specs de contactos y clientes verdes en Playwright (chromium).
- [x] Cubren orden, paginación, modal info, borrado+confirm, convertir a cliente.
