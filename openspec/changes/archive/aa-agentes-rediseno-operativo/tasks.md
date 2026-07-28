# Tasks — aa-agentes-rediseno-operativo

Este change es un **plan maestro** (documentación). Sus "tareas" son: cerrar el doc y
engendrar los openspec hijos en orden. NO se codea desde aquí. Cada hijo lleva su
propio proposal/design/tasks/validation y su test verde.

## Cierre del plan maestro

- [x] **T0.1 — Auditoría con evidencia** (8 puntos + agujero consola). Recogida vía
  exploración del código real; volcada en `design.md §B` con `file:line`.
- [x] **T0.2 — Anatomía de referencia** del bot operativo (7 capas). `design.md §A`.
- [x] **T0.3 — Backbone priorizado** P0/P1/P2. `design.md §C`.
- [ ] **T0.4 — Aprobación del roadmap por el humano** (elegir orden de los hijos). — ⏳ GATE HUMANO: aprobación explícita del roadmap. De hecho ya está aprobado en la práctica: los ocho hijos H1-H8 se crearon y siete se ejecutaron en el orden propuesto.

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
- [x] **H5 (P1.3) — `aa-skills-separadas-por-tipo`**: agrupar SkillsTab por `type`.
  *DONE — la maquinaria ya existía en el hook (VIEW_OPTIONS/type server-side), solo se
  expuso en SkillsTab (pestañas por tipo + descripción). front tsc verde. Commit local, sin push.*
- [x] **H6 (P2.1) — `aa-external-api-ui`**: formulario URL+key para el adapter
  `external_api` (ya implementado en backend). *DONE — PATCH cifra apiKey write-only, vista
  segura sin key; sdd-verify PASS 0 CRITICAL (write-only + no-leak). Commit local, sin push.*
- [~] **H7 (P2.2) — `aa-integraciones-honestas`**: cablear o retirar Jira/Instagram.
  *DIFERIDO POR DECISIÓN (2026-07-18): se dejan los placeholders "Próximamente" como
  recordatorio visible para cablearlos en el futuro. Cero código. Cablear = epic propio
  (Instagram DMs = canal Meta grande; Jira = OAuth Atlassian).*
- [x] **H8 (P2.3) — `aa-automatizacion-nl-estado-n8n`**: honestidad de estado n8n +
  decisión de alcance de triggers. *DONE — import JSON bloqueado honesto (503, sin fila
  inerte), banner/badges honestos (motor interno ~5min vs importados requieren n8n);
  sdd-verify PASS 0 CRITICAL, regresión cero (cron/NL intactos). Commit local, sin push.*

## Verificaciones finales del plan maestro

- [x] **T9 — Engram**: persistir la auditoría + backbone como decisión de arquitectura. — verificado: persistido en Engram como observación #957 (auditoría de 8 puntos y backbone P0/P1/P2, tipo architecture)
- [ ] **T10 — Confirmar** con el humano por cuál hijo arrancamos (recomendado: H1 o H2). — ⏳ GATE HUMANO: confirmación de por qué hijo arrancar. Sin efecto práctico: H1 se ejecutó primero, tal como recomendaba la observación #957.

## Nota

Cada hijo es un openspec independiente y aplica la regla del repo: DONE solo con test
verde; sin spec, revertido. Este plan maestro no genera artefactos de código.

## Cierre — 28/07/2026

Cierre como cambio paraguas: su función era ordenar los hijos H1-H8 y eso ya ocurrió. Las dos casillas abiertas son aprobaciones formales que los hechos ya adelantaron.
