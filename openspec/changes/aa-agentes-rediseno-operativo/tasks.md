# Tasks — aa-agentes-rediseno-operativo

Este change es un **plan maestro** (documentación). Sus "tareas" son: cerrar el doc y
engendrar los openspec hijos en orden. NO se codea desde aquí. Cada hijo lleva su
propio proposal/design/tasks/validation y su test verde.

## Cierre del plan maestro

- [x] **T0.1 — Auditoría con evidencia** (8 puntos + agujero consola). Recogida vía
  exploración del código real; volcada en `design.md §B` con `file:line`.
- [x] **T0.2 — Anatomía de referencia** del bot operativo (7 capas). `design.md §A`.
- [x] **T0.3 — Backbone priorizado** P0/P1/P2. `design.md §C`.
- [ ] **T0.4 — Aprobación del roadmap por el humano** (elegir orden de los hijos).

## Roadmap de openspec hijos (orden propuesto)

Orden por impacto/dependencia. Un hijo a la vez.

- [x] **H1 (P0.1) — `aa-agente-consola-pruebas`**: playground pre-publicación con
  trazas de tools + chunks + coste. *DONE — verde + sdd-verify PASS (2 CRITICAL resueltos).
  Commit local 218b41b, sin push. Migración es_prueba aplicada a prod.*
- [x] **H2 (P0.2) — `aa-rag-extraccion-estatica-honesta`**: (REENCUADRADO — verificado que
  fpeuroformac.com NO es SPA, es WordPress con el texto en el HTML; NO hace falta render JS
  ni Chromium). Extracción estática robusta (readability) + estado honesto (no "indexed" con
  0 chunks) + fetch sin tragar errores + filtro `<50` + retrieval visible. *DONE — verde +
  sdd-verify PASS (CRITICAL #7 contaminación resuelto). Commit local 91dda29, sin push. Sin migración.*
- [x] **H3 (P1.1) — `aa-wizard-canal-aware-limpieza`**: quitar `skillIds` inerte,
  canales según aplican, renombrar "Solo API".
- [x] **H4 (P1.2) — `aa-telegram-chatid-autocaptura`**: capturar chat_id del dueño vía
  deep-link `t.me/<bot>?start=<token>` (pairing single-use, sin migración). *DONE — verde +
  sdd-verify PASS (0 CRITICAL, seguridad del token trazada). Commit local, sin push.*
- [ ] **H5 (P1.3) — `aa-skills-separadas-por-tipo`**: agrupar SkillsTab por `type`.
- [ ] **H6 (P2.1) — `aa-external-api-ui`**: formulario URL+key para el adapter
  `external_api` (ya implementado en backend).
- [ ] **H7 (P2.2) — `aa-integraciones-honestas`**: cablear o retirar Jira/Instagram.
- [ ] **H8 (P2.3) — `aa-automatizacion-nl-estado-n8n`**: honestidad de estado n8n +
  decisión de alcance de triggers.

## Verificaciones finales del plan maestro

- [ ] **T9 — Engram**: persistir la auditoría + backbone como decisión de arquitectura.
- [ ] **T10 — Confirmar** con el humano por cuál hijo arrancamos (recomendado: H1 o H2).

## Nota

Cada hijo es un openspec independiente y aplica la regla del repo: DONE solo con test
verde; sin spec, revertido. Este plan maestro no genera artefactos de código.
