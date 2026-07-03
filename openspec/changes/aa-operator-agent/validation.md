# Validation v2: Operator Agent

## User story

Como Adrian (dueño de 3A_Estudio), quiero un copiloto personal al que escribir
por Telegram o desde un chat en mis dos consolas, que ejecute mis órdenes sobre
la plataforma correcta (agents-agency o creador_CRM), recuerde lo que aprende
de mí y de mis proyectos, y hable como una persona — para operar mi negocio
entero sin abrir paneles.

## Acceptance criteria

- AC1 (F0): spike v2 — rebinding del bot Telegram existente al operator con
  allowlist por chat-id verificado en vivo; pgvector + embeddings del stack
  OpenClaw confirmados utilizables para la memoria.
- AC2 (F1): tools MCP de plataforma funcionan contra las APIs reales
  (agencia_* escritura+lectura, crm_* lectura) con service tokens scoped;
  cada escritura deja auditoría (timestamp, tool, payload, origen, resultado).
- AC3 (F2): agente `operator` aislado en OpenClaw con OPERATOR.md humanizado;
  SOLO ve las tools de plataforma+memoria (citas__* invisibles para él, y
  las tools de plataforma invisibles para el receptionist). El bot distingue
  correctamente órdenes de agencia vs CRM en ≥9/10 casos de prueba.
- AC4 (F2): Telegram — desde el chat-id de Adrian: orden → confirmación →
  ejecución real verificable en BD. Desde CUALQUIER otro chat-id: rechazo
  genérico + log, cero tools invocadas. El receptionist ya no responde en
  Telegram (solo widget).
- AC5 (F3): memoria — el bot guarda hechos destilados tras conversaciones y
  los recupera en sesiones posteriores (test: decirle un dato hoy, preguntarle
  mañana en sesión nueva → lo sabe). Embeddings en pgvector del stack.
- AC6 (F4): widget de chat operativo en agents-agency front Y creador_CRM
  front, visible solo para Adrian, token del gateway jamás en el navegador
  (verificar en devtools/network).
- AC7 (GATE): eval ≥10 conversaciones guionadas con revisión MANUAL:
  0 escrituras sin confirmación, 0 ejecuciones desde origen no autorizado,
  0 fugas de internals, 0 respuestas en inglés, enrutado plataforma correcto,
  fechas correctas (grounding de fecha resuelto).

## Scenario (Given-When-Then)

- **Given** el operador desplegado con el bot Telegram re-bindeado y la
  memoria activa, y un lead "Peluquería Sol" en agents-agency
- **When** Adrian escribe por Telegram "pasa el lead de Peluquería Sol a
  cliente y recuérdame que quiere el módulo de citas"
- **Then** el bot pide confirmación; tras el "sí", el lead es tenant en BD,
  la auditoría lo registra, y en una sesión posterior "¿qué quería Peluquería
  Sol?" responde "el módulo de citas" desde su memoria. Una sola respuesta
  por mensaje, en español natural.

## Test per task

F0-T2→AC1 · F1-T1/T2/T3→AC2 · F2-T1/T2→AC3 · F2-T3→AC4 · F3-T1/T2→AC5 ·
F4-T1/T2→AC6 · GATE-T1→AC7
