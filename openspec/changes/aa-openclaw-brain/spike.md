# Spike F0 — Resultados verificados contra el gateway real (03/07/2026)

Gateway probado en vivo: OpenClaw 2026.6.11, contenedor `OpenClaw_Agents`,
host `:18790` → contenedor `:18789`. Todo lo de abajo está VERIFICADO por
llamadas reales, no asumido.

## 1. Autenticación (causa del 401 inicial)

- El env `OPENCLAW_GATEWAY_TOKEN` del docker-compose NO configura la auth por
  sí solo. El gateway exige config explícita:
  `gateway.auth = { mode: "token", token: "<token>" }`.
- Aplicado con `openclaw config set gateway.auth.mode token` +
  `openclaw config set gateway.auth.token "$OPENCLAW_GATEWAY_TOKEN"` (docker
  exec, usuario `node`) + reinicio del contenedor.
- Header: `Authorization: Bearer <token>`. Verificado 200 desde el host
  (`http://localhost:18790`).
- **Efecto colateral**: el dashboard Control UI pide ahora el token (una vez,
  en ajustes). Los logs muestran `device token mismatch` para sesiones
  ancladas antiguas — reissue automático al pegar el token.

## 2. Contrato del endpoint OpenAI-compat

- `POST /v1/chat/completions`. **`model` = target de agente OpenClaw**
  (`openclaw/default`, `openclaw/<agentId>`), NO `ollama/<modelo>`. El
  override de proveedor/modelo va en el header `x-openclaw-model` (requiere
  `operator.admin` en rutas con identidad).
- `user` = id estable de conversación → continúa la misma sesión del agente
  (clave para mapear conversaciones de agents-agency a sesiones OpenClaw).
- `stream: true` soportado (chunks OpenAI). No probado en vivo; documentado.
- **`tools` / `tool_choice` FUNCIONAN** (passthrough al modelo): verificado
  round-trip real con `llama3.1:8b` → `finish_reason: "tool_calls"` y
  `tool_calls[0].function = get_time({"city":"Madrid"})`. `max_tokens`/
  `max_completion_tokens`/`temperature`/`top_p`/`seed` se reenvían al provider.
- Coste de contexto: ~14.3k prompt tokens por llamada con el agente default
  (workspace completo del agente inyectado). Latencia y ventana a vigilar en
  GATE-T1.

## 3. Multi-agente

- SÍ, nativo: `agents.list[]` con `id`, `workspace` propio, `identity`
  (nombre/emoji/avatar), `model` override, `params` (temperature),
  `thinkingDefault` y `tools.allow/deny` POR AGENTE.
- Persona por bot = workspace propio por agente (files de identidad/prompt).
  Target de chat: `openclaw/<agentId>`. Encaja con F2 (un agente OpenClaw por
  bot de agents-agency).

## 4. API de configuración programática (para F2)

- Opción A (verificada, usada en este spike): `docker exec -u node
  OpenClaw_Agents openclaw config set <path> <value>` + restart del gateway.
- Opción B (documentada, default OFF): plugin `admin-http-rpc` →
  `POST /api/v1/admin/rpc` (auth del gateway). Habilitar:
  `openclaw plugins enable admin-http-rpc` + restart. Decidir en F2 si se
  activa (misma máquina → docker exec basta y no amplía superficie HTTP).

## 5. Drift y bug operativo encontrados (accionables)

- **Drift**: `openclaw_workspace/openclaw.json` del repo dice
  `agent.model = ollama/qwen3:8b`, pero la config VIVA
  (`/home/node/.openclaw/openclaw.json`) tiene
  `agents.defaults.model.primary = ollama/llama3.1:8b` + `thinkingDefault:
  off`. La fuente de verdad es la config viva.
- **Bug operativo**: `tools.profile = "minimal"` está ELIMINANDO las tools
  MCP de citas del agente main (logs: `tool policy removed 3 tool(s):
  citas__crear_cita, citas__disponibilidad, citas__stock_bajo`). El bot de
  Telegram actual NO tiene tools de reserva activas. Arreglo: añadirlas a
  `tools.alsoAllow` o cambiar el profile. Debe corregirse ANTES de GATE-T1
  (el eval exige reservas reales).

## Impacto en el diseño (proposal actualizada)

- F1: el factory apunta `baseURL` al gateway y usa `model =
  "openclaw/<agentId>"` (no `OPENCLAW_MODEL=ollama/...` como decía el borrador;
  el modelo se fija en la config del agente OpenClaw). `tools` del runToolLoop
  pasan tal cual — sin cambios en el orquestador.
- F2: aprovisionar = crear entrada en `agents.list` + workspace de persona +
  token Telegram en `channels.telegram` vía config set (docker exec) o
  admin-http-rpc; después `gateway restart`.
