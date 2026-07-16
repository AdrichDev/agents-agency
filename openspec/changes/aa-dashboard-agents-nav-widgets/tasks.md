# Tasks — aa-dashboard-agents-nav-widgets

Front-only (L2). Dos bloques de ficheros disjuntos → paralelizables.

## Bloque 1 — Nav Agentes + Dashboard widgets

- [ ] T1.1 Extraer la grid de agentes de `front/app/dashboard/page.tsx`
  (fetch `GET /api/agents`, `AgentRow`, buscador, filtro de sector, cards,
  `TokenSwitch`) a `front/components/agents/AgentsGrid.tsx` reutilizable
  (prop `limit?` para modo resumen).
- [ ] T1.2 Nueva ruta `front/app/agents/page.tsx` (índice, hoy 404): monta
  `AgentsGrid` a pantalla completa.
- [ ] T1.3 Entrada nav `{ href: "/agents", label: "Agentes" }` en
  `front/lib/navigation.ts` (grupo "Área de Trabajo"); ajustar
  `front/tests/navigation.spec.ts`.
- [ ] T1.4 Refactor `dashboard/page.tsx` a layout de widgets:
  - KPIs vía `front/components/stats/KpiCard.tsx` + `GET /api/stats`
    (reemplaza las tiles a mano).
  - Widget Agenda (`GET /api/agenda/appointments`, próximas N client-side).
  - Widget listado agentes (`<AgentsGrid limit={N} />` + link "ver todos"
    → `/agents`).
  - Widget presupuestos recientes (`GET /api/budgets`).
  - Widget facturas pendientes/vencidas (`GET /api/invoices`,
    `computeInvoiceMetrics`).
  - Widget contactos sin gestionar (`GET /api/contacts/pending-count`).
- [ ] T1.5 `front tsc` limpio; verificación visual (Playwright) del dashboard
  + `/agents`.

## Bloque 2 — Fix 401 (P1) + ocultar operator-chat

- [ ] T2.1 Gatear los fetch de montaje a sesión lista: en
  `front/components/Sidebar.tsx` (fetch `/api/contacts/pending-count` y
  `/api/config`) y `front/components/ThemeInitializer.tsx` (fetch `/api/config`)
  no llamar `api(...)` hasta `useAuthUser().loading === false && user`.
- [ ] T2.2 Endurecer el interceptor 401 de `front/lib/api.ts`: no
  `signOut`+redirect ante cualquier 401 de fondo — solo cuando la sesión
  realmente no existe (`getSession()` vacío) o en llamadas marcadas
  auth-críticas; un 401 transitorio de un fetch cosmético NO debe desloguear.
- [ ] T2.3 Ocultar el punto de entrada de operator-chat cuando el gateway no
  está configurado (`/api/operator-chat/*` → 503 `OPENCLAW_UNCONFIGURED`):
  detectar el código y no renderizar la UI/menú de operator-chat.
- [ ] T2.4 `front tsc` limpio; verificar que un 401 transitorio ya no desloguea
  y que el deslogueo legítimo (sesión caducada) sigue funcionando.

## Verificación
- [ ] `front tsc` limpio; QA visual dashboard + `/agents`.
- [ ] Retrocompat: sin cambios de API (salvo `?upcoming&limit` opcional).
