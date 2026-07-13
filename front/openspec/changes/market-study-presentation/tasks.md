# Tasks — Rediseño de presentación del estudio

Orden crítico: F1 → F2 → F3 → F4 (cada fase se commitea y despliega por separado).

## F0 — Exportar CSV
- [x] CSV client-side en `ProspectsTable` (sin anchor sin auth).

## F1 — Claridad/espaciado (solo front)
- [ ] `SectionEditor`: secciones abiertas por defecto + toggle.
- [ ] `prose-dark`: más espaciado (párrafos, encabezados, listas, tablas).
- [ ] Página `[id]`: separación vertical y encabezados de bloque.
- [ ] Verificación: typecheck verde + visual.

## F2 — DAFO 2×2
- [ ] Back: prompt `swot` devuelve `swot` estructurado (4 listas) + markdown; serialización tolerante; tipo.
- [ ] Front: `SwotGrid` (2×2) con fallback a markdown.
- [ ] Verificación: test serialización + typecheck + visual.

## F3 — Competidores en tabla
- [ ] Back: persistir `competitors` estructurados (findCompetitors) + incluir en lectura.
- [ ] Front: `CompetitorsTable` (estética de prospectos, orden, enlace a Maps) con fallback markdown.
- [ ] Verificación: test persistencia/lectura + typecheck + visual.

## F4 — Opciones recomendadas
- [ ] Back: enriquecer prompt de `recommended_options` (inversión/impacto/esfuerzo/siguiente paso).
- [ ] Front: `RecommendedOptionsSection` en tarjetas.
- [ ] Verificación: test estructura options + typecheck + visual.

## Verificaciones finales
- [ ] Todos los tests de market-study verdes (vitest).
- [ ] Estudios antiguos sin datos estructurados no se rompen (fallback markdown).
