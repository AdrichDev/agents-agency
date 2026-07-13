# Proposal — Rediseño de presentación del estudio de mercado

## Intent
La vista de resultado del estudio (`/estudios-mercado/[id]`) se ve apelotonada: todas las
secciones son markdown en acordeones colapsados. Mejorar drásticamente la presentación y la
utilidad de los datos clave.

## Scope
Por fases (cada una es independiente y desplegable):

- **F0. Exportar CSV** — YA HECHO (client-side, sin auth por anchor). ✅
- **F1. Claridad/espaciado** (solo front): secciones narrativas abiertas por defecto, más
  aire, tipografía legible (`prose-dark`), cards separadas.
- **F2. DAFO en cuadros 2×2**: el LLM devuelve DAFO estructurado (fortalezas / debilidades /
  oportunidades / amenazas) + componente grid en front. Fallback al markdown si no hay
  estructura.
- **F3. Competidores en tabla** (como prospectos): back persiste competidores estructurados
  (findCompetitors ya los produce) + `CompetitorsTable` front.
- **F4. Opciones recomendadas** más ricas: mejorar el prompt de opciones + mejor render.

## Out of scope
- Cambios en la prospección/geocoding (ya resueltos).
- Cambios en el motor LLM/effort (ya resueltos).

## Risks
- F2/F3 tocan el contrato de datos (sections/competitors). Mitigación: campos NUEVOS y
  opcionales + fallback al markdown existente → los estudios ya generados no se rompen.
- Cambios de prompt pueden variar el formato de salida. Mitigación: parseo tolerante + fallback.

## Dependencies
- Places API (competidores estructurados) — ya configurada.
- Modelo LLM con routing por-modelo — ya en producción.
