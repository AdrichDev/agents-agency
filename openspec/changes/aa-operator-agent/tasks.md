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
- [ ] F1-T3: auditoría de escrituras (tabla aditiva `aa.operator_audit`) +
  validación server-side de confirmación (parámetro `confirmado` + estado de
  flujo: escritura sin confirmación previa → rechazada por el server).
  - Test: AC2 + orden sin confirmar nunca ejecuta.

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
- [ ] F2-T3: re-binding Telegram → operator, allowlist chat-id de Adrian,
  receptionist fuera de Telegram (solo widget).
  - Test: AC4 — e2e desde el móvil de Adrian + intento desde otro chat-id.

## F3 — Memoria + auto-aprendizaje
- [ ] F3-T1: tabla `operator_memoria` (pgvector 1024, bge-m3) + tools MCP
  `memoria_guardar`/`memoria_buscar`; recuperación top-k inyectada por turno.
  - Test: AC5.
- [ ] F3-T2: bucle de destilado post-conversación (hechos, preferencias,
  decisiones de Adrian → memoria), con dedupe (upsert por topic).
  - Test: AC5 — dato dicho hoy, recordado en sesión nueva.

## F4 — UI chat en ambos fronts
- [ ] F4-T1: agents-agency front — widget de chat del operator, visible solo
  para Adrian, vía proxy back (token server-side).
  - Test: AC6.
- [ ] F4-T2: creador_CRM front — mismo widget/patrón, visible solo para
  Adrian (cuenta achozas9), proxy en el back del CRM.
  - Test: AC6.

## F5 — Agenda en Google Calendar (petición Adrian 03/07/2026)
> Contexto: agents-agency no tiene sección de calendario. Cuando Adrian le pida
> al Minion agendar algo (reunión, recordatorio, cita propia), debe crearse el
> evento en el Google Calendar PERSONAL de Adrian. Un solo usuario → una sola
> credencial OAuth: la limitación multi-tenant conocida del push del CRM
> ([[crm-calendar-push-multitenant-limitacion]]) NO aplica aquí.
- [ ] F5-T1: workflow en el n8n del stack OpenClaw (openclaw_n8n): webhook →
  nodo Google Calendar (credencial OAuth de Adrian, configurada UNA vez por él
  en la UI de n8n) → crear evento (título, fecha/hora inicio, duración,
  descripción). Respuesta con id/enlace del evento.
  - Test: POST manual al webhook crea evento real en el calendar de Adrian.
- [ ] F5-T2: tool `calendario_agendar` en mcp-plataforma (título, fecha
  YYYY-MM-DD, hora HH:mm, duración min, descripción opcional, confirmado) —
  protocolo de confirmación en dos pasos como toda escritura; llama al webhook
  n8n interno (http://n8n:5680/...). Actualizar IDENTITY.md del Minion (mano
  nueva de agenda) + tools.allow del operator.
  - Test: unit con webhook mockeado + e2e con evento real verificado.

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
- [ ] F6-T2: CRUD de clientes en /service/operator: GET /clientes (listar),
  GET /clientes/:id (detalle), PATCH /clientes/:id (editar campos), DELETE
  /clientes/:id (soft). Todas escritura con confirmado; reusar servicios
  existentes de tenant donde los haya.
  - Test: crear→listar→editar→borrar-soft; borrado no aparece en listar.
- [ ] F6-T3: CRUD de contactos en /service/operator reusando contacts.ts:
  GET /contactos, POST /contactos (crear), PATCH /contactos/:id, DELETE
  /contactos/:id (soft). Escrituras con confirmado.
  - Test: ciclo CRUD completo de contacto.
- [ ] F6-T4: conversión Contacto→Cliente CORRECTA — nueva tool
  `agencia_convertir_contacto` que llama al handler real convert-to-clients
  (crea tenant, arrastra nombre/email/telefono/sector/direccion del contacto,
  soft-borra el contacto vinculándolo al tenant). Antes de confirmar, el Minion
  pregunta razón social, NIF y saldo de tokens (lo que el contacto no trae).
  Retirar/repurposar la vieja `agencia_convertir_lead` (tabla lead).
  - Test: contacto → convertir → tenant con datos arrastrados + preguntados;
    contacto fuera de la agenda (deletedAt), tenant_id vinculado.
- [ ] F6-T5: tools MCP para todo lo anterior (agencia_listar_clientes,
  agencia_ver_cliente, agencia_editar_cliente, agencia_borrar_cliente,
  agencia_listar_contactos, agencia_crear_contacto, agencia_editar_contacto,
  agencia_borrar_contacto, agencia_convertir_contacto) + IDENTITY.md del Minion
  (manos nuevas, protocolo de confirmación, tokens siempre preguntados) +
  tools.allow del operator.
  - Test: humo por gateway de cada operación con confirmación.

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
- [ ] F7-T3: persona — "cliente" es UNO solo (aa.tenant), dos vistas: en agencia
  = alta/estado/agentes; en CRM = cuántos proyectos lleva, si se generó alguno,
  de quién son. El Minion cruza ambas al hablar de un cliente.

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
- [ ] F8-T3: flujo conversacional con estado — el Minion guía el alta paso a
  paso (chips o números), acumula la selección, la resume y, con confirmación,
  crea el proyecto CRM vía nueva tool de escritura `crm_crear_proyecto`
  (requiere abrir escritura en creador_CRM back /service/operator, hoy solo
  lectura). Protocolo de confirmación en dos pasos.
  - Test: e2e simulado — selección completa → proyecto CRM creado, vinculado al
    tenant correcto.

## F9 — Acciones sobre proyectos (FUTURO, Adrian 03/07/2026)
> "Como si pulsara el botón": exportar/generar paquete, abrir, editar proyectos.
> Fase posterior, spec propia cuando F6-F8 estén cerradas. Requiere mapear qué
> hace cada botón de la consola (generar zip, abrir editor, PATCH config) a
> tools de escritura del operador.

## GATE — Calidad (antes de uso real)
- [ ] GATE-T1: eval ≥10 conversaciones guionadas, revisión MANUAL (lección
  aa-openclaw-brain: 2 falsos positivos del harness automático). Criterios
  AC7. Harness con checks: meta-leak, idioma, confirmación previa, enrutado
  de plataforma, consistencia de fechas.
