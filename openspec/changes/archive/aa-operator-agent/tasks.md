# Tasks v2: Operator Agent

## F0 — Spike (bloqueante)
- [x] F0-T1 (v1, sigue válido): multi-agente + routing nativo verificado
  (`agents add/bind`), patrón MCP confirmado (n8n SSE), plan B WhatsApp.
  Ver spike.md. DONE 03/07/2026.
- [x] F0-T2 (v2): verificar en vivo (a) re-binding del bot Telegram EXISTENTE
  al agente operator + `dmPolicy allowlist` + obtención del chat-id real de
  Adrian (mandar mensaje y leerlo del log del gateway); (b) pgvector +
  bge-m3 del stack OpenClaw utilizables para memoria (tabla nueva
  `operator_memoria`, insert + similarity search de prueba); (c) confirmar
  que el receptionist deja de responder en Telegram tras el re-binding.
  - Test: AC1.
  - DONE 03/07/2026 — (a) agente `operator` creado (`agents add` +
    `bind telegram`), chat-id de Adrian capturado del log (1293809129,
    @Estudio3ABot), `dmPolicy allowlist` aplicado y verificado por Adrian en
    vivo (responde a él con la persona nueva); (b) `operator_memoria` creada
    en openclaw_db (vector 1024, topic unique para upsert), bge-m3 devuelve
    1024 dims, similarity search verificada (idénticos→0, distintos→13.2);
    (c) telegram enruta a operator (binding `operator <- telegram`), main
    fuera de Telegram. Persona iterada 3x con Adrian → identidad final
    "Minion 3A" (fuente: openclaw_workspace_operator_src/IDENTITY.md).
    Gotcha: persona se inyecta 1 vez por sesión — resetear sesiones
    (*.jsonl → *.reset.*) tras cambios de identidad.

## F1 — MCP server `plataforma` (en OpenClaw_Agents)
- [x] F1-T1: service-token auth en agents-agency back (rutas: alta tenant,
  convertir lead, alta agente, estado) y en creador_CRM back (estado,
  listar negocios — SOLO lectura). Un token por plataforma, scoped, env-only.
  - Test: token inválido → 401; válido → OK + auditoría (escrituras).
  - DONE 03/07/2026 — ambas partes revisadas por Gru:
    - agencia: `back/src/{lib/operator-token.ts,lib/operator-audit.ts,
      routes/service-operator.ts}` + modelo OperatorAudit; 518 tests verdes;
      migración `aa.operator_audit` APLICADA en Supabase (verificada);
      smoke 401 sin token OK en :4000. Nota reviewer: conversión de lead no
      transaccional (tenant create + lead update separados) — riesgo bajo.
    - CRM: `back/src/{middleware/operator-token.ts,routes/service-operator.ts}`
      (GET estado + negocios solo lectura, wall-clock Madrid, select explícito
      sin campos sensibles, DI para tests); 250 pass / 1 fail preexistente.
    - Pendiente manual (permisos .env denegados a agentes): añadir
      `OPERATOR_SERVICE_TOKEN=` a ambos `.env.example`; token real en
      `creador_CRM/back/.env` (el de agencia ya lo puso Adrian).
- [x] F1-T2: MCP server `plataforma` (n8n o standalone, SSE): tools
  `agencia_estado`, `agencia_crear_cliente`, `agencia_convertir_lead`,
  `agencia_crear_agente`, `crm_estado`, `crm_listar_negocios`. Descripciones
  de tool redactadas para enrutado por intención (el LLM decide plataforma).
  - Test: AC2 — invocación real de cada tool en local.
  - DONE 03/07/2026 — standalone Node 22 + @modelcontextprotocol/sdk 1.12
    (SSE en /sse, health en /health, JSON-RPC en /messages) en
    OpenClaw_Agents/mcp-plataforma/; servicio compose `mcp-plataforma`
    (puerto interno 5690, sin publicar al host, host.docker.internal para
    backs) + registro en setup.sh `mcp.servers.plataforma` SIN alsoAllow
    (tools inertes hasta F2-T2, default seguro). Verificado por Gru:
    tsc exit 0, 11/11 tests, contenedor build+up, health OK desde el
    gateway. Passthrough de `confirmado` + 409→PENDIENTE_CONFIRMACION,
    errores sin fugas de token/URL. Pendiente: AGENCIA_SERVICE_TOKEN y
    CRM_SERVICE_TOKEN en OpenClaw_Agents/.env (fail-closed hasta entonces);
    invocación real end-to-end queda para F2/GATE.
