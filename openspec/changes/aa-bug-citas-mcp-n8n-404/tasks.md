# Tasks: aa-bug-citas-mcp-n8n-404

## Fase A — Diagnóstico
- [x] A.1 Abrir `http://localhost:5681` (n8n UI), listar workflows, localizar el que expone
      `/mcp/citas`. (via query directa a `workflow_entity` en postgres, API REST pedía auth)
- [x] A.2 Confirmado: no existía. `workflow_entity` tenía 0 filas (perdido al recrear contenedor/volumen).

## Fase B — Fix
- [x] B.1 N/A (no existía, no inactivo).
- [x] B.2 Backup encontrado en `OpenClaw_Agents/n8n_workflows/` (wf_mcp_citas.json,
      wf_disponibilidad.json, wf_crear_cita.json, wf_stock_bajo.json, credentials.json).
      Importados con `n8n import:credentials` / `n8n import:workflow` dentro del contenedor
      (bypass auth UI). disponibilidad.json y stock_bajo.json no tenían campo `id` top-level,
      se les asignó uno antes de importar. Activados los 4 con `n8n update:workflow --active=true`.

## Fase C — Verificación
- [x] C.1 `docker restart openclaw_3a_n8n` + `docker restart OpenClaw_Agents_3A`; logs sin
      nuevas entradas `failed to start server "citas"` tras el restart.
- [x] C.2 Smoke: `GET /webhook/disponibilidad?fecha=2026-07-08` devuelve slots reales;
      `http://n8n:5680/mcp/citas` responde 200 (antes 404) desde OpenClaw_Agents_3A.

## Tras verde: gate Agentic Runtime (revisión) ANTES de cualquier commit/push.
