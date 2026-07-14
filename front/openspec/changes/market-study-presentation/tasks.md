# Tasks — Rediseño de presentación del estudio

Orden crítico: F1 → F2 → F3 → F4 (cada fase se commitea y despliega por separado).

## F0 — Exportar CSV
- [x] CSV client-side en `ProspectsTable` (sin anchor sin auth).

## F1 — Claridad/espaciado (solo front)
- [x] `prose-dark` DEFINIDO en globals (no existía → causa raíz del apelotonado).
- [x] `SectionEditor`: secciones abiertas por defecto + toggle.
- [x] Verificación: typecheck verde.

## F2 — DAFO 2×2
- [x] Front: `SwotGrid` parsea el markdown del DAFO a 4 cuadrantes; grid 2×2 con colores;
      fallback a markdown si no hay estructura reconocible (≥3 cuadrantes). Sin cambio de back
      (más robusto que estructurar el prompt con doble parseo).
- [x] Verificación: typecheck verde.

## F3 — Competidores en tabla
- [x] Back: `buildCompetitorSection` adjunta `competitors[]` estructurados a la sección
      (dentro del JSON de sections → SIN migración). Tipo `StudySection.competitors?`.
- [x] Front: `CompetitorsTable` (tabla ordenada, web/email clicables) + análisis; fallback markdown.
- [x] Verificación: typecheck back+front + 28 tests verdes.

## F4 — Opciones recomendadas
- [ ] Back: enriquecer prompt de `recommended_options` (inversión/impacto/esfuerzo/siguiente paso).
- [ ] Front: `RecommendedOptionsSection` en tarjetas.
- [ ] Verificación: test estructura options + typecheck + visual.

## Verificaciones finales
- [ ] Todos los tests de market-study verdes (vitest).
- [ ] Estudios antiguos sin datos estructurados no se rompen (fallback markdown).