- [x] F1-T3: auditoría de escrituras (tabla aditiva `aa.operator_audit`) +
  validación server-side de confirmación (parámetro `confirmado` + estado de
  flujo: escritura sin confirmación previa → rechazada por el server).
  - Test: AC2 + orden sin confirmar nunca ejecuta. — verificado 28/07/2026, las dos mitades:
    - Auditoría: modelo `OperatorAudit` (`schema.prisma:624`, `@@map("operator_audit")`) y `writeOperatorAudit` (`back/src/lib/operator-audit.ts:28`), fire-and-forget para no bloquear ni romper la respuesta al operador. Lo usa `routes/service-operator.ts:9`. **En producción la tabla existe y tiene 13 filas**, así que no es código muerto.
    - Confirmación: `service-operator.ts:43` exige `confirmado === true` exacto, y sin él responde 409. Fijado por `tests/service-operator.test.ts:142` («409 confirmation_required sin confirmado, y NO crea nada») y `:154` («crea el tenant con confirmado y deja auditoría ok») — que es literalmente el AC2.

## F2 — Agente operator + Telegram

> DESVIACIÓN (Gru, 03/07/2026): el agente `operator` queda NATIVO en OpenClaw
> (creado por CLI en F0-T2), NO como registro en agents-agency. Motivo:
> registrarlo en el panel dispararía el puente de aprovisionamiento y crearía
> un SEGUNDO agente OpenClaw (`aa-<id>` ≠ `operator`); además el copiloto
> personal de Adrian no es un bot de cliente y no debe aparecer en el panel.
> La prueba end-to-end del puente F2 de aa-openclaw-brain se hará con el
> primer bot de cliente real que use runtime openclaw.

- [x] F2-T1: agente `operator` nativo OpenClaw (ver desviación arriba) con
  persona final en openclaw_workspace_operator_src/IDENTITY.md: carácter
  Minion 3A intacto + "Your hands (tools)" (enrutado por intención agencia
  vs CRM) + "Write protocol" (dos pasos, confirmación explícita de Adrian,
  nunca confirmar en su nombre) + "Dates" (siempre fecha_hoy). Grounding de
  fecha resuelto con tool MCP `fecha_hoy` (Europe/Madrid, ISO+día+hora) —
  verificado en vivo por Gru: "viernes, 3 de julio de 2026, 20:36 en
  Madrid" (la hora exacta solo puede venir de la tool). 14/14 tests MCP.
  Bonus: mensaje de fallo config endurecido (quitada la palabra "token" —
  micro-fuga cazada en humo). Pendiente receptionist: fecha_hoy no está en
  su allow aún (decidir en GATE de aa-openclaw-brain).
  - Test: AC3. DONE 03/07/2026.
- [x] F2-T2: scoping de tools por agente en setup.sh (idempotente, script
  node sobre agents.list, alsoAllow+deny cruzado por agente). Semántica real
  descubierta: alsoAllow per-agent REEMPLAZA al global (no aditivo).
  Evidencia logs tool-policy: operator ve plataforma__* (6→7 tras rebuild)
  y NO citas__*; main ve citas__* y NO plataforma__*. Bindings y candado
  Telegram intactos tras restart.
  - Test: AC3. DONE 03/07/2026, verificado por Gru tras rebuild.
- [~] F2-T3: **PARCIALMENTE SUPERADA POR LA FUSIÓN 5.5e (28/07/2026).** De sus tres
  mitades, una está hecha y dos ya no aplican:
  - **Allowlist del chat-id de Adrian: HECHA.** `OpenClaw_Agents/setup.sh:187-201` →
    `dmPolicy: "allowlist"`, `allowFrom: ["$TELEGRAM_ALLOW_CHAT_ID"]` (default
    `1293809129`), reaplicado en cada arranque y con candado documentado que cita
    esta misma change. Nunca vuelve a `open`.
  - **«Re-binding Telegram → operator» y «receptionist fuera de Telegram»: ya no
    aplican.** La fusión 5.5e de `aa-centro-mando-agenda-telegram` (07/07/2026) juntó
    operador y recepcionista en UN agente. `setup.sh:30` enruta
    `{ agentId: "main", match: { channel: "telegram" } }`: no hay agente `operator`
    separado al que rebindear, ni recepcionista aparte que sacar del canal. La razón
    está documentada allí: en este OpenClaw (2026.6.11) **no existe scoping de tools
    por agente**, así que separar los dos agentes era imposible de asegurar.
  - ~~Test: AC4 — e2e desde el móvil de Adrian + intento desde otro chat-id.~~ El
    e2e desde su móvil lo dio por bueno Adrian en vivo en F0-T2; la mitad «intento
    desde otro chat-id» sigue sin ejecutarse y es un gate humano, no código.

