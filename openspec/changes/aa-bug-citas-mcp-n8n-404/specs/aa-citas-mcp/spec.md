# Spec delta: bundle MCP `citas`

## UC-1: Gateway OpenClaw conecta al bundle MCP `citas` al arrancar

**Actor**: gateway OpenClaw (`OpenClaw_Agents_3A`).
**Precondición**: `tools.alsoAllow` incluye `citas__crear_cita`, `citas__disponibilidad`,
`citas__stock_bajo`; `n8n` está `healthy` en la misma red Docker.

**Given** el gateway arranca (o se reinicia) con el bundle `citas` configurado hacia
`http://n8n:5680/mcp/citas`,
**When** intenta abrir la conexión SSE del bundle,
**Then** la conexión se establece (sin `Non-200 status code` en el log `[bundle-mcp]`).

**AC-1.1**: `docker logs OpenClaw_Agents_3A` tras un restart NO contiene
`failed to start server "citas"`.
**AC-1.2**: El endpoint `http://n8n:5680/mcp/citas` responde con el protocolo SSE esperado
(no 404) al ser consultado desde dentro de la red `openclaw_agents_openclaw_net`.

## UC-2: Agente invoca una tool de `citas__*` y recibe datos reales

**Actor**: agente `main` (o el operador, vía chat).
**Precondición**: UC-1 satisfecho (bundle conectado).

**Given** el bundle `citas` conectado,
**When** el agente invoca `citas__disponibilidad` (o cualquier tool del bundle) en el curso de
una conversación,
**Then** la tool devuelve un resultado válido del dominio (no error de "tool no disponible" ni
timeout).

**AC-2.1**: Respuesta de la tool sin error de transporte.
**AC-2.2**: El contenido de la respuesta es consistente con el propósito del workflow de citas
(datos de disponibilidad/stock, no un error genérico de n8n).
