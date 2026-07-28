# Validation — aa-knowledge-progreso-indexado

## User story

Como operador que indexa la web del negocio, quiero ver que está indexando de verdad —con
puntos suspensivos que se mueven y un porcentaje de avance que sube— y que el estado pase
solo a "Indexada ✓" sin recargar la página, para no dudar de si va bien o está colgado.

## Acceptance criteria

- **AC1**: Mientras indexa, el estado muestra "Indexando" con **puntos suspensivos
  animados** (se mueven), no un texto fijo.
- **AC2**: Se muestra un **porcentaje** (o N/M páginas) que avanza a medida que se procesan
  las páginas, alimentado por `initialIngest.progress` que el backend emite incrementalmente.
- **AC3**: El estado se **refresca solo** (polling ~2s): al terminar pasa a
  "Indexada ✓ (N chunks)" / "Sin contenido ⚠" / "Fallida" **sin recargar la página**.
- **AC4**: El polling se **detiene** al llegar al estado final y al desmontar el componente
  (sin timers colgados); hay un timeout de guarda (~3 min).
- **AC5 (regresión cero / defensivo)**: si el backend aún no emite `progress`, el front
  muestra "Indexando…" animado sin % (no rompe). La ingesta en sí no cambia de resultado.

## Given-When-Then

**Escenario 1 (AC1+AC2+AC3):**
Given una web que tarda ~1 min en indexar
When pulso "Re-indexar"
Then veo "Indexando… 33% (3/9 páginas)" con los puntos moviéndose, el % sube solo, y al
acabar cambia a "Indexada ✓ (N chunks)" sin que yo recargue.

**Escenario 2 (AC4):**
Given una ingesta en curso con polling activo
When cambio de pestaña o se completa
Then el interval se limpia (no queda sondeando en segundo plano).

## Test por tarea
- T1.1 → onProgress (0,total)…(total,total). T1.2 → initialIngest.progress refleja avance.
- T2.1 → ingest-status devuelve status+progress, gated.
- T3.1 → front tsc; pending+progress pinta %; interval se limpia al indexar.

Regla del repo: DONE con test verde (+ HITL visual).
