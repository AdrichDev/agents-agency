# Tasks — Estadísticas Interactivas + Estudios de Mercado IA (P8)

> Change: `interactive-stats-market-studies` · Nivel 3
> Orden sugerido: A (backend → front) puede solaparse con B (schema → backend → front).
> Guard de revisión: trabajo grande, **alto riesgo de superar 400 líneas** →
> recomendar PRs encadenados (slice A, slice B-core, slice B-prospección).

## Bloque A — Estadísticas interactivas

### A1. Backend — parámetros y retrocompatibilidad
- [x] A1.1 Definir tipo `StatsQuery` (period, granularity, range, from, to, clientId, serviceId, agentId, status, sector) con validación/defaults.
- [x] A1.2 Refactor `getStats()` → `getStats(query?: StatsQuery)`; sin query = salida P7 idéntica.
- [x] A1.3 Parametrizar ventana temporal: helper de rango (last12m | ytd | all | custom from/to).
- [x] A1.4 Parametrizar granularidad en `$queryRaw` con whitelist: zod enum → `GRANULARITY[g]` → literal unit ANTES de construir `date_trunc`. NUNCA interpolar input del usuario en SQL.
- [x] A1.5 Aplicar filtros WHERE combinables a series, facturación y top agentes (clientId vía `Budget.clientId`, serviceId vía `BudgetLine`, agentId, status, sector vía `Client.sector`).
- [x] A1.6 Endpoint drill-down: desglose de un periodo concreto por sub-dimensión.

### A2. Backend — ruta y validación
- [x] A2.1 Leer y validar query params en `GET /api/stats` (`back/src/index.ts`); sanear valores; rechazar rangos inválidos (400).
- [x] A2.2 Mantener respuesta sin params byte-compatible con P7 (test de regresión).

### A3. Front — toolbar de filtros
- [x] A3.1 Componente `components/stats/StatsFilters.tsx` (selects: periodo/granularidad/rango/cliente/producto/agente/estado/sector + custom date pickers).
- [x] A3.2 Estado de filtros en `estadisticas/page.tsx`; refetch parametrizado a `/api/stats`.
- [x] A3.3 Poblar selects: clientes, agentes (de `/api/stats` o endpoints existentes), catálogo de servicios, sectores, estados.
- [x] A3.4 Estados de carga y vacío por combinación de filtros.

### A4. Front — gráficos reactivos + drill-down
- [x] A4.1 Adaptar `MonthlyLineChart` / `BillingBarChart` / donuts a granularidad variable (label de eje X).
- [x] A4.2 Handler de click en barra/punto → fetch `/api/stats/drilldown` → `components/stats/DrilldownPanel.tsx`.

### A5. Tests A
- [x] A5.1 Test backend: sin params == salida P7.
- [x] A5.2 Test backend: filtros por cliente/producto/estado/sector y granularidad week/month/year.
- [ ] A5.3 Test drill-down devuelve desglose correcto. (integración — requiere BD; cubierto por lógica)

## Bloque B — Estudios de mercado IA

### B1. Schema y migración
- [x] B1.1 Modelo `MarketStudy { id, title, inputs Json, sections Json @default("[]"), prospects Json @default("[]"), status @default("draft"), createdAt, updatedAt }` en `schema.prisma`.
- [x] B1.2 Migración manual idempotente `prisma/migrate-market-study.sql` (patrón `migrate-skill-type-use.sql`); `db:push` + regenerar cliente.
- [x] B1.3 `back/src/lib/service-catalog.ts`: duplicar `SERVICE_CATALOG` (front/back son paquetes separados) + mapa serviceId→candidateServices.

### B2. Backend — generación IA del estudio (`back/src/lib/market-study/`)
- [x] B2.0 `types.ts`: `MarketStudyInputs`, `StudySection {key,title,markdown}`, `Prospect`, `StudyStatus`.
- [x] B2.1 `study-generator.ts` `collectRealData()`: budgets aceptados, facturación impl/maint, sectores de clientes, pricing medio (reutiliza agregaciones de `stats.ts`).
- [x] B2.2 `generateStudy(inputs, realData)` con `STRONG_MODEL`: secciones DAFO/segmentos/pricing/expansión como `[{key,title,markdown}]`. JSON estricto + parse defensivo (patrón `web-import.ts`); anclado a cifras reales inyectadas.
- [ ] B2.3 `generateStudyQuestions(context)` con `DEFAULT_MODEL` (preguntas guiadas del formulario). ← omitido (no requerido por spec R4)
- [x] B2.4 `regenerateSection(studyId, sectionKey)` — regenera una sección sin tocar el resto.

### B3. Backend — prospección Google Places (`market-study/places.ts`)
- [x] B3.1 `isConfigured()` + cliente Places (`GOOGLE_MAPS_API_KEY`): Text Search por zona+sector.
- [x] B3.2 Place Details para obtener `website`; filtrar negocios SIN website.
- [x] B3.3 Mapear a `Prospect` { placeId, name, address, phone, rating, sector, candidateServices, status:"new" }.
- [x] B3.4 Modo degradado sin clave: devolver estudio sin prospección + flag/aviso "requiere GOOGLE_MAPS_API_KEY". NUNCA scraping.
- [x] B3.5 Límites: cap 20 resultados/búsqueda + caché in-memory (TTL) de Place Details; manejo de error de quota.

### B4. Backend — router (`back/src/routes/market-studies.ts`, `Router` mount en index.ts)
- [x] B4.1 CRUD: `POST /api/market-studies`, `GET` (lista/detalle), `PATCH`, `DELETE`.
- [x] B4.2 `POST /:id/generate`; `PATCH /:id/sections/:key` (editar); `POST /:id/sections/:key/regenerate`.
- [x] B4.3 `POST /:id/prospect` (lanzar Places) + `PATCH /:id/prospects/:placeId` (status).
- [x] B4.4 `GET /:id/prospects/export` (CSV).

### B5. Front — UI estudios
- [x] B5.1 Subruta `front/app/estadisticas/estudios/page.tsx` (lista + crear) y `[id]` (detalle).
- [x] B5.2 Tab/navegación dentro de Estadísticas hacia "Estudios de mercado".
- [x] B5.3 Formulario IA (zona/CP, radio, expansión, sectores, presupuesto medio) con preguntas guiadas.
- [x] B5.4 Editor de secciones (textarea markdown + preview con `renderMarkdown()` propio, SIN libs nuevas) + botón "regenerar sección".
- [x] B5.5 Panel de prospectos: tabla, marcar contactado/descartado, botón export CSV.
- [x] B5.6 Aviso visible de modo degradado cuando falta `GOOGLE_MAPS_API_KEY`.

### B6. Tests B
- [x] B6.1 Test generación con datos reales mockeados → JSON con secciones esperadas.
- [x] B6.2 Test prospección: filtra correctamente negocios sin website (Places mockeado).
- [x] B6.3 Test modo degradado sin clave: no lanza error, devuelve aviso.
- [x] B6.4 Test CRUD + regenerar sección. (cubierto en market-study.test.ts)

## Cierre
- [ ] C1 `.env.example`: documentar `GOOGLE_MAPS_API_KEY` (opcional) y `STRONG_MODEL`. ← archivo sin permisos de escritura en este contexto
- [x] C2 Verificar build back + front y tests verdes. (207 tests, tsc clean, next build clean)
- [ ] C3 Pasar a sdd-spec / sdd-design; resolver supuestos de "Proposal question round". ← ya en apply
