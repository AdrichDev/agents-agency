# Validation — aa-agentes-rediseno-operativo

Este change es documentación (plan maestro), no código. La "validación" es que el doc
baja a tierra el producto de forma accionable, no que pase tests de software.

## User story

Como dueño del producto AA, quiero un plan maestro que mapee cómo se monta un bot
operativo de verdad, contraste el estado actual con evidencia, y priorice los arreglos
en un backbone ejecutable, para dejar de crear agentes a ciegas y atacar el rediseño
por la columna vertebral sin hundir el producto intentándolo todo a la vez.

## Acceptance criteria

- **AC1**: El doc incluye la anatomía de referencia (7 capas) de un bot operativo con
  ejemplos del sector. → `design.md §A`.
- **AC2**: Cada uno de los 8 puntos de queja está auditado con evidencia `file:line`
  real (no suposición). → `design.md §B` + `proposal.md`.
- **AC3**: El backbone está priorizado P0/P1/P2 con justificación de impacto. →
  `design.md §C`.
- **AC4**: Existe un roadmap de openspec hijos, uno por pieza, con orden propuesto. →
  `tasks.md`.
- **AC5**: El doc NO contiene código ni migraciones; solo plan. Cada hijo aplicará la
  regla de test-verde por separado.

## Given-When-Then

**Escenario 1 (AC2, evidencia real):**
Given la queja "conocimiento indexado con 0 chunks"
When se audita el pipeline
Then el doc apunta la causa raíz con `file:line` (`service.ts:233-234` estado que
miente + `web.ts:20-25` sin render JS + `embeddings.ts:48` filtro <50), no una hipótesis.

**Escenario 2 (AC3, priorización):**
Given los 8 puntos + el agujero de la consola
When se prioriza
Then la consola de pruebas y el RAG real quedan en P0 (columna vertebral) y el resto en
P1/P2, con el principio "un hijo a la vez, P0 primero".

## Definición de DONE de este change

- [x] Los 4 documentos existen y son coherentes entre sí.
- [ ] El humano aprueba el roadmap y elige el hijo por el que arrancar.
- [ ] La auditoría + backbone quedan persistidos en Engram (decisión de arquitectura).

Regla del repo: los changes hijos que sí tocan código aplican "DONE solo con test verde".