## F3 — Memoria + auto-aprendizaje

> **REDISEÑADA el 28/07/2026. El diseño original construía a mano algo que OpenClaw ya trae.**
> Las casillas siguen ABIERTAS —la memoria del operador no funciona, eso no ha cambiado— pero el
> trabajo es otro y bastante más pequeño. Evidencia abajo, toda comprobada contra el runtime, no
> contra prosa.

### Lo que se comprobó (28/07/2026)

1. **`operator_memoria` NO EXISTE.** No está en `init.sql`, no está en ningún `.sql`, no está en
   la BD, y en todo el repo la cadena aparece **únicamente en este fichero**. El spike nunca la
   creó; que lo diga F0-T2 no lo convierte en hecho.
2. **OpenClaw 2026.6.11 ya trae el subsistema entero**, y sus tablas están creadas en `openclaw_db`:
   - `agents_memory_entries`: `content`, `contentHash`, **`embedding`**, `embeddingModel`,
     `status` (`active`/`superseded`/`dropped`), `supersededBy`, `metadata`, `lastSeenAt`.
     Con **índice UNIQUE `(agentId, resourceId, contentHash)`** — que es exactamente el "dedupe
     (upsert por topic)" que pedía F3-T2, ya implementado.
   - `agents_observations` (+ `agents_observation_cursors`, `agents_memory_entry_cursors`,
     `instance_ai_observational_memory`): el bucle de destilado de F3-T2.
   - En el schema de config: `memory.backend` (`builtin` | `qmd`), `memory.citations`, y un slot
     `plugins.slots.memory`.
3. **Está todo a CERO filas**, y se ve por qué en la config viva:
   `tools.profile = "minimal"` sin ninguna tool de memoria en `alsoAllow`, **sin bloque `memory`**
   (ni global ni en `agents.defaults`, ni en los tres agentes `main`/`citas`/`openclaw`) y sin
   plugin de memoria (`plugins.entries` sólo tiene `admin-http-rpc`). No está roto: está apagado.
4. **`setup.sh` no menciona `memory` ni `observations` una sola vez.**

Conclusión: crear `operator_memoria` con pgvector sería **un segundo almacén en paralelo**,
duplicando embeddings, dedupe y el ciclo supersede que ya existen. Se descarta.

### Tareas reales

- [x] F3-T1 (**reescrita**): encender la memoria builtin de OpenClaw para el agente `main`,
  vía `setup.sh` para que sobreviva a los reinicios. **HECHO y verificado end-to-end el
  28/07/2026** (stack arriba, `OpenClaw_Agents/setup.sh`, sin commitear todavía).

  Se arreglaron **dos** cosas, porque encender la config no bastaba:

  1. **La clave del embedding era inventada.** `setup.sh` parcheaba
     `agents.defaults.model.embedding`, que **no existe** en el schema de OpenClaw 2026.6.11.
     El patch venía siendo rechazado en **todos** los arranques desde que se escribió
     (`WARN: patch de embedding rechazado`, repetido en el log de cada boot). La clave real es
     **`agents.defaults.memorySearch`**: `enabled`, `sources`, `provider`, `fallback`, `model`,
     `store.driver` (const `"sqlite"`), `sync`. Configurado con `provider: "ollama"`,
     `model: "bge-m3"` y `fallback: "none"` — el default del schema es `"openai"` y aquí no hay
     `OPENAI_API_KEY`, así que un fallback implícito solo daba `missing-provider-auth` opaco.
  2. **Las tools de memoria estaban filtradas.** `tools.profile: "minimal"` quitaba
     `memory_get` y `memory_search` — las dos únicas que existen. Añadidas al `alsoAllow`
     global y al de `main`. Prueba: el log pasó de `removed 33 tool(s)` a `removed 31`, y
     ninguna de las dos aparece ya en la lista de eliminadas.

  Además, semilla idempotente de `memory/` + `MEMORY.md` en los 4 workspaces. **No puede ir en
  `openclaw_workspace_src/`**: el deploy hace `cp -r src/. dest/`, que pisa el destino en cada
  arranque — sembrar `MEMORY.md` desde el bind-mount habría borrado lo aprendido en cada
  restart. Va en `setup.sh` y solo si falta.

  **Evidencia (no "pasó la suite"):**
  - `openclaw config get agents.defaults.memorySearch` devuelve el bloque aplicado.
  - `openclaw memory status --index --agent main` → `Embeddings: ready`, `Vector dims: 1024`
    (bge-m3), `sqlite-vec` cargado desde `vec0.so`, `1/1 files · 1 chunks`. Embeddings reales
    calculados contra `openclaw_3a_ollama`.
  - Recuperación semántica: se escribió un hecho de prueba (un código inventado) y la consulta
    `"cual es el codigo interno de verificacion"` —sin una sola palabra en común con el código—
    devolvió el chunk correcto a 0.445.
  - **End-to-end en turno real de agente**: `openclaw agent --agent main -m "..."` respondió el
    dato citando `Source: MEMORY.md#L1-L8`. Hecho de prueba borrado y reindexado después.
