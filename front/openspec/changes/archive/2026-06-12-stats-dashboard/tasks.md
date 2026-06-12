# Tasks — Estadísticas / Stats Dashboard (P7)

> Granular, con rutas. Estado inicial: todas pendientes.

## 1. Backend — endpoint agregador

- [x] 1.1 Endpoint `GET /api/stats` en `back/src/index.ts`.
- [x] 1.2 Tarjetas de totales:
  - skills por tipo → `prisma.skill.groupBy({ by: ['type'], _count })`.
  - counts: `agent`, `client`, `lead`, `conversation`, `message`,
    `automation` (`prisma.<model>.count()`).
- [x] 1.3 Series temporales mensuales (últimos 12 meses) sobre `createdAt`
  para `Agent`, `Lead`, `Conversation`, `Budget`.
  Resolver agrupación por mes (probable `$queryRaw` con
  `date_trunc('month', "createdAt")`, ver R2).
- [x] 1.4 Facturación desde `Budget`: por mes y por `status`,
  suma de `totalImpl + totalMaint`.
- [x] 1.5 Top agentes por conversaciones
  (`prisma.conversation.groupBy({ by: ['agentId'], _count })` + nombres de agente,
  limit top 5 — Q2).
- [x] 1.6 Forma de respuesta JSON tipada y documentada (cards, series,
  billing, topAgents).

## 2. Frontend — navegación

- [x] 2.1 Añadir item `{ href: "/estadisticas", label: "Estadísticas",
  icon: "📈" }` en `front/lib/navigation.ts`.

## 3. Frontend — página

- [x] 3.1 Instalar dep front: `recharts`.
- [x] 3.2 Página `front/app/estadisticas/page.tsx` (`"use client"`, `@/lib/api`).
- [x] 3.3 Cards de KPIs (estilo `.card`, `.kicker`).
- [x] 3.4 Gráfico de líneas: series temporales mensuales.
- [x] 3.5 Gráfico de barras apiladas: facturación por mes y estado.
- [x] 3.6 Donut: skills por tipo.
- [x] 3.7 Donut: leads por estado.
- [x] 3.8 Tooltips, leyendas, responsive en todos los gráficos.

## 4. Verificación

- [x] 4.1 `cd back && npm run typecheck` y `npm test` (sin romper tests).
- [x] 4.2 `cd front` build limpio + typecheck.
- [ ] 4.3 Validar respuesta de `/api/stats` con datos reales de la BD.
