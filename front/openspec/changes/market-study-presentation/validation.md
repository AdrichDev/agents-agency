# Validation — Rediseño de presentación del estudio

## User story
Como usuario que revisa un estudio de mercado, quiero que la información se presente clara y
estructurada (DAFO en cuadros, competidores y prospectos en tablas, opciones legibles y CSV
exportable) para entenderla de un vistazo y actuar.

## Acceptance criteria
- CSV se descarga con los prospectos (sin error de auth). ✅ F0
- Las secciones narrativas se ven aireadas y legibles, no apelotonadas. F1
- El DAFO se muestra en 4 cuadros diferenciados. F2
- Los competidores se muestran en tabla ordenada con enlace a Maps. F3
- Las opciones recomendadas se muestran en tarjetas con detalle útil. F4
- Estudios ya generados (sin datos estructurados) siguen mostrándose sin romperse (fallback markdown).

## Scenarios (Given-When-Then)
- **F0**: Given un estudio con prospectos, When pulso "Exportar CSV", Then se descarga un .csv
  con las filas (verificado: generación client-side, sin 401).
- **F1**: Given un estudio con secciones, When abro el detalle, Then las secciones clave se ven
  abiertas y con espaciado legible.
- **F2**: Given un estudio regenerado con DAFO estructurado, When veo la sección DAFO, Then se
  renderiza un grid 2×2. Given un estudio antiguo sin DAFO estructurado, Then se ve el markdown.
- **F3**: Given un estudio con competidores, When veo la sección competidores, Then hay una tabla
  ordenada con enlace a Maps. Sin datos estructurados → markdown.
- **F4**: Given opciones recomendadas, Then se ven como tarjetas con detalle (no lista apretada).

## Tests por tarea
- F1: typecheck verde + revisión visual.
- F2: test de serialización swot estructurado + fallback; visual.
- F3: test de persistencia/lectura de competitors + visual de tabla.
- F4: test del prompt/estructura de options; visual de tarjetas.