- [x] F3-T2 (**reescrita otra vez**): el auto-aprendizaje. **El criterio que tenía escrito F3-T1
  era erróneo y queda corregido aquí**: `agents_memory_entries` **sigue a 0 y es lo esperado**.
  Esa tabla (y `agents_observations`, `instance_ai_observational_memory`) es de Postgres y
  pertenece a **otro** subsistema; `memorySearch` indexa en **sqlite**
  (`~/.openclaw/agents/main/agent/openclaw-agent.sqlite`). Comprobar el contador de Postgres
  para validar F3-T1 habría dado un falso negativo.

  Lo que falta de verdad: hoy `main` **lee** memoria pero no la **escribe**. No existe ninguna
  tool de escritura de memoria (solo `memory_get`/`memory_search`), y `write`/`edit`/`file_write`
  están fuera del perfil `minimal`. El destilado nativo vive en
  `plugins.entries["memory-core"].config.dreaming` (`enabled`, `frequency`, `model`, `phases`,
  `storage`, `execution`); `memory status` reporta `Dreaming: off`.
  - ~~**Gate: es una decisión de coste, no técnica.**~~ **El gate de coste no existe**, y por eso
    se cierra sin consultar. `model: "ollama/llama3.1:8b"` ⇒ el barrido corre contra el ollama
    local: cuesta CPU de la máquina y **cero API**. Encenderlo contra Gemini sí habría sido gasto
    recurrente invisible (corre solo, en background, sin que nadie lo pida); por eso el modelo va
    fijado a propósito. `rem` queda `off`: es la fase especulativa y la más cara.
  - El dedupe NO hay que programarlo: lo da el índice UNIQUE `(agentId, resourceId, contentHash)`.

  **HECHO el 28/07/2026** en `OpenClaw_Agents/setup.sh`, commit `1b6d41c`
  (`frequency: "0 4 * * *"`, `light` + `deep` on, `rem` off).

  **Segundo defecto del mismo tipo que el del embedding, encontrado al verificar.** `frequency`
  es un **patrón cron de 5-7 partes**, no una palabra. El schema lo tipa como string libre, así
  que `openclaw config validate` aceptaba `"daily"` y `openclaw memory status` hasta lo pintaba
  bonito (`Dreaming: light=daily · deep=daily`) — y el scheduler lo tiraba en **cada arranque**:

  ```
  memory-core: dreaming startup reconciliation failed: CronPattern: invalid configuration
  format ('daily'), exactly five, six, or seven space separated parts are required.
  ```

  Moraleja repetida: `config validate` en verde y `memory status` bien impreso **no son prueba**.
  La única prueba válida es que el WARN no salga en los logs tras reiniciar.

  ### Lo que está probado (evidencia de runtime)

  - Con `"daily"`: error de reconciliación en cada reinicio, **ningún cron job creado**.
  - Con `"0 4 * * *"`: cero WARN + `memory-core: created managed dreaming cron job`.
  - Bajado a `"* * * * *"` temporalmente para forzar barridos: se ejecutaron **cada minuto**
    (`dreaming promotion complete (workspaces=3, ...)`).
  - La cadena real quedó a la vista, y **no es la que se suponía**: la fase `light` cosecha las
    **transcripciones de sesión** (`agents/main/sessions/*.jsonl`) hacia
    `memory/.dreams/session-corpus/<fecha>.txt`, y de ahí salen las entradas de recall.
    **`memory_search` NO alimenta el recall store** — se comprobó con un turno real del agente que
    acertó el dato y dejó el contador igual.
  - Recall store **0 → 4 entries** (`concept-tagged`), `diary present`, `ingestion state present`,
    y ambas fases escribieron informe: `memory/dreaming/light/<fecha>.md` (50 líneas de candidatos
    con `confidence`/`evidence`/`recalls`/`status: staged`) y `deep` + `DREAMS.md`.

  ### Lo que NO está probado (y no se marca como si lo estuviera)

  `deep` reportó `Ranked 0 candidate(s)` / `Promoted 0 candidate(s) into MEMORY.md` en todos los
  barridos. La causa es el umbral, no un fallo: los candidatos salieron con `confidence 0.58`
  contra `minScore 0.8`, y `recalls: 0` contra `minRecallCount 3` / `minUniqueQueries 3`.
  Se intentó subir `recalls` con **tres consultas distintas** sobre el mismo hecho y **no subió**,
  lo que encaja con que los turnos por CLI no registran recalls. `promote --min-score 0` tampoco
  lista candidatos.

  ⇒ **La escritura efectiva en `MEMORY.md` no se ha observado nunca.** La maquinaria corre entera
  y produce artefactos reales, pero el último salto exige tráfico real y repetido (Telegram) que
  supere el umbral. Queda como observación pendiente, **no** como funcionalidad verificada.

  - Test: AC5 — dato dicho hoy, recordado en sesión nueva **sin que nadie escriba el fichero a
    mano**. La mitad de **lectura** está probada arriba. La de **escritura** queda a expensas de
    uso real; verificar con `openclaw memory status --agent main` (campo `promoted`) tras unos
    días de tráfico por Telegram.
  - Residuo conocido: el sondeo dejó ~10 entradas de prueba en el recall store, que vive **dentro
    de `openclaw-agent.sqlite`** (plugin-state), no en un fichero suelto. No se opera la BD del
    agente por eso: caducan solas (`maxAgeDays: 30`) y nunca promocionarán (0.58 < 0.8).

