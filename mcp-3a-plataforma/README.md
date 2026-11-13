# mcp-3a-plataforma

Prototipo **MCP aislado** para conectar Grok (u otros clientes MCP) con la plataforma **3A Estudio** (`agents-agency` + `crm_creator`).

## Principios de arquitectura

- **Cero acoplamiento**: no importa ni modifica el codigo de runtime de `agents-agency` ni `crm_creator`.
- **Contrato alineado**: las tools siguen el mismo patron que `service-operator` (token, confirmacion en 2 pasos).
- **No genera codigo de chatbots**: invoca `createAgent()` via `POST /service/operator/agentes`.
- **Modo mock por defecto**: funciona sin backend. Live con `MCP_LIVE=true` + token.
- **Transporte stdio**: compatible con Cursor, Claude Desktop, OpenClaw, conectores de Grok, etc.

## Produccion (validado 2026-11-13)

| Recurso | URL |
|---------|-----|
| Front AA | https://3aestudio.vercel.app |
| Back AA | https://aa-back-jmyo.onrender.com |
| Front CRM | https://operaos.vercel.app |
| Back CRM | https://crm-back-ul2b.onrender.com |

Prueba LIVE con token: `agencia_estado` → 200; `crear_agente_chatbot` + `confirmado:true` → **201** (agente real en BD).

## Tools

| Tool | Descripcion |
|------|-------------|
| `agencia_estado` | GET `/service/operator/estado` |
| `listar_clientes` | GET `/service/operator/clientes` |
| `crear_cliente` | POST `/service/operator/clientes` (exige `confirmado`) |
| `crear_agente_chatbot` | POST `/service/operator/agentes` → `createAgent()` (exige `confirmado`) |
| `convertir_lead` | POST `/service/operator/leads/:id/convertir` (exige `confirmado`) |

## Uso

```bash
# Mock (sin backend)
node src/test-client.js
node src/server.js

# Live contra produccion
MCP_LIVE=true \
AA_API_URL=https://aa-back-jmyo.onrender.com \
OPERATOR_SERVICE_TOKEN=<token Render> \
node src/test-client.js
```

## Config cliente MCP

```json
{
  "mcpServers": {
    "3a-plataforma": {
      "command": "node",
      "args": ["/ruta/absoluta/a/mcp-3a-plataforma/src/server.js"],
      "env": {
        "MCP_LIVE": "true",
        "AA_API_URL": "https://aa-back-jmyo.onrender.com",
        "OPERATOR_SERVICE_TOKEN": "…"
      }
    }
  }
}
```

## Estructura

```
mcp-3a-plataforma/
  package.json
  README.md
  src/
    server.js      ← MCP stdio + JSON-RPC
    test-client.js ← prueba end-to-end
```
