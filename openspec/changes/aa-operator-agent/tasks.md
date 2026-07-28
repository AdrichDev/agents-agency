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

- [ ] F3-T1 (**reescrita**): encender la memoria builtin de OpenClaw para el agente `main`
  —bloque `memory` en la config + tools de memoria en el `alsoAllow`, vía `setup.sh` para que
  sobreviva a los reinicios— y confirmar que `agents_memory_entries` deja de estar a cero.
  - **No se implementa a ciegas**: falta identificar el id del plugin/las tools exactas, y eso
    exige el stack arriba. Ver bloqueante.
  - Test: AC5.
- [ ] F3-T2 (**reescrita**): configurar el destilado nativo (`agents_observations`) en vez de
  escribir un bucle propio. El dedupe NO hay que programarlo: lo da el índice UNIQUE de arriba.
  - Test: AC5 — dato dicho hoy, recordado en sesión nueva.

### Bloqueante (no es falta de ganas, es que no se puede probar)

**El stack OpenClaw lleva 5 días caído**: `OpenClaw_Agents_3A`, `openclaw_3a_postgres`,
`openclaw_3a_ollama`, `openclaw_3a_redis` y `openclaw_3a_n8n` todos en `Exited (255)`. Sin
**ollama** no hay embeddings (`bge-m3`, `setup.sh:179`), así que la memoria no se puede verificar
ni aunque se configure. Escribir la config sin poder arrancarla sería exactamente el "digo que
funciona sin comprobarlo" que esta change lleva evitando.

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
- **F3-T1 y F3-T2 → trabajo real sin hacer.** Comprobado en el repo del MCP:
  `OpenClaw_Agents/mcp-plataforma/src/tools/` sólo tiene `agencia`, `crm` y `fecha`
  — no hay `memoria_guardar` ni `memoria_buscar`, y sin ellas no hay recuperación
  top-k por turno. **Matiz importante**: la TABLA `operator_memoria` sí existe, pero
  en `openclaw_db` (la creó el spike F0-T2), no en la BD de AA; buscarla en el
  `schema.prisma` de AA no prueba nada porque nunca vivió ahí. Lo que falta de F3 es
  el cableado, no el almacén.

Por eso **esta change NO se archiva**. Lo que queda no es un gate humano
irreducible, es funcionalidad por construir.