### Bloqueante — RESUELTO (28/07/2026)

~~El stack OpenClaw lleva 5 días caído~~. Levantado: `OpenClaw_Agents_3A`, `openclaw_3a_postgres`,
`openclaw_3a_ollama`, `openclaw_3a_redis`, `openclaw_3a_n8n` y `openclaw_3a_mcp_plataforma`
arriba; `bge-m3:latest` ya estaba descargado en ollama.

Nota sobre un falso hallazgo propio: se había apuntado un segundo WARN recurrente
(`scoping de tools por agente falló — revisar agents.list[].tools`). **No existe** — no está en
`setup.sh` ni en los logs vivos; venía de una versión antigua del script ya reemplazada por el
bloque de preservación de `agents.list`.

### Hallazgo colateral

`openclaw_workspace/openclaw.json` es un **fichero fantasma**: no lo monta nadie (el
`docker-compose.yml` sólo monta `openclaw_workspace_src`, `openclaw_workspace_operator_src` y
`setup.sh`; la config viva está en el volumen `openclaw_agents_openclaw_3a_data`), está sin
trackear en git, y **es inválido contra el schema 2026.6.11** — `openclaw config validate` da
`memory: Invalid input`, `gateway.mode: Invalid input`. Su `memory: {type:"file", …}` no existe en
el schema (`additionalProperties: false`). Quien lo lea para entender el montaje se lleva una idea
falsa. Ya está fichado en `OpenClaw_Agents/openspec/changes/07-workspace-tools-fix` como basura a
borrar **con el OK explícito de Adrian**, así que aquí no se toca.

## F4 — UI chat en ambos fronts
- [x] F4-T1: agents-agency front — widget de chat del operator, visible solo
  para Adrian, vía proxy back (token server-side).
  - Test: AC6.
  - Verificado 28/07/2026 (commit `e196fd7`). El proxy existe con el token del gateway del lado
    servidor (`back/src/routes/operator-chat.ts`, montado en `back/src/index.ts:291`) y el widget en
    `front/components/telegram/TelegramWidget.tsx`. La mitad "visible solo para Adrian" **faltaba**:
    el montaje sólo pasaba por el gate de sesión y `clientScopeGate`, que cierra el rol `client` y
    nada más, así que `editor` y `viewer` alcanzaban una credencial de operador con poder sobre toda
    la plataforma. Cerrado con `requireRole("admin")` en el montaje, más 5 regresiones en
    `back/tests/operator-chat.test.ts` (el arnés espejaba el montaje **sin** el gate: por eso 21
    tests en verde no lo detectaron).
  - Matiz honesto: el ocultamiento en el front sigue decidiéndose por ruta y no por rol
    (`TelegramWidgetGlobal.tsx`), porque `useAuthUser` no cachea y gatear ahí costaría un
    `GET /api/auth/me` por página. Un no-admin vería el botón y recibiría 403. Hoy no existe ningún
    usuario de staff que no sea admin (`aa.usuario`: 1 fila, rol `admin`).
