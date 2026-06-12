# Propuesta — Estadísticas Interactivas + Estudios de Mercado IA (P8)

> Estado: **proposed** · Nivel estimado: **3** · Fase roadmap: **P8**
> Siguiente: `sdd-spec` y `sdd-design` (pueden correr en paralelo).

## Intención

P7 entregó un dashboard agregado de solo lectura (`GET /api/stats`, ventana fija
de 12 meses, sin filtros). Dos carencias:

1. **Sin interactividad**: no se puede cambiar granularidad ni filtrar por
   cliente, producto, agente o estado. El negocio no puede responder "¿cuánto
   facturé en mantenimiento de webs al cliente X este trimestre?".
2. **Sin inteligencia de mercado**: la agencia tiene datos reales (presupuestos
   aceptados, sectores de clientes, pricing) pero ninguna herramienta que los
   convierta en un estudio de mercado accionable ni que descubra prospectos.

**Éxito**: (A) dashboard filtrable y con drill-down; (B) sección "Estudios de
mercado" que genera con IA un estudio profesional editable basado en datos
REALES del negocio, con prospección de negocios sin web vía Google Places.

## Hallazgo de dominio — qué es "producto"

No existe modelo `Product`. El catálogo de servicios está **hardcodeado** en
`front/app/facturacion/page.tsx` (`SERVICE_CATALOG`, 8 items) y se materializa
en `BudgetLine` (`serviceId`, `name`, `implPrice`, `maintPrice`, `quantity`).
Dimensiones reales para filtrar "producto":
- **serviceId / name** de `BudgetLine` (chatbot_*, web_*, automation, hours, tokens).
- **Tipo de ingreso**: `implPrice` (pago único) vs `maintPrice` (recurrente),
  alineado con `Budget.totalImpl` / `totalMaint`.
- **sector** de `Client` (dimensión extra para segmentar).

## Alcance

### Bloque A — Estadísticas interactivas
- `GET /api/stats` parametrizado y **retrocompatible** (sin params = comportamiento
  P7): `period` (year|month|week), `granularity`, `range` (last12m|ytd|all|custom),
  `from`/`to`, `clientId`, `serviceId`, `agentId`, `status`, `sector`.
- Series temporales recalculadas según granularidad/rango.
- Drill-down: desglose de un periodo (click en barra → detalle de ese mes/semana).
- Front: toolbar de filtros combinables sobre el dashboard; gráficos recharts
  reactivos; estados de carga/vacío por filtro.

### Bloque B — Estudios de mercado IA
- Nueva subruta `front/app/estadisticas/estudios` (tab dentro de Estadísticas).
- Formulario IA: zona/código postal, radio de acción, zonas de expansión,
  sectores objetivo, presupuesto medio. Preguntas guiadas con `DEFAULT_MODEL` (mini).
- Generación con `STRONG_MODEL`: DAFO, segmentos, pricing sugerido, plan de
  expansión por zona — **anclado a datos reales** (budgets aceptados, facturación,
  sectores de clientes existentes).
- Modelo `MarketStudy` (Prisma): `inputs` Json, `content` Json (secciones), 
  `prospects` Json, `status`, timestamps. Estudio **editable** por sección y
  **regenerable** sección a sección.
- Prospección Google Places (`GOOGLE_MAPS_API_KEY`): Text/Nearby Search por
  zona+sector → Place Details (`website`) → filtrar negocios SIN web → lista de
  prospectos (nombre, dirección, teléfono, rating, sector) como candidatos a
  servicios (web/chatbot/automatizaciones). Gestionables: contactado/descartado,
  export CSV.
- **Modo degradado sin clave**: estudio sin prospección real + aviso claro
  "requiere GOOGLE_MAPS_API_KEY". NUNCA scraping de Google (ToS).

## Capabilities

### New Capabilities
- `market-studies`: generación IA de estudios de mercado editables, persistencia,
  regeneración por sección y prospección de negocios sin web vía Google Places.

### Modified Capabilities
- `stats-dashboard`: requisitos pasan de vista fija de solo lectura a endpoint
  parametrizado retrocompatible con filtros combinables y drill-down.
  (Nota: spec consolidada de stats-dashboard aún no existe en `openspec/specs/`;
  sdd-spec decide si crea spec nueva o delta.)

## Aproximación y rationale

- **Retrocompatibilidad por defecto**: `/api/stats` sin params = salida P7
  idéntica; los filtros son aditivos. Evita romper la página actual y los tests.
