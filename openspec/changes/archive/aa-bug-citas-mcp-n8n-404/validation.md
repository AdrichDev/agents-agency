# Validation: aa-bug-citas-mcp-n8n-404

**Historia**: Como operador/agente OpenClaw, necesito que las tools `citas__*` conecten al
reiniciar el gateway, igual que `plataforma__*`, para poder crear/consultar citas sin error.

**AC1**: `docker logs OpenClaw_Agents_3A` tras un reinicio del gateway NO contiene
`failed to start server "citas"`.
**AC2**: `http://n8n:5680/mcp/citas` responde 200 (o el código esperado por el protocolo MCP/SSE)
desde dentro de la red `openclaw_agents_openclaw_net`.
**AC3**: Una llamada de prueba a `citas__disponibilidad` (o equivalente) vía el agente devuelve
datos, no error de tool no disponible.

## Por tarea (Given-When-Then)

### Activar/importar workflow citas en n8n

- **Given** el bundle MCP `citas` fallando con 404,
- **When** se importa/activa el workflow correspondiente en n8n y se reinicia el gateway,
- **Then** el log ya no muestra `failed to start server "citas"`.
  _Test: `docker logs OpenClaw_Agents_3A --tail 50 | grep citas` tras restart, debe estar vacío._

- **Given** el workflow activo,
- **When** se invoca `citas__disponibilidad` desde una sesión del agente,
- **Then** responde con datos reales (no `tool not available` ni timeout).
  _Test: smoke manual vía chat operador o Telegram, una vez el proveedor Gemini esté disponible._
