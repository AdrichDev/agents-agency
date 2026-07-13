# Design — Rediseño de presentación del estudio

## F1 — Claridad/espaciado (solo front)
- `SectionEditor`: las secciones narrativas arrancan **abiertas** (no colapsadas); se
  mantiene el toggle de acordeón para plegar.
- `prose-dark` (globals.css): más separación entre párrafos, encabezados y listas; ancho de
  línea legible; tablas markdown con bordes suaves.
- Página `[id]`: más separación vertical entre bloques; encabezados de bloque claros.

## F2 — DAFO 2×2
- **Back**: en el prompt de `study-generator`, la sección `swot` añade en el JSON un campo
  opcional `swot: { fortalezas: string[], debilidades: string[], oportunidades: string[],
  amenazas: string[] }` además del markdown. Serialización tolerante (si falta, se usa el
  markdown). Tipo `StudySection` gana `swot?`.
- **Front**: `SwotGrid` renderiza 2×2 (Fortalezas/Debilidades arriba, Oportunidades/Amenazas
  abajo) con colores por cuadrante. Si `section.swot` no existe → cae al `SectionEditor` markdown.

## F3 — Competidores en tabla
- **Back**: `findCompetitors` ya devuelve objetos estructurados (nombre, dirección, rating,
  web, etc.). Persistir un array `competitors` en el estudio (columna nueva o dentro de un
  campo JSON) además del markdown de la sección. Endpoint de lectura lo incluye.
- **Front**: `CompetitorsTable` (misma estética que `ProspectsTable`: orden, enlace a Maps,
  columnas claras). La sección `competitors` renderiza la tabla si hay datos; si no, markdown.

## F4 — Opciones recomendadas
- **Back**: enriquecer el prompt de `recommended_options` (más detalle por opción: inversión,
  impacto, esfuerzo, siguiente paso). Mantener el array `options` estructurado.
- **Front**: `RecommendedOptionsSection` con tarjetas claras (título, descripción, métricas,
  CTA), no lista apretada.

## Data-safety
Todos los campos nuevos son OPCIONALES. Estudios existentes sin ellos siguen mostrando el
markdown. Ninguna migración destructiva.

## Test strategy
- Front: typecheck + verificación visual (screenshots) sin romper el dev server del usuario
  (reusar su server o build aislado).
- Back: vitest de serialización (swot/competitors estructurados) + los tests de market-study
  existentes verdes.