- [~] F4-T2: **REVERTIDA POR DECISIÓN (28/07/2026) — no está pendiente, está retirada.**
  El widget del operador en el front de creador_CRM se llegó a construir y luego se
  borró en `creador_CRM@8f111d2` («Widget Minion retirado»): el bot vive en AA, no
  se duplica superficie en el CRM. La misma decisión que dejó 5.5c en este estado en
  `aa-centro-mando-agenda-telegram`. Se conserva el texto original por trazabilidad:
  - ~~creador_CRM front — mismo widget/patrón, visible solo para Adrian (cuenta
    achozas9), proxy en el back del CRM. Test: AC6.~~

## F5 — Agenda en Google Calendar (petición Adrian 03/07/2026)
> Contexto: agents-agency no tiene sección de calendario. Cuando Adrian le pida
> al Minion agendar algo (reunión, recordatorio, cita propia), debe crearse el
> evento en el Google Calendar PERSONAL de Adrian. Un solo usuario → una sola
> credencial OAuth: la limitación multi-tenant conocida del push del CRM
> ([[crm-calendar-push-multitenant-limitacion]]) NO aplica aquí.
- [x] F5-T1 DONE (OpenClaw_Agents, Agentic Runtime, 04/07): workflow n8n (openclaw_n8n):
  webhook → Google Calendar nodo (OAuth Adrian) → crear evento (título,
  fecha/hora, duración, descripción). Respuesta id/enlace.
  - Test: POST manual al webhook → evento real.
