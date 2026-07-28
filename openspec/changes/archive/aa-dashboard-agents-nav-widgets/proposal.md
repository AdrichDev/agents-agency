# Proposal — aa-dashboard-agents-nav-widgets

## Intent
Mejorar la UX del panel de AA (estilo OperaOS): un nav/índice dedicado a
**Agentes** y un **Dashboard con widgets** de datos reales; y arreglar un bug
P1 de sesión detectado en QA.

## Scope
1. **Fix 401 (P1)**: un race entre el montaje de `Sidebar`/`ThemeInitializer`
   y la hidratación de la sesión Supabase dispara fetches sin token → 401; el
   interceptor global de `front/lib/api.ts` desloguea ante CUALQUIER 401 →
   puede echar a un usuario recién logueado. Gatear los fetch de montaje a
   sesión lista + que el interceptor solo deslogue en llamadas auth-críticas.
2. **Nav "Agentes" + `/agents`**: hoy `/agents` da 404 (no hay `page.tsx`
   índice). Crear la ruta índice reutilizando la grid de agentes que ya vive en
   `dashboard/page.tsx` (extraída a `AgentsGrid`), y añadir la entrada nav.
3. **Widgets del Dashboard**: KPIs (`/api/stats` vía `KpiCard`), Agenda
   próximas citas (`/api/agenda/appointments`), listado agentes (`AgentsGrid`
   recortado + "ver todos"), presupuestos recientes (`/api/budgets`), facturas
   pendientes (`/api/invoices`), contactos sin gestionar
   (`/api/contacts/pending-count`).
4. **Ocultar UI de operator-chat** cuando el gateway OpenClaw no está
   configurado (`/api/operator-chat/*` responde 503 `OPENCLAW_UNCONFIGURED`) —
   no mostrar un feature muerto.

## Risks / dependencies
- Front-only salvo un back opcional aditivo (`?upcoming&limit` en
  `/api/agenda/appointments`); si no, el corte a "próximas N" es client-side.
- Retrocompat: reutilizar `AgentRow`/endpoints existentes, sin cambios de API.
- El fix del interceptor 401 no debe romper el deslogueo legítimo (sesión
  realmente caducada) — solo evitar el falso positivo por race en fetch de fondo.

## Out of scope
- Activar operator-chat en prod (env Render) y managed_db — decisión de infra.
