# Design — E2E CRM Flows

## Decisión
Seguir el patrón existente (`agent-wizard.spec.ts`): mock del backend con
`page.route`, sin servidor backend ni BD. Un único handler `**/api/contacts**`
ramifica por URL/método (pending-count, convert-to-clients, DELETE, PATCH, GET
lista). `mockShell` cubre `/api/auth/me` (devuelve user → autenticado) y logout.
Playwright arranca el front en :3100 (webServer del config). Corre en el job
front del CI (no necesita BD).

## Rollback
Solo ficheros de test nuevos. Rollback = borrarlos.
