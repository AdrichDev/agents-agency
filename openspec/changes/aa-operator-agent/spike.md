# Spike F0 — Operator Agent (03/07/2026)

Verificado en vivo contra OpenClaw 2026.6.11 (contenedor `OpenClaw_Agents`).

## 1. Multi-agente + routing por canal: SÍ, nativo

- CLI `openclaw agents add|bind|bindings|unbind` — "Manage isolated agents
  (workspaces + auth + routing)".
- Binding: `openclaw agents bind --agent <id> --bind <channel[:accountId]>`.
- Estado actual: 1 solo agente (`main` = Recepción Estudio 3A, workspace
  `~/.openclaw/workspace`), 0 bindings → todo canal cae al default.
- Topología elegida: agente `operator` nuevo con workspace propio, binding
  explícito de su canal; `main` sigue siendo default para el resto.

## 2. Segundo bot de Telegram: soportado por diseño, pendiente prueba real

- `openclaw channels add` = "Add or update a channel **account**" (multi-cuenta
  por canal); bindings aceptan `telegram:<accountId>`; status muestra
  "Telegram **default**" (implica cuentas nombradas adicionales).
- Falta la verificación final con token real: **ACCIÓN ADRIAN — crear el bot
  del operador en BotFather y pasar el token** (el receptionist conserva el
  bot actual).
- Plan B verificado si Telegram multi-cuenta fallara en la práctica:
  **WhatsApp ya está configurado y allowlisted SOLO al número de Adrian**
  (34635984010, selfChatMode, dmPolicy allowlist) — binding
  `whatsapp:<account>` → operator sería inmediato y ya-seguro.

## 3. Patrón de registro MCP (para F1): confirmado

- Config viva: `mcp.servers.citas = { url: "http://n8n:5680/mcp/citas",
  transport: "sse" }` — las tools `citas__*` las sirve n8n como MCP/SSE.
- `agency-admin` seguirá el mismo patrón: `mcp.servers.agency-admin = { url,
  transport: "sse" }` + tools en allow del AGENTE operator (spike
  aa-openclaw-brain §3: `tools.allow/deny` por agente en `agents.list[]`),
  NO en el `tools.alsoAllow` global (el receptionist no debe ver las tools
  admin).

## 4. Hallazgos colaterales (seguridad)

- Telegram del receptionist: `dmPolicy: "open"`, `allowFrom: ["*"]` — abierto
  a cualquiera. Correcto para bot de clientes, pero confirma que el operador
  NECESITA su propio canal con allowlist estricta (nunca compartir bot).
- `tools.deny` global ya bloquea `exec/process/browser/web_*` — bien para el
  operador también.
- `agents.list` no existe en la config viva y `agents list` muestra solo
  `main` → ningún agente openclaw-runtime creado aún desde agents-agency;
  el operador será el primero (buen caso de prueba end-to-end del puente F2).

## Decisión de topología (cierra AC1 salvo el token pendiente)

- Agente `operator` aislado + binding `telegram:operator` (o
  `whatsapp:default` como plan B ya-seguro).
- MCP server `agency-admin` separado del de citas, tools solo en el allow del
  operator.
- Allowlist por chat-id de Adrian en el canal del operador + validación de
  confirmación en el MCP server (doble candado, config + server).