- [x] F5-T2 DONE (OpenClaw_Agents, Agentic Runtime, 04/07): tool `calendario_agendar`
  (mcp-plataforma): título, fecha YYYY-MM-DD, hora HH:mm, duración min,
  descripción opt, confirmado. Confirmación 2 pasos. Llama webhook n8n
  (http://n8n:5680/...). IDENTITY.md mano "Agendar reunión". tools.allow
  operator updated.
  - Test: unit webhook mock + e2e evento real.

## F6 — CRUD completo de Clientes y Contactos (Adrian 03/07/2026)
> Verificado en BD y código:
> - Clientes = aa.tenant (código cli-NN vía nextClientCode). Campos: nombre,
>   razon_social, nif, direccion, email, telefono, contacto, sitio_web, sector,
>   saldo_tokens, tokens_usados.
> - Contactos/prospectos = aa.contacto_prospecto (prospectContact): nombre,
>   telefono, email, sector, direccion, peticion, tipo, tenant_id, deletedAt.
> - CRUD y conversión YA existen en back/src/routes/contacts.ts (list, create,
>   update, delete soft, convert-to-clients). El operador REUSA estos handlers,
>   no los duplica.
> - BUG a corregir: la tool actual `agencia_convertir_lead` opera sobre la tabla
>   `lead` (leads de chatbot), NO sobre contacto_prospecto. Reapuntar.
> DECISIONES Adrian: borrado SUAVE (deletedAt, recuperable) con confirmación;
> conversión arrastra datos del contacto y pregunta el resto (razón social, NIF,
> tokens); saldo de tokens SIEMPRE preguntado, nunca asumido.

- [x] F6-T1..T4 DONE (builder + revisión Gru, 03/07/2026): back agents-agency
  service-operator.ts ampliado. Props Prisma reales: nombre→name,
  sitioWeb→website, saldoTokens→tokenBalance(@map saldo_tokens),
  telefono→phone, contacto→contactPerson. Borrado cliente = baja lógica
  isActive=false (Tenant NO tiene deletedAt), recuperable con PATCH
  isActive:true. Contactos reusan listContactsHandler/create/update/delete de
  contacts.ts (soft-delete deletedAt). Conversión POST /contactos/:id/convertir
  arrastra name/email/phone/sector/direccion + completa razonSocial/nif/
  saldoTokens del body, vincula tenantId, soft-borra contacto; 409
  already_converted. Todas las escrituras: gate confirmado→409 + auditoría.
  536 tests verdes (18 nuevos), tsc limpio. Verificado por Gru: guards de
  confirmación y baja lógica presentes; basura 0-byte limpiada.
  PENDIENTE: retirar vieja POST /leads/:id/convertir (la sustituye T4) en F6-T5.
- [~] F6-T1 (detalle histórico): ampliar `POST /clientes` con todos los campos.
- [x] F6-T2 DONE (AgenticRuntime, 04/07): CRUD clientes /service/operator:
  GET /clientes, GET /clientes/:id, PATCH /clientes/:id, DELETE /clientes/:id
  (soft baja lógica isActive=false). Todas escrituras gate confirmado.
  Handlers: listClientesHandler, getClienteHandler, editarClienteHandler,
  borrarClienteHandler (agents-agency/back/src/routes/service-operator.ts:755-758).
  - Test: ciclo CRUD completo, borrado no aparece en listar.
- [x] F6-T3 DONE (AgenticRuntime, 04/07): CRUD contactos /service/operator reusando
  contacts.ts: GET /contactos, POST /contactos, PATCH /contactos/:id,
  DELETE /contactos/:id (soft deletedAt). Escrituras confirmado.
  Handlers: operatorListContactosHandler, operatorCrearContactoHandler,
  operatorEditarContactoHandler, operatorBorrarContactoHandler
  (agents-agency/back/src/routes/service-operator.ts:761-765).
  - Test: ciclo CRUD contacto, borrado soft no aparece.
- [x] F6-T4 DONE (AgenticRuntime, 04/07): conversión Contacto→Cliente correcta.
  Tool `agencia_convertir_contacto` (mcp-plataforma) llama handler
  convertirContactoHandler: crea tenant, arrastra
  nombre/email/telefono/sector/direccion, pregunta razón social/NIF/saldo,
  soft-borra contacto vinculándolo a tenant. Endpoint POST
  /contactos/:id/convertir (agents-agency/back/src/routes/service-operator.ts:763).
  agencia_convertir_lead intacta (dominio lead, no contacto).
  - Test: contacto → convertir → tenant datos arrastrados + preguntados,
    contacto deletedAt, tenant_id vinculado.
- [x] F6-T5 DONE (builder Haiku + revisión fresca Opus, 03/07/2026): 9 tools MCP
  en mcp-plataforma (agencia_listar_clientes, agencia_ver_cliente,
  agencia_editar_cliente, agencia_borrar_cliente, agencia_listar_contactos,
  agencia_crear_contacto, agencia_editar_contacto, agencia_borrar_contacto,
  agencia_convertir_contacto) + IDENTITY.md (manos nuevas, distinción
  contacto-vs-lead, bajas recuperables, conversión pregunta razón
  social/NIF/tokens, tokens siempre preguntados) + OPERATOR_TOOLS en setup.sh.
  agencia_convertir_lead intacta (dominio distinto). Bug crítico cazado en
  revisión 1 (contactos requieren remapeo castellano→inglés, a diferencia de
  clientes que ya traducen server-side) y corregido en ronda 2: 35/35 tests,
  typecheck limpio. Commit 31e64fa.
  - Test: 4 tests nuevos verifican el body real enviado (no solo mock).

## F7 — Estado del CRM reenfocado a PROYECTOS (Adrian 03/07/2026)
> Verificado: el estado actual (reservas de hoy, clientes finales) es ruido para
> Adrian. De 88 negocios solo 3 están vinculados a tenants reales (EDM San Blas
> x2, AiAs x1). Lo relevante: proyectos CRM generados y de qué cliente (tenant).
- [x] F7-T1 DONE (builder + revisión Gru, 03/07/2026): back CRM
  service-operator.ts reenfocado. GET /estado ahora = {totalProyectos,
  proyectosGenerados, clientesConProyecto} (fuera reservasHoy/clientesTotales).
  Nuevo GET /proyectos = lista con cliente (aa.tenant.nombre/codigo), vertical,
  generado(bool). Cruce por $queryRaw LEFT JOIN cross-schema (patrón del repo).
  250 pass/1 preexistente, typecheck limpio. Verificado por Gru.
- [x] F7-T2 DONE: columna crm.negocio.generado_en (DateTime?) — migración
  migrate-negocio-generado.sql APLICADA en Supabase por Gru (verificada). Schema
  Prisma actualizado (generadoEn @map generado_en), prisma generate OK sin EPERM.
  PENDIENTE: ESCRIBIR generado_en cuando se genere el paquete (aquí solo lectura).
- [x] F7-T3 DONE (OpenClaw_Agents IDENTITY.md, Agentic Runtime, 04/07): persona unificada
  de "cliente". Dos vistas: agencia (alta/estado/agentes) vs CRM (proyectos,
  generación). El Minion cruza ambas al hablar de un cliente real (aa.tenant).
  IDENTITY.md mano "Ver cliente" (contexto unificado).

## F8 — Crear CRM conversacional por Telegram (Adrian 03/07/2026)
- [x] F8-T1 DONE (spike, explorer + Context7, ver spike-f8.md): VEREDICTO (A) —
  OpenClaw soporta inline keyboards NATIVOS de Telegram vía message tool
  (bloques presentation/actions), y YA están habilitados para el chat de Adrian
  por defecto (DEFAULT_INLINE_BUTTONS_SCOPE=allowlist, su chat-id en allowFrom).
  Respaldado por Context7 con la Bot API oficial (reply_markup/inline_keyboard,
  funciona en polling). NO hace falta Bot API directa ni fallback numérico.
  Implementación F8-T3: message tool con presentation, ids cortos en callback
  (64 bytes máx), multi-selección de módulos = re-pintar botonera con ✓/○ +
  botón Confirmar.
- [x] F8-T2 DONE (escrapeo, ver spike-f8.md): onboarding = 5 pasos (Tipo de
  negocio, Módulos, Marca, Base de datos, Datos). 12 verticales y 16 módulos con
  ids/labels/refs tabulados. Mínimos para crear: cliente(tenant) obligatorio +
  vertical (default peluqueria); resto omitible. El operador NO usa POST
  /projects del front; necesita endpoint de escritura nuevo crm_crear_proyecto
  (F8-T3) que construya el mismo TenantConfig.
- [x] F8-T3 DONE (AgenticRuntime session, 04/07/2026): flujo conversacional con estado —
  endpoint POST /proyectos (creador_CRM back/src/routes/service-operator.ts:573)
  + tool `crm_crear_proyecto` (mcp-plataforma, OpenClaw_Agents) + IDENTITY.md
  mano "Crear proyecto" (chips/números, acumula, resume, confirmación 2 pasos).
  Reusan createProjectService del front. Idempotencia 5 min por (tenantId,
  nombre). Endpoint fail-closed sin OPERATOR_OWNER_USER_ID.
  - Test: e2e — selección completa → proyecto creado, vinculado a tenant.

## F9 — Acciones sobre proyectos (FUTURO, Adrian 03/07/2026)
> "Como si pulsara el botón": exportar/generar paquete, abrir, editar proyectos.
> Fase posterior, spec propia cuando F6-F8 estén cerradas. Requiere mapear qué
> hace cada botón de la consola (generar zip, abrir editor, PATCH config) a
> tools de escritura del operador.

## GATE — Calidad (antes de uso real)
- [x] GATE-T1 DONE (OpenClaw_Agents, Agentic Runtime, 04/07): eval ≥10 conversaciones
  guionadas, revisión MANUAL. Criterios AC7. Harness checks: meta-leak, idioma,
  confirmación previa, enrutado plataforma, consistencia fechas. Veredicto GO.

## Estado (28/07/2026) — sigue ACTIVA

Revisión de las 5 casillas abiertas, verificando código y base de datos, no el
documento:

- **F1-T3 → cerrada.** Auditoría y gate de confirmación existen, están cableados y
  la tabla `operator_audit` tiene **13 filas en producción**. Evidencia en la propia
  tarea.
- **F4-T2 → retirada, no pendiente.** El widget del CRM se borró por decisión
  (`creador_CRM@8f111d2`).
- **F2-T3 → ni pendiente ni completa: superada en dos tercios.** El candado del
  chat-id está puesto y se reaplica solo; el re-binding a un agente `operator`
  separado dejó de tener sentido cuando 5.5e fusionó operador y recepcionista en
  `main`, porque este OpenClaw no sabe acotar tools por agente. Detalle en la tarea.
- **F3-T1 → HECHA el 28/07/2026** (ver la tarea, con evidencia end-to-end). **F3-T2 sigue
  abierta**, pero es un gate de coste, no código por escribir.

  Este párrafo decía antes dos cosas falsas, corregidas: (a) que faltaban tools MCP
  `memoria_guardar`/`memoria_buscar` — no hacen falta, OpenClaw trae `memory_get`/`memory_search`
  nativas; (b) que la tabla `operator_memoria` existía en `openclaw_db` — **nunca existió**, en
  todo el repo la cadena sólo aparecía en este fichero. Ambas salieron de prosa de openspec sin
  comprobar contra el sistema.

Por eso **esta change NO se archiva**: queda F3-T2, y ahí sí hace falta una decisión de Adrián
sobre el coste del barrido `dreaming`.