- **Producto = BudgetLine.serviceId + impl/maint**: sin inventar modelo `Product`;
  se usa la dimensión real ya persistida. Sector de `Client` como segmentación.
- **STRONG_MODEL para el estudio, mini para preguntas**: calidad profesional
  donde importa, coste bajo en el formulario guiado. Reutiliza patrón JSON de
  `web-import.ts` (system prompt → JSON estricto → parse defensivo).
- **Places opcional y degradable**: la feature aporta valor sin clave; la
  prospección se aísla detrás del flag de entorno.
- **Estudio como Json de secciones**: edición y regeneración granular sin
  re-generar todo; persistencia simple en un único modelo.

## Affected Areas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `back/src/lib/stats.ts` | Modificado | Parámetros, granularidad, filtros, drill-down |
| `back/src/index.ts` | Modificado | Query params en `/api/stats`; rutas `/api/market-studies*` |
| `back/prisma/schema.prisma` | Modificado | Nuevo modelo `MarketStudy` + migración |
| `back/src/lib/market-studies/*` | Nuevo | Generación IA, Places client, prospección |
| `front/app/estadisticas/page.tsx` | Modificado | Toolbar de filtros + drill-down |
| `front/app/estadisticas/estudios/*` | Nuevo | UI de estudios, editor, prospectos |
| `front/components/stats/*` | Modificado/Nuevo | Filtros, gráficos reactivos |

## Risks

| Riesgo | Prob. | Mitigación |
|--------|-------|------------|
| Coste/cuotas Google Places API | Media | Límite de resultados por búsqueda, caché de Place Details, flag opcional |
| Privacidad de prospectos (datos de negocios) | Media | Solo datos públicos de Places; sin envío de email (fuera de alcance); CSV local |
| IA inventa cifras no respaldadas por datos | Media | Anclar prompt a métricas reales inyectadas; marcar supuestos; estudio editable |
| Romper `/api/stats` actual y tests P7 | Media | Path sin params idéntico a P7; tests de regresión |
| Coste STRONG_MODEL por estudio | Baja | Generación bajo demanda; regeneración por sección, no total |
| Scraping de Google (ToS) | Baja | Prohibido; solo Places API oficial |

## Rollback Plan

- Bloque A: revertir cambios de `stats.ts`/`index.ts`/front; la firma sin params
  garantiza que el dashboard P7 sigue funcionando si se revierte la toolbar.
- Bloque B: feature aislada — eliminar rutas `/api/market-studies*` y la subruta
  front; revertir migración `MarketStudy` (drop table, sin datos críticos).

## Dependencies

- `GOOGLE_MAPS_API_KEY` (opcional; modo degradado sin ella).
- `STRONG_MODEL` (ya configurado en `openai.ts`).
- Migración Prisma para `MarketStudy`.

## Success Criteria

- [ ] `/api/stats` sin params devuelve exactamente la salida P7 (retrocompatible).
- [ ] Filtros por cliente/producto/agente/estado/sector + granularidad recalculan series.
- [ ] Drill-down de un periodo muestra desglose correcto.
- [ ] Se genera un estudio editable basado en datos reales; secciones regenerables.
- [ ] Con `GOOGLE_MAPS_API_KEY`: lista de negocios SIN web por zona+sector.
- [ ] Sin clave: modo degradado con aviso claro; sin errores.
- [ ] Prospectos marcables (contactado/descartado) y exportables a CSV.

## Proposal question round

Sesión no interactiva (apply en paralelo); supuestos a validar antes de spec:

1. **Producto**: se asume `BudgetLine.serviceId`/`name` + dimensión impl/maint
   como "producto", con `Client.sector` como segmentación. ¿Confirmado, o se
   quiere un modelo `Product` de catálogo real?
2. **Granularidad semanal**: ¿semana ISO (lunes) o natural? Se asume ISO.
3. **Estudio — alcance de prospección**: ¿solo negocios SIN website, o también
   marcar los que tienen web pero sin chatbot? Se asume solo sin website (MVP).
4. **Persistencia de estudios**: ¿multiusuario/owner? No hay modelo `User` en el
   schema; se asume estudios globales sin owner.
5. **Drill-down**: ¿desglose por registros individuales o solo por sub-dimensión
   (p.ej. mes → por cliente)? Se asume sub-dimensión agregada (sin listar filas).
