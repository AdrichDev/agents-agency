# Proposal: bundle MCP `citas` responde 404 en n8n (aa-bug-citas-mcp-n8n-404)

**Nivel Gru: 1 — Pequeño.** Un solo servicio (n8n), fix reversible (importar/activar workflow).

## Contexto

Diagnosticado 07/07/2026 durante verificación en vivo de `aa-centro-mando-agenda-telegram`
(tasks 5.5e/5.5d) tras reinicio de contenedores. Se detectó y corrigió primero un bug de red
Docker (`openclaw_3a_n8n` y `openclaw_3a_mcp_plataforma` pegados a red vieja
`openclaw_agents_openclaw_3a_net`, DNS `ENOTFOUND`) mediante
`docker compose up -d --force-recreate n8n mcp-plataforma` + `docker compose restart openclaw`.

Tras ese fix, `plataforma__*` conecta correctamente, pero el bundle MCP `citas` sigue fallando:

```
[bundle-mcp] failed to start server "citas" (http://n8n:5680/mcp/citas): Error: SSE error: Non-200 status code (404)
```

`n8n` está `healthy` (`/healthz` → 200), pero el endpoint `/mcp/citas` no existe — el workflow
que expone ese path MCP no está importado o no está activo en la instancia n8n tras el
force-recreate (el volumen `openclaw_3a_n8n_data` persiste, pero la activación de workflows no
es automática en n8n).

## Intención

Que el bundle MCP `citas` (herramientas `citas__crear_cita`, `citas__disponibilidad`,
`citas__stock_bajo`, ya presentes en `tools.alsoAllow`) conecte y responda, igual que
`plataforma__*`.

## Alcance

- Verificar en la UI de n8n (`http://localhost:5681`) si el workflow que expone `/mcp/citas`
  existe y está activo.
- Si no existe: localizar su definición (export JSON o repo) e importarlo.
- Si existe pero inactivo: activarlo.
- Confirmar con `docker logs OpenClaw_Agents_3A` (reinicio del gateway) que el bundle `citas`
  arranca sin error.

## Fuera de alcance

- Cambios al contenido/lógica del workflow de citas en sí.
- El bug de red Docker (`ENOTFOUND`), ya resuelto — no forma parte de este change.

## Open questions

- ¿El workflow de citas vive versionado en algún repo (n8n export JSON) o solo existe en el
  volumen Docker de una instancia previa que se perdió?
