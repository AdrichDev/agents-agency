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

- [x] T2.1 Gatear los fetch de montaje a sesión lista: en
  `front/components/Sidebar.tsx` (fetch `/api/contacts/pending-count` y
  `/api/config`) y `front/components/ThemeInitializer.tsx` (fetch `/api/config`)
  no llamar `api(...)` hasta `useAuthUser().loading === false && user` — verificado: `front/components/Sidebar.tsx:75-79` gatea el fetch a `!authLoading && user`
- [x] T2.2 Endurecer el interceptor 401 de `front/lib/api.ts`: no
  `signOut`+redirect ante cualquier 401 de fondo — solo cuando la sesión
  realmente no existe (`getSession()` vacío) o en llamadas marcadas
  auth-críticas; un 401 transitorio de un fetch cosmético NO debe desloguear. — verificado: `front/lib/api.ts:92` no desloguea ante un 401 falso positivo
- [x] T2.3 Ocultar el punto de entrada de operator-chat cuando el gateway no
  está configurado (`/api/operator-chat/*` → 503 `OPENCLAW_UNCONFIGURED`):
  detectar el código y no renderizar la UI/menú de operator-chat. — verificado: `front/hooks/useOperatorChat.ts:122` + `front/components/telegram/TelegramWidget.tsx:179` (`operator.unconfigured`)
- [ ] T2.4 `front tsc` limpio; verificar que un 401 transitorio ya no desloguea
  y que el deslogueo legítimo (sesión caducada) sigue funcionando.

## Verificación
- [ ] `front tsc` limpio; QA visual dashboard + `/agents`.
- [ ] Retrocompat: sin cambios de API (salvo `?upcoming&limit` opcional).

## Cierre — 28/07/2026

Cierre por IMPLEMENTADO: existen y están en uso `front/lib/navigation.ts:34` (entrada "Agentes"), `front/components/agents/AgentsGrid.tsx`, `front/app/agents/page.tsx` y los cuatro widgets `front/components/dashboard/{AgendaWidget,BudgetsWidget,InvoicesWidget,PendingContactsWidget}.tsx`. Las tres tareas T2.1, T2.2 y T2.3 quedan marcadas con su prueba en código.

**Casillas sin marcar**: se dejan tal cual a propósito. El resto de casillas describe trabajo cuya prueba concreta en código no se localizó una por una; el bloque de cierre documenta lo que sí está verificado.
